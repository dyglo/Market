import { NextRequest, NextResponse } from "next/server";
import { INITIAL } from "@/lib/market";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
};
const opens = new Map<string, { open: number; expires: number }>();
async function prices(request: NextRequest, manual: boolean) {
  if (manual) {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin)
      return NextResponse.json(
        { error: "Invalid request origin." },
        { status: 403, headers },
      );
  }
  let input: Record<string, unknown> = {};
  if (manual) {
    if (Number(request.headers.get("content-length") || 0) > 4096)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413, headers },
      );
    try {
      const body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error("Invalid settings");
      input = body;
    } catch {
      return NextResponse.json(
        { error: "Invalid connection settings." },
        { status: 400, headers },
      );
    }
  }
  const account = manual ? input.accountId : process.env.OANDA_ACCOUNT_ID,
    token = manual ? input.token : process.env.OANDA_API_TOKEN,
    environment = manual
      ? input.environment
      : process.env.OANDA_ENVIRONMENT || "practice";
  if (
    typeof account !== "string" ||
    typeof token !== "string" ||
    !account ||
    !token
  )
    return NextResponse.json(
      {
        error: manual
          ? "Enter your account ID and API token."
          : "Server connection is not configured.",
      },
      { status: manual ? 400 : 503, headers },
    );
  if (
    !/^[\d-]{5,100}$/.test(account) ||
    token.length > 300 ||
    /[\r\n]/.test(token) ||
    !["practice", "live"].includes(String(environment))
  )
    return NextResponse.json(
      { error: "Check your account ID, token and environment." },
      { status: 400, headers },
    );
  const base =
    environment === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";
  const get = async (path: string) => {
    const res = await fetch(`${base}/v3/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok)
      throw new Error(
        res.status === 401 || res.status === 403
          ? "OANDA rejected these credentials. Check the token, account ID and environment."
          : res.status === 404
            ? "OANDA account or instrument unavailable. Check your account ID."
            : "OANDA is currently unavailable. Please try again.",
      );
    return res.json();
  };
  try {
    const available = await get(
      `accounts/${encodeURIComponent(account)}/instruments`,
    );
    const names = new Set(
      (available.instruments || []).map((i: { name: string }) => i.name),
    );
    const supported = INITIAL.filter((q) => names.has(q.symbol));
    if (!supported.length)
      throw new Error(
        "None of the board’s instruments are available for this account.",
      );
    const data = await get(
      `accounts/${encodeURIComponent(account)}/pricing?instruments=${supported.map((q) => q.symbol).join(",")}`,
    );
    const quotes = await Promise.all(
      supported.map(async (q) => {
        const p = data.prices?.find(
          (p: { instrument: string }) => p.instrument === q.symbol,
        );
        if (!p?.bids?.length || !p?.asks?.length) return null;
        const price = (Number(p.bids[0].price) + Number(p.asks[0].price)) / 2;
        if (!Number.isFinite(price) || price <= 0)
          throw new Error("OANDA returned an invalid price.");
        const key = `${environment}:${q.symbol}`,
          cached = opens.get(key);
        let open = cached?.open;
        if (!cached || cached.expires < Date.now()) {
          const candles = await get(
            `instruments/${q.symbol}/candles?count=2&granularity=D&price=M&dailyAlignment=0&alignmentTimezone=UTC`,
          );
          const daily = candles.candles?.at(-1);
          open = Number(daily?.mid?.o);
          if (!Number.isFinite(open) || !open)
            throw new Error(
              "Daily reference prices are currently unavailable.",
            );
          opens.set(key, {
            open,
            expires: Math.min(
              Date.now() + 60000,
              new Date().setUTCHours(24, 0, 0, 0),
            ),
          });
        }
        return {
          ...q,
          price,
          open,
          history: Array(32).fill(price),
          tick: 0,
          tradeable: p.tradeable,
        };
      }),
    );
    if (!quotes.some(Boolean))
      throw new Error(
        "No prices are currently available for these instruments.",
      );
    return NextResponse.json(
      {
        quotes: quotes.filter(Boolean),
        environment,
        time: new Date().toISOString(),
      },
      { headers },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error && e.name !== "TimeoutError"
            ? e.message
            : "OANDA timed out. Please try again.",
      },
      { status: 502, headers },
    );
  }
}
export async function GET(request: NextRequest) {
  return prices(request, false);
}
export async function POST(request: NextRequest) {
  return prices(request, true);
}
