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
function api(fetch, env = {}) {
  return load("../app/api/market/route.ts", {
    fetch,
    process: { env },
    require: (name) => (name === "@/lib/market" ? market : require(name)),
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
test("OANDA midpoint and UTC daily baseline replace simulation with only available instruments", async () => {
  const calls = [];
  const route = api(async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, "Bearer test-private-token");
    assert.ok(url.startsWith("https://api-fxpractice.oanda.com/v3/"));
    let body;
    if (url.includes("/instruments/")) {
      assert.match(url, /dailyAlignment=0&alignmentTimezone=UTC/);
      body = { candles: [{ mid: { o: "1.10000" } }] };
    } else if (url.includes("/pricing?"))
      body = {
        prices: [
          {
            instrument: "EUR_USD",
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
  assert.equal(data.quotes[0].open, 1.1);
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
        return Response.json({ candles: [{ mid: { o: "4100" } }] });
      if (url.includes("/pricing?"))
        return Response.json({
          prices: [
            {
              instrument: "XAU_USD",
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
  assert.equal(data.quotes[0].open, 4100);
});
