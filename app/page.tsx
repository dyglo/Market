"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Expand } from "lucide-react";
import { Quote, INITIAL, change, displaySymbol, money } from "@/lib/market";
type Mode = "connecting" | "simulation" | "oanda" | "reconnecting";
function MarketRow({ q, rank }: { q: Quote; rank: number }) {
  const positive = change(q) >= 0;
  return (
    <div
      className={`market-row ${q.tick > 0 ? "tick-up" : q.tick < 0 ? "tick-down" : ""}`}
      key={q.symbol}
    >
      <span className="rank">{String(rank).padStart(2, "0")}</span>
      <div className="instrument">
        <div>
          <span className="symbol">{displaySymbol(q.symbol)}</span>
          <span className={`category ${q.category.toLowerCase()}`}>
            {q.category === "OIL" ? "CRUDE OIL" : q.category}
          </span>
        </div>
        <span className="instrument-name">{q.name}</span>
      </div>
      <span className="price led" key={q.price}>
        {money(q)}
        <span
          className={`tick-direction ${q.tick < 0 ? "negative" : "positive"}`}
        >
          {q.tick < 0 ? "▾" : "▴"}
        </span>
      </span>
      <span className={`row-change led ${positive ? "positive" : "negative"}`}>
        {positive ? "+" : ""}
        {change(q).toFixed(2)}
        <small>%</small>
      </span>
    </div>
  );
}
export default function Board() {
  const [quotes, setQuotes] = useState<Quote[]>([]),
    [mode, setMode] = useState<Mode>("connecting"),
    [lastTick, setLastTick] = useState<Date | null>(null),
    [fullscreen, setFullscreen] = useState(false),
    [idle, setIdle] = useState(false),
    [error, setError] = useState(""),
    [sourceEnvironment, setSourceEnvironment] = useState("practice");
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
      setLastTick(new Date());
      setSourceEnvironment(data.environment);
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
        setLastTick(new Date());
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
  const gainers = quotes
    .filter((q) => change(q) >= 0)
    .sort((a, b) => change(b) - change(a));
  const losers = quotes
    .filter((q) => change(q) < 0)
    .sort((a, b) => change(a) - change(b));
  const marketClosed =
    quotes.length > 0 && quotes.every((q) => q.tradeable === false);
  const feedStatus =
    mode === "simulation"
      ? "SIMULATED"
      : mode === "connecting"
        ? "CONNECTING TO OANDA"
        : mode === "reconnecting"
          ? "OANDA · RECONNECTING"
          : `OANDA · ${sourceEnvironment.toUpperCase()}${marketClosed ? " · MARKET CLOSED" : ""}`;
  return (
    <main className={`terminal ${idle ? "cursor-hidden" : ""}`}>
      {error && (
        <div className="feed-error" role="status">
          {error}
        </div>
      )}
      <section className="split-board" aria-label="Market prices">
        {[
          { title: "GAINERS", data: gainers, positive: true },
          { title: "LOSERS", data: losers, positive: false },
        ].map((side) => (
          <div
            className={`board-side ${side.positive ? "gaining" : "losing"}`}
            key={side.title}
          >
            <div className="side-heading">
              <div>
                {side.positive ? (
                  <ArrowUpRight size={20} />
                ) : (
                  <ArrowDownRight size={20} />
                )}
                <h2>{side.title}</h2>
                <span className="count">
                  {String(side.data.length).padStart(2, "0")}
                </span>
              </div>
            </div>
            <div className="column-labels">
              <span>#</span>
              <span>INSTRUMENT</span>
              <span>LAST PRICE</span>
              <span title="Change from the previous OANDA session close (17:00 New York)">
                CHANGE %
              </span>
            </div>
            <div className="rows">
              {side.data.length ? (
                side.data.map((q, i) => (
                  <MarketRow q={q} rank={i + 1} key={q.symbol} />
                ))
              ) : (
                <div className="empty-state">
                  {mode === "connecting"
                    ? "Connecting to OANDA…"
                    : mode === "reconnecting" && !quotes.length
                      ? "Waiting for OANDA prices…"
                      : `No ${side.title.toLowerCase()} to display.`}
                </div>
              )}
            </div>
          </div>
        ))}
      </section>
      <div
        className="kiosk-status"
        role="status"
        title={
          lastTick
            ? `Last update ${lastTick.toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC`
            : undefined
        }
      >
        {feedStatus}
      </div>
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
