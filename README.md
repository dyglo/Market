# TICKER · Global Market Board

A Next.js 16 market display for TVs and monitors. A full-width split board ranks gainers and losers by daily percentage change, with FX, gold, Brent and WTI, amber LED prices and tick flashes. The screen contains only the quotation board on black, with a small feed status and controls that hide when idle.

## Run

Node.js 20.9+ required.

```sh
npm install
npm run dev
```

Open http://localhost:3000. Press **F** for native fullscreen, **S** for connection settings, and **Escape** to close settings or exit fullscreen. The mouse cursor hides after 3.5 seconds of inactivity. Market filters are available inside settings. Reduced-motion preferences disable animations.

## OANDA

On startup the board checks the server connection before showing prices. If server credentials are absent, clearly labelled simulation starts; demo prices are illustrative, not current market quotes. Server configuration is checked again every 15 seconds until connected. Configured connections that fail show the error and retry without generating mock prices. Open settings to connect a practice/live account. Credentials entered here stay in React memory and travel only to the same-origin backend, then to the selected OANDA API. They are never written to local/session storage, cookies or files, and clear on reload. Always serve over HTTPS.

For an unattended display, configure server environment variables in Vercel and redeploy:

- `OANDA_ACCOUNT_ID`
- `OANDA_API_TOKEN` (Sensitive)
- `OANDA_ENVIRONMENT` (`practice` or `live`)

The backend uses read-only OANDA endpoints and never exposes server credentials or account details. The public market endpoint intentionally returns only price data. OANDA instruments vary by jurisdiction and account; unavailable instruments are omitted. Live data polls every 5 seconds; daily change compares midpoint with the current daily candle open aligned to 00:00 UTC. Baselines cache for at most 60 seconds. Trends show received midpoint ticks, not historical candles. Feed failures retain and label stale prices while reconnecting. When all returned instruments are non-tradeable, the board explicitly shows MARKET CLOSED; these are OANDA quotes, not simulated ticks. No trading endpoints are implemented.

## Validation

```sh
npm test
npm run typecheck
npm run build
```
