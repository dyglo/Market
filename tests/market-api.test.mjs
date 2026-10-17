import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
function load(file, overrides = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(
    fs.readFileSync(new URL(file, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require,
    AbortSignal,
    process: { env: {} },
    ...overrides,
  });
  return module.exports;
}
const market = load("../lib/market.ts");
const session = load("../lib/session.ts");
function api(fetch, env = {}) {
  return load("../app/api/market/route.ts", {
    fetch,
    process: { env },
    require: (name) =>
      name === "@/lib/market"
        ? market
        : name === "@/lib/session"
          ? session
          : require(name),
  });
}
const post = (body) =>
  new NextRequest("https://ticker.test/api/market", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://ticker.test",
    },
    body: JSON.stringify(body),
  });
const settings = {
  accountId: "001-001-1234567-001",
  token: "test-private-token",
  environment: "practice",
};
test("unconfigured deployment supports simulation without exposing credentials", async () => {
  const route = api(() => {
    throw Error("Unexpected network call");
  });
  const res = await route.GET(
    new NextRequest("https://ticker.test/api/market"),
  );
  assert.equal(res.status, 503);
  assert.match(res.headers.get("cache-control"), /no-store/);
  assert.equal((await res.json()).code, "NOT_CONFIGURED");
});
test("malformed credentials and foreign origins are rejected before calling OANDA", async () => {
  const route = api(() => {
    throw Error("Unexpected network call");
  });
  for (const body of [
    null,
    [],
    {},
    { ...settings, environment: "https://attacker.test" },
    { ...settings, token: "bad\r\ntoken" },
  ]) {
    assert.equal((await route.POST(post(body))).status, 400);
  }
  const request = new NextRequest("https://ticker.test/api/market", {
    method: "POST",
    headers: { origin: "https://attacker.test" },
    body: JSON.stringify(settings),
  });
  assert.equal((await route.POST(request)).status, 403);
});
test("OANDA midpoint and previous-session close replace simulation with only available instruments", async () => {
  const calls = [];
  const route = api(async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, "Bearer test-private-token");
    assert.ok(url.startsWith("https://api-fxpractice.oanda.com/v3/"));
    let body;
    if (url.includes("/instruments/")) {
      assert.match(
        url,
        /dailyAlignment=17&alignmentTimezone=America%2FNew_York/,
      );
      body = {
        candles: [
          {
            time: "2026-10-14T21:00:00Z",
            complete: true,
            mid: { o: "1.08", c: "1.10000" },
          },
          {
            time: "2026-10-15T21:00:00Z",
            complete: false,
            mid: { o: "1.10500", c: "1.11010" },
          },
        ],
      };
    } else if (url.includes("/pricing?"))
      body = {
        prices: [
          {
            instrument: "EUR_USD",
            time: "2026-10-16T14:00:00Z",
            bids: [{ price: "1.11000" }],
            asks: [{ price: "1.11020" }],
            tradeable: true,
          },
        ],
      };
    else body = { instruments: [{ name: "EUR_USD" }] };
    return Response.json(body);
  });
  const res = await route.POST(post(settings));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(settings.token));
  assert.ok(!text.includes(settings.accountId));
  const data = JSON.parse(text);
  assert.equal(data.quotes.length, 1);
  assert.equal(data.quotes[0].symbol, "EUR_USD");
  assert.equal(data.quotes[0].previousClose, 1.1);
  assert.ok(Math.abs(data.quotes[0].price - 1.1101) < 1e-10);
  assert.ok(Math.abs(market.change(data.quotes[0]) - 0.9181818) < 0.00001);
  await route.POST(post(settings));
  assert.equal(calls.filter((url) => url.includes("/candles")).length, 1);
});
test("upstream authorization failures return a helpful error without token leakage", async () => {
  const route = api(async () => new Response("", { status: 401 }));
  const res = await route.POST(post(settings));
  assert.equal(res.status, 502);
  const body = await res.text();
  assert.match(body, /rejected these credentials/);
  assert.ok(!body.includes(settings.token));
});

test("server environment connects to OANDA and preserves closed-market prices", async () => {
  const route = api(
    async (url, options) => {
      assert.equal(options.headers.Authorization, "Bearer server-only-token");
      assert.ok(url.startsWith("https://api-fxtrade.oanda.com/v3/"));
      if (url.includes("/candles"))
        return Response.json({
          candles: [
            {
              time: "2026-10-14T21:00:00Z",
              complete: true,
              mid: { o: "4090", c: "4100" },
            },
            {
              time: "2026-10-15T21:00:00Z",
              complete: true,
              mid: { o: "4156.04", c: "4165.4" },
            },
          ],
        });
      if (url.includes("/pricing?"))
        return Response.json({
          prices: [
            {
              instrument: "XAU_USD",
              time: "2026-10-16T20:59:59Z",
              bids: [{ price: "4165.3" }],
              asks: [{ price: "4165.5" }],
              tradeable: false,
            },
          ],
        });
      return Response.json({ instruments: [{ name: "XAU_USD" }] });
    },
    {
      OANDA_ACCOUNT_ID: "001-001-1234567-001",
      OANDA_API_TOKEN: "server-only-token",
      OANDA_ENVIRONMENT: "live",
    },
  );
  const response = await route.GET(
    new NextRequest("https://ticker.test/api/market"),
  );
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes("server-only-token"));
  const data = JSON.parse(text);
  assert.equal(data.environment, "live");
  assert.equal(data.quotes.length, 1);
  assert.equal(data.quotes[0].tradeable, false);
  assert.equal(data.quotes[0].price, 4165.4);
  assert.equal(data.quotes[0].previousClose, 4100);
});

const fridayCandles = [
  { time: "2026-10-14T21:00:00Z", complete: true, mid: { o: "98", c: "100" } },
  { time: "2026-10-15T21:00:00Z", complete: true, mid: { o: "102", c: "105" } },
];
test("weekend change uses Thursday close, rather than Friday close or Friday open", () => {
  const reference = session.previousSessionClose(
    fridayCandles,
    "2026-10-16T20:59:59Z",
    false,
  );
  assert.equal(reference.close, 100);
  assert.equal(reference.previousSessionStart, "2026-10-14T21:00:00Z");
  assert.ok(
    Math.abs(
      market.change({ price: 105, previousClose: reference.close }) - 5,
    ) < 1e-10,
  );
});
test("Sunday reopening includes the weekend gap against Friday close", () => {
  const candles = [
    ...fridayCandles,
    {
      time: "2026-10-18T21:00:00Z",
      complete: false,
      mid: { o: "110", c: "111" },
    },
  ];
  const reference = session.previousSessionClose(
    candles,
    "2026-10-18T22:00:00Z",
    true,
  );
  assert.equal(reference.close, 105);
  assert.ok(
    Math.abs(
      market.change({ price: 111, previousClose: reference.close }) - 5.7142857,
    ) < 1e-6,
  );
});
test("live session rollover uses the last close while waiting for a new candle", () => {
  assert.equal(
    session.previousSessionClose(fridayCandles, "2026-10-18T21:00:01Z", true)
      .close,
    105,
  );
});
test("future candles and incomplete baseline candles are excluded", () => {
  const future = {
    time: "2026-10-18T21:00:00Z",
    complete: false,
    mid: { c: "110" },
  };
  assert.equal(
    session.previousSessionClose(
      [...fridayCandles, future],
      "2026-10-16T20:59:59Z",
      false,
    ).close,
    100,
  );
  assert.throws(
    () =>
      session.previousSessionClose(
        [fridayCandles[1]],
        "2026-10-16T20:59:59Z",
        false,
      ),
    /closing prices are currently unavailable/,
  );
});
test("New York session keys track the 17:00 rollover across daylight saving changes", () => {
  assert.equal(session.sessionKey("2026-10-16T20:59:59Z"), "2026-10-15");
  assert.equal(session.sessionKey("2026-10-16T21:00:00Z"), "2026-10-16");
  assert.equal(session.sessionKey("2026-11-02T21:59:59Z"), "2026-11-01");
  assert.equal(session.sessionKey("2026-11-02T22:00:00Z"), "2026-11-02");
});

test("header chart returns real candle closes for the latest session only", async () => {
  const route = load("../app/api/chart/route.ts", {
    process: {
      env: { OANDA_API_TOKEN: "chart-secret", OANDA_ENVIRONMENT: "practice" },
    },
    require: (name) => (name === "@/lib/session" ? session : require(name)),
    fetch: async (url, options) => {
      assert.match(
        url,
        /api-fxpractice\.oanda\.com\/v3\/instruments\/EUR_USD\/candles\?count=288&granularity=M5&price=M/,
      );
      assert.equal(options.headers.Authorization, "Bearer chart-secret");
      return Response.json({
        candles: [
          { time: "2026-10-15T20:55:00Z", mid: { c: "1.10" } },
          { time: "2026-10-15T21:00:00Z", mid: { c: "1.11" } },
          { time: "2026-10-16T20:55:00Z", mid: { c: "1.12" } },
        ],
      });
    },
  });
  const response = await route.GET();
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes("chart-secret"));
  const data = JSON.parse(text);
  assert.equal(data.symbol, "EUR_USD");
  assert.equal(data.interval, "M5");
  assert.equal(data.points.length, 2);
  assert.equal(data.points[0].price, 1.11);
  assert.equal(data.points[1].price, 1.12);
});

test("header chart reports upstream failure without inventing a price series", async () => {
  const route = load("../app/api/chart/route.ts", {
    process: {
      env: { OANDA_API_TOKEN: "chart-secret", OANDA_ENVIRONMENT: "practice" },
    },
    require: (name) => (name === "@/lib/session" ? session : require(name)),
    fetch: async () => new Response("", { status: 401 }),
  });
  const response = await route.GET();
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.points, undefined);
  assert.ok(!JSON.stringify(body).includes("chart-secret"));
});
