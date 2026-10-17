# TAFOREX · Global Market Board

A Next.js 16 market display for TVs and monitors. A full-screen exchange-style board displays FX, gold, Brent and WTI together in three stable columns. Prices and percentage changes are green or red according to the previous-session change, with momentary tick flashes. The central header shows a Kampala clock and date (Africa/Kampala, EAT). Its chart alternates every 15 seconds between the top daily gainer and top daily loser, recomputing leaders on each price update. Both leaders’ real OANDA five-minute charts refresh every 30 seconds, with the current midpoint appended between candle updates. TAFOREX appears at the top right without an icon. The fullscreen control hides when idle.

## Run

Node.js 20.9+ required.

```sh
npm install
npm run dev
```

Open http://localhost:3000. Press **F** for native fullscreen and **Escape** to exit fullscreen. The mouse cursor hides after 3.5 seconds of inactivity. Reduced-motion preferences disable animations.

## OANDA

On startup the board checks the server connection before showing prices. If server credentials are absent, clearly labelled simulation starts; demo prices are illustrative, not current market quotes. Server configuration is checked again every 15 seconds until connected. Configured connections that fail show the error and retry without generating mock prices. The board connects automatically using server-side Vercel environment variables. There are no credential inputs or settings controls in the browser. Always serve over HTTPS.

For an unattended display, configure server environment variables in Vercel and redeploy:

- `OANDA_ACCOUNT_ID`
- `OANDA_API_TOKEN` (Sensitive)
- `OANDA_ENVIRONMENT` (`practice` or `live`)

The backend uses read-only OANDA endpoints and never exposes server credentials or account details. The public market endpoint intentionally returns only price data. OANDA instruments vary by jurisdiction and account; unavailable instruments are omitted. Live data polls every 5 seconds; the central chart refreshes every 30 seconds and includes candles from the latest OANDA trading session only. Chart failures display an unavailable message without generating replacement data. daily change is `(current midpoint / previous session close - 1) * 100`. Daily candles use OANDA’s 17:00 America/New_York session boundary, including daylight saving changes. The baseline is the completed session before the quote’s session, including on weekends when the latest candle is also complete. Quote timestamps and reference-session starts are included in the API for auditing. Baselines cache for at most 60 seconds and invalidate when the quote enters a new trading session. Feed failures retain and label stale prices while reconnecting. When all returned instruments are non-tradeable, the board explicitly shows MARKET CLOSED; these are OANDA quotes, not simulated ticks. No trading endpoints are implemented.

## Validation

```sh
npm test
npm run typecheck
npm run build
```
