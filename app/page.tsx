"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Expand } from "lucide-react";
import {
  Quote,
  INITIAL,
  change,
  displaySymbol,
  money,
  topMovers,
} from "@/lib/market";
import { sessionKey } from "@/lib/session";
type Mode = "connecting" | "simulation" | "oanda" | "reconnecting";
type ChartPoint = { time: string; price: number };
function MarketRow({ q }: { q: Quote }) {
  const positive = change(q) >= 0;
  return (
    <div
      className={`market-row ${positive ? "positive" : "negative"} ${q.tick > 0 ? "tick-up" : q.tick < 0 ? "tick-down" : ""}`}
    >
      <div className="instrument">
        <span className="symbol">
          {displaySymbol(q.symbol).replaceAll(" / ", "/")}
        </span>
        <span className="category">
          {q.category === "OIL" ? "CRUDE OIL" : q.category}
        </span>
      </div>
      <span className="price" key={q.price}>
        {money(q)}
      </span>
      <span
        className="row-change"
        title="Change from the previous OANDA session close"
      >
        {positive ? "+" : ""}
        {change(q).toFixed(2)}
        <small>%</small>
      </span>
    </div>
  );
}
function SessionChart({
  points,
  unavailable,
  quote,
  role,
}: {
  points: ChartPoint[];
  unavailable: boolean;
  quote?: Quote;
  role: "gainer" | "loser";
}) {
  const prices = points.map((p) => p.price),
    low = Math.min(...prices),
    high = Math.max(...prices),
    padding = (high - low) * 0.15 || 0.0001,
    min = low - padding,
    max = high + padding;
  const line = points
    .map(
      (p, i) =>
        `${(i / Math.max(1, points.length - 1)) * 420},${120 - ((p.price - min) / (max - min)) * 116}`,
    )
    .join(" L ");
  const rising = quote ? change(quote) >= 0 : true;
  const symbol = quote
    ? displaySymbol(quote.symbol).replaceAll(" / ", "/")
    : "";
  const first = points[0],
    last = points.at(-1);
  const label = (p: ChartPoint) =>
    new Date(p.time).toLocaleTimeString("en-US", {
      timeZone: "Africa/Kampala",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return (
    <div className={`session-chart ${rising ? "positive" : "negative"}`}>
      <div className="chart-caption">
        <span>
          {quote
            ? `TOP ${role.toUpperCase()} · ${symbol} ${change(quote) >= 0 ? "+" : ""}${change(quote).toFixed(2)}%`
            : "TOP MOVERS"}
        </span>
        <span>
          {unavailable && points.length > 1
            ? "5 MIN · LAST RECEIVED"
            : "5 MIN · EAT"}
        </span>
      </div>
      {points.length > 1 ? (
        <>
          <div className="chart-plot">
            <div className="chart-axis">
              {[max, (max + min) / 2, min].map((v) => (
                <span key={v}>
                  {v.toFixed(
                    quote?.digits === 2 ? 2 : quote?.digits === 3 ? 3 : 4,
                  )}
                </span>
              ))}
            </div>
            <svg
              viewBox="0 0 420 124"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${symbol} intraday price chart · top ${role}`}
            >
              <defs>
                <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="currentColor"
                    stopOpacity=".58"
                  />
                  <stop
                    offset="100%"
                    stopColor="currentColor"
                    stopOpacity=".1"
                  />
                </linearGradient>
              </defs>
              {[1, 62, 123].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="420"
                  y1={y}
                  y2={y}
                  stroke="#ffffff18"
                  strokeWidth=".5"
                />
              ))}
              <path
                d={`M 0,124 L ${line} L 420,124 Z`}
                fill="url(#chart-fill)"
              />
              <path
                d={`M ${line}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
          <div className="chart-times">
            <span>{label(first)}</span>
            <span>{label(last!)}</span>
          </div>
        </>
      ) : (
        <div className="chart-placeholder">
          {unavailable
            ? "Chart temporarily unavailable"
            : "Loading session chart…"}
        </div>
      )}
    </div>
  );
}
export default function Board() {
  const [quotes, setQuotes] = useState<Quote[]>([]),
    [clock, setClock] = useState<Date | null>(null),
    [chartSeries, setChartSeries] = useState<
      Record<string, { points: ChartPoint[]; unavailable: boolean }>
    >({}),
    [chartRole, setChartRole] = useState<"gainer" | "loser">("gainer"),
    [mode, setMode] = useState<Mode>("connecting"),
    [fullscreen, setFullscreen] = useState(false),
    [idle, setIdle] = useState(false),
    [error, setError] = useState("");
  const connected = useRef(false),
    simulating = useRef(false);
  const applyQuotes = useCallback(
    (data: { quotes: Quote[]; environment: string }) => {
      simulating.current = false;
      const wasConnected = connected.current;
      setQuotes((prev) =>
        data.quotes.map((q) => {
          const old = wasConnected
            ? prev.find((p) => p.symbol === q.symbol)
            : undefined;
          return {
            ...q,
            tick: old ? Math.sign(q.price - old.price) : 0,
            history: old ? [...old.history.slice(-31), q.price] : q.history,
          };
        }),
      );
      setMode("oanda");
      connected.current = true;
    },
    [],
  );
  const fetchPrices = useCallback(async () => {
    const res = await fetch("/api/market", {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    if (!res.ok)
      throw Object.assign(
        new Error(data.error || "Unable to connect to OANDA."),
        { code: data.code },
      );
    return data;
  }, []);
  useEffect(() => {
    let active = true;
    let retry: ReturnType<typeof setTimeout>;
    const attempt = async () => {
      if (connected.current) return;
      try {
        const data = await fetchPrices();
        if (active) {
          applyQuotes(data);
          setError("");
        }
      } catch (failure) {
        if (!active) return;
        if ((failure as { code?: string }).code === "NOT_CONFIGURED") {
          if (!simulating.current) setQuotes(INITIAL);
          simulating.current = true;
          setMode("simulation");
          setError("");
        } else {
          simulating.current = false;
          setQuotes([]);
          setMode("reconnecting");
          setError(
            failure instanceof Error
              ? failure.message
              : "OANDA connection failed. Retrying automatically.",
          );
        }
      }
      if (active && !connected.current) retry = setTimeout(attempt, 15000);
    };
    attempt();
    return () => {
      active = false;
      clearTimeout(retry);
    };
  }, [fetchPrices, applyQuotes]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (simulating.current) {
        setQuotes((prev) =>
          prev.map((q) => {
            if (Math.random() > 0.55) return { ...q, tick: 0 };
            const price = q.price * (1 + (Math.random() - 0.5) * 0.00012);
            return {
              ...q,
              price,
              tick: Math.sign(price - q.price),
              history: [...q.history.slice(-31), price],
            };
          }),
        );
      }
    }, 1300);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!connected.current) return;
    let active = true;
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await fetchPrices();
        if (active) {
          applyQuotes(data);
          setError("");
        }
      } catch {
        if (active) {
          setMode("reconnecting");
          setError(
            "Price feed interrupted. Showing last received prices; retrying automatically.",
          );
        }
      } finally {
        pending = false;
      }
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [mode, fetchPrices, applyQuotes]);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError(
        "Fullscreen is unavailable in this browser. Use your browser’s fullscreen control.",
      );
    }
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const move = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 3500);
    };
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,select,textarea")) return;
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    const full = () => setFullscreen(Boolean(document.fullscreenElement));
    move();
    window.addEventListener("pointermove", move);
    window.addEventListener("keydown", key);
    document.addEventListener("fullscreenchange", full);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", key);
      document.removeEventListener("fullscreenchange", full);
    };
  }, [toggleFullscreen]);
  useEffect(() => {
    setClock(new Date());
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const movers = topMovers(quotes);
  const leaderSymbols = [movers.gainer?.symbol, movers.loser?.symbol]
    .filter(Boolean)
    .join(",");
  useEffect(() => {
    const timer = setInterval(
      () => setChartRole((role) => (role === "gainer" ? "loser" : "gainer")),
      15000,
    );
    return () => clearInterval(timer);
  }, []);
  const quoteSession = quotes[0]?.priceTime
    ? sessionKey(quotes[0].priceTime)
    : "";
  useEffect(() => {
    if (!leaderSymbols || mode === "simulation") return;
    let active = true;
    const controllers = new Set<AbortController>();
    const update = async () => {
      await Promise.all(
        leaderSymbols.split(",").map(async (symbol) => {
          const controller = new AbortController();
          controllers.add(controller);
          const timeout = setTimeout(() => controller.abort(), 15000);
          try {
            const response = await fetch(
              `/api/chart?symbol=${encodeURIComponent(symbol)}`,
              { cache: "no-store", signal: controller.signal },
            );
            if (!response.ok) throw new Error("Chart unavailable");
            const data = await response.json();
            if (active && data.symbol === symbol)
              setChartSeries((prev) => ({
                ...prev,
                [symbol]: { points: data.points, unavailable: false },
              }));
          } catch {
            if (active)
              setChartSeries((prev) => ({
                ...prev,
                [symbol]: {
                  points: prev[symbol]?.points || [],
                  unavailable: true,
                },
              }));
          } finally {
            clearTimeout(timeout);
            controllers.delete(controller);
          }
        }),
      );
    };
    update();
    const timer = setInterval(update, 30000);
    return () => {
      active = false;
      clearInterval(timer);
      controllers.forEach((controller) => controller.abort());
    };
  }, [leaderSymbols, mode, quoteSession]);
  const chartQuote =
    (chartRole === "gainer" ? movers.gainer : movers.loser) ||
    movers.gainer ||
    movers.loser;
  const displayedRole =
    chartQuote && change(chartQuote) < 0 ? "loser" : "gainer";
  const series = chartQuote ? chartSeries[chartQuote.symbol] : undefined;
  let chartPoints = series?.points || [];
  if (
    chartPoints.length &&
    chartQuote?.priceTime &&
    mode !== "simulation" &&
    sessionKey(chartQuote.priceTime) === sessionKey(chartPoints.at(-1)!.time) &&
    Date.parse(chartQuote.priceTime) >= Date.parse(chartPoints.at(-1)!.time)
  ) {
    chartPoints = [
      ...chartPoints,
      { time: chartQuote.priceTime, price: chartQuote.price },
    ];
  }
  const order = [
    "EUR_USD",
    "USD_JPY",
    "GBP_USD",
    "USD_CHF",
    "AUD_USD",
    "USD_CAD",
    "NZD_USD",
    "EUR_GBP",
    "EUR_JPY",
    "GBP_JPY",
    "EUR_CHF",
    "AUD_JPY",
    "AUD_NZD",
    "XAU_USD",
    "BCO_USD",
    "WTICO_USD",
  ];
  const ordered = [...quotes].sort(
    (a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol),
  );
  const columns = [
    ordered.slice(0, 6),
    ordered.slice(6, 11),
    ordered.slice(11),
  ];
  return (
    <main className={`terminal ${idle ? "cursor-hidden" : ""}`}>
      {error && (
        <div className="feed-error" role="status">
          {error}
        </div>
      )}
      <section
        className="exchange-board"
        aria-label="Forex and commodities market prices"
      >
        {columns.map((column, index) => (
          <section
            className={`quote-column column-${index}`}
            key={index}
            aria-label={`Market column ${index + 1}`}
          >
            {index === 0 && <div className="board-spacer" aria-hidden="true" />}
            {index === 1 && (
              <div className="center-heading">
                <div className="exchange-clock">
                  {clock
                    ? clock.toLocaleTimeString("en-GB", {
                        timeZone: "Africa/Kampala",
                      })
                    : "--:--:--"}
                  <small>EAT</small>
                </div>
                <div className="exchange-date">
                  {clock
                    ? clock.toLocaleDateString("en-US", {
                        timeZone: "Africa/Kampala",
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                    : " "}
                </div>
                <SessionChart
                  points={chartPoints}
                  unavailable={series?.unavailable || false}
                  quote={chartQuote}
                  role={displayedRole}
                />
              </div>
            )}
            {index === 2 && <div className="exchange-brand">TAFOREX</div>}
            <div className="quote-list">
              {column.map((q) => (
                <MarketRow q={q} key={q.symbol} />
              ))}
              {!quotes.length && (
                <div className="empty-state">
                  {mode === "connecting"
                    ? "Connecting…"
                    : "Waiting for prices…"}
                </div>
              )}
            </div>
          </section>
        ))}
      </section>
      {mode === "simulation" && (
        <div className="simulation-warning" role="status">
          SIMULATED DATA
        </div>
      )}
      <div className={`kiosk-controls ${idle ? "controls-hidden" : ""}`}>
        <button
          onClick={toggleFullscreen}
          title="Fullscreen (F)"
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          <Expand size={16} />
        </button>
      </div>
    </main>
  );
}
