import { NextResponse } from "next/server";
import { INITIAL } from "@/lib/market";
import { sessionKey } from "@/lib/session";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol") || "EUR_USD";
  if (!INITIAL.some((q) => q.symbol === symbol))
    return NextResponse.json(
      { error: "Unsupported chart instrument." },
      { status: 400, headers },
    );
  const token = process.env.OANDA_API_TOKEN;
  if (!token)
    return NextResponse.json(
      { error: "Server connection is not configured." },
      { status: 503, headers },
    );
  const environment = process.env.OANDA_ENVIRONMENT || "practice";
  if (!["practice", "live"].includes(environment))
    return NextResponse.json(
      { error: "Invalid OANDA environment." },
      { status: 503, headers },
    );
  const host =
    environment === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";
  try {
    const response = await fetch(
      `${host}/v3/instruments/${symbol}/candles?count=288&granularity=M5&price=M`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok)
      throw new Error("OANDA chart is temporarily unavailable.");
    const data = await response.json();
    const candles = (data.candles || [])
      .map((c: { time: string; mid: { c: string } }) => ({
        time: c.time,
        price: Number(c.mid?.c),
      }))
      .filter(
        (c: { time: string; price: number }) =>
          Number.isFinite(c.price) && c.price > 0,
      );
    if (!candles.length)
      throw new Error("OANDA chart is temporarily unavailable.");
    const session = sessionKey(candles.at(-1).time);
    return NextResponse.json(
      {
        symbol,
        interval: "M5",
        points: candles.filter(
          (c: { time: string }) => sessionKey(c.time) === session,
        ),
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "OANDA chart is temporarily unavailable." },
      { status: 502, headers },
    );
  }
}
