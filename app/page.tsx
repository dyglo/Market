"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Expand,
  Globe2,
  LockKeyhole,
  Radio,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Unplug,
  X,
} from "lucide-react";
import {
  Category,
  Quote,
  INITIAL,
  change,
  displaySymbol,
  money,
} from "@/lib/market";
type Credentials = {
  accountId: string;
  token: string;
  environment: "practice" | "live";
};
type Mode = "simulation" | "oanda" | "reconnecting";
function Sparkline({ quote }: { quote: Quote }) {
  const h = quote.history,
    min = Math.min(...h),
    range = Math.max(...h) - min || 1;
  return (
    <svg className="spark" viewBox="0 0 100 30" aria-label="Recent price trend">
      <path
        d={`M ${h.map((v, i) => `${(i * 100) / (h.length - 1)},${26 - ((v - min) / range) * 22}`).join(" L ")}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
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
      <span className="price led">
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
      <div className={positive ? "positive trend" : "negative trend"}>
        <Sparkline quote={q} />
      </div>
    </div>
  );
}
export default function Board() {
  const [quotes, setQuotes] = useState(INITIAL),
    [filter, setFilter] = useState<Category | "ALL">("ALL"),
    [mode, setMode] = useState<Mode>("simulation"),
    [time, setTime] = useState<Date | null>(null),
    [lastTick, setLastTick] = useState<Date | null>(null),
    [modal, setModal] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [idle, setIdle] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [environment, setEnvironment] = useState<"practice" | "live">("practice"),
    [accountId, setAccountId] = useState(""),
    [token, setToken] = useState(""),
    [sourceEnvironment, setSourceEnvironment] = useState("practice");
  const credentials = useRef<Credentials | null>(null),
    connected = useRef(false),
    dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null),
    requestId = useRef(0);
  const applyQuotes = useCallback(
    (data: { quotes: Quote[]; environment: string }) => {
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
  const fetchPrices = useCallback(async (c: Credentials | null) => {
    const res = await fetch("/api/market", {
      method: c ? "POST" : "GET",
      headers: c ? { "Content-Type": "application/json" } : undefined,
      body: c ? JSON.stringify(c) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to connect to OANDA.");
    return data;
  }, []);
  useEffect(() => {
    let active = true;
    const id = requestId.current;
    fetchPrices(null)
      .then((data) => {
        if (active && id === requestId.current) applyQuotes(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [fetchPrices, applyQuotes]);
  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
      if (!connected.current) {
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
    if (mode === "simulation") return;
    let active = true;
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      const id = requestId.current;
      try {
        const data = await fetchPrices(credentials.current);
        if (active && id === requestId.current) {
          applyQuotes(data);
          setError("");
        }
      } catch {
        if (active && id === requestId.current) {
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
      if (e.key.toLowerCase() === "f" && !modal) {
        e.preventDefault();
        toggleFullscreen();
      }
      if (e.key.toLowerCase() === "s") setModal(true);
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
  }, [modal, toggleFullscreen]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else if (dialog.current?.open) {
      dialog.current.close();
      setToken("");
      opener.current?.focus();
    }
  }, [modal]);
  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const id = ++requestId.current;
    try {
      const c = {
        accountId: accountId.trim(),
        token: token.trim(),
        environment,
      };
      const data = await fetchPrices(c);
      if (id !== requestId.current) return;
      credentials.current = c;
      applyQuotes(data);
      setToken("");
      setModal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  };
  const simulate = () => {
    requestId.current++;
    credentials.current = null;
    connected.current = false;
    setMode("simulation");
    setQuotes(INITIAL);
    setError("");
    setModal(false);
  };
  const visible = quotes.filter(
      (q) => filter === "ALL" || q.category === filter,
    ),
    gainers = visible
      .filter((q) => change(q) >= 0)
      .sort((a, b) => change(b) - change(a)),
    losers = visible
      .filter((q) => change(q) < 0)
      .sort((a, b) => change(a) - change(b));
  const avg = visible.length
    ? visible.reduce((v, q) => v + change(q), 0) / visible.length
    : 0;
  return (
    <main className={`terminal ${idle && !modal ? "cursor-hidden" : ""}`}>
      <header className="terminal-bar">
        <a className="brand" href="/" aria-label="Ticker market board">
          <span className="brand-icon">
            <Activity size={19} />
          </span>
          TICKER
          <span className="brand-divider" />
          <span className="brand-sub">GLOBAL MARKET BOARD</span>
        </a>
        <div className="terminal-tools">
          <span
            className={`feed-badge ${mode === "reconnecting" ? "warning" : ""}`}
          >
            <i />
            {mode === "simulation"
              ? "SIMULATED FEED"
              : mode === "reconnecting"
                ? "RECONNECTING"
                : `OANDA ${sourceEnvironment.toUpperCase()}`}
          </span>
          <span className="tool-divider" />
          <button
            onClick={toggleFullscreen}
            title="Toggle fullscreen (F)"
            aria-label="Toggle fullscreen"
          >
            <Expand size={16} />
            <span className="keycap">F</span>
          </button>
          <button
            ref={opener}
            onClick={() => {
              setError("");
              setModal(true);
            }}
            title="Settings (S)"
            aria-label="Open settings"
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>
      <section className="board-heading">
        <div className="heading-left">
          <div className="eyebrow">
            <span className="tiny-cross">+</span> THE WORLD, AT A GLANCE
          </div>
          <h1>
            Every tick. <span>Every opportunity.</span>
          </h1>
          <p>Forex, precious metals & energy. One uninterrupted view.</p>
        </div>
        <div className="clock">
          <div>
            <Globe2 size={12} /> UNIVERSAL TIME
          </div>
          <time>
            {time
              ? time.toLocaleTimeString("en-GB", { timeZone: "UTC" })
              : "--:--:--"}
            <small>UTC</small>
          </time>
          <span>
            {time
              ? time
                  .toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  })
                  .toUpperCase()
              : "GLOBAL MARKETS · 24 / 5"}
          </span>
        </div>
      </section>
      <section className="board-controls" aria-label="Market filters">
        <div className="filters">
          {(["ALL", "FX", "GOLD", "OIL"] as const).map((f) => (
            <button
              key={f}
              className={filter === f ? "active" : ""}
              onClick={() => setFilter(f)}
            >
              {f === "ALL"
                ? "All markets"
                : f === "FX"
                  ? "Forex"
                  : f === "GOLD"
                    ? "Gold"
                    : "Crude oil"}
              <span>
                {f === "ALL"
                  ? quotes.length
                  : quotes.filter((q) => q.category === f).length}
              </span>
            </button>
          ))}
        </div>
        <div className="sort-note">
          <SlidersHorizontal size={12} /> SORTED BY DAILY CHANGE{" "}
          <ChevronDown size={12} />
        </div>
      </section>
      {error && !modal && (
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
              <span>
                {side.positive ? "LEADING THE MARKET" : "UNDER PRESSURE"}
              </span>
            </div>
            <div className="column-labels">
              <span>#</span>
              <span>INSTRUMENT</span>
              <span>LAST PRICE</span>
              <span>CHANGE %</span>
              <span className="trend-label">TREND</span>
            </div>
            <div className="rows">
              {side.data.length ? (
                side.data.map((q, i) => (
                  <MarketRow q={q} rank={i + 1} key={q.symbol} />
                ))
              ) : (
                <div className="empty-state">
                  No {side.title.toLowerCase()} in this category.
                </div>
              )}
            </div>
            <div className="side-bottom">
              <span>
                {side.positive ? (
                  <ArrowUp size={12} />
                ) : (
                  <ArrowDown size={12} />
                )}{" "}
                {side.data.length} INSTRUMENTS{" "}
                {side.positive ? "ADVANCING" : "DECLINING"}
              </span>
              <span>{side.positive ? "HIGH → LOW" : "LOW → HIGH"}</span>
            </div>
          </div>
        ))}
      </section>
      <section className="market-summary">
        <div className="summary-title">
          <Activity size={17} />
          <span>
            MARKET
            <br />
            <b>PULSE</b>
          </span>
        </div>
        <div className="breadth">
          <div>
            <span>MARKET BREADTH</span>
            <b>
              <em className="positive">{gainers.length} advancing</em>
              <i>/</i>
              <em className="negative">{losers.length} declining</em>
            </b>
          </div>
          <div className="breadth-bar">
            <span
              style={{
                width: `${visible.length ? (gainers.length / visible.length) * 100 : 50}%`,
              }}
            />
          </div>
        </div>
        <div className="summary-stat">
          <span>AVERAGE CHANGE</span>
          <b className={`led ${avg >= 0 ? "positive" : "negative"}`}>
            {avg >= 0 ? "+" : ""}
            {avg.toFixed(2)}
            <small>%</small>
          </b>
        </div>
        <div className="summary-stat leader">
          <span>TOP MOVER</span>
          {visible.length > 0 && (
            <b className="led amber">
              {displaySymbol(
                [...visible].sort(
                  (a, b) => Math.abs(change(b)) - Math.abs(change(a)),
                )[0].symbol,
              )}
            </b>
          )}
        </div>
        <div className="session-note">
          <span className="session-dot" />
          <div>
            <b>{mode === "simulation" ? "DEMO SESSION" : "OANDA PRICING"}</b>
            <span>
              {mode === "simulation"
                ? "Realistic ticks. Zero risk."
                : mode === "reconnecting"
                  ? "Awaiting feed recovery"
                  : "Read-only market connection"}
            </span>
          </div>
        </div>
      </section>
      <div className="ticker-tape" aria-label="Price ticker">
        <div>
          {[...quotes, ...quotes].map((q, i) => (
            <span className="tape-item" key={`${q.symbol}${i}`}>
              <b>{displaySymbol(q.symbol).replaceAll(" / ", "/")}</b>
              <span className="led">{money(q)}</span>
              <span className={change(q) >= 0 ? "positive" : "negative"}>
                {change(q) >= 0 ? "▴" : "▾"} {Math.abs(change(q)).toFixed(2)}%
              </span>
              <i>✦</i>
            </span>
          ))}
        </div>
      </div>
      <footer>
        <span>
          <i className="status-dot" />
          {mode === "simulation"
            ? "SIMULATED DATA · FOR DISPLAY PURPOSES"
            : mode === "reconnecting"
              ? "FEED INTERRUPTED · PRICES MAY BE STALE"
              : "OANDA DATA · DAILY CHANGE FROM 00:00 UTC"}
        </span>
        <span className="footer-center">BUILT FOR THE BIG PICTURE.</span>
        <span>
          LAST TICK{" "}
          <b>
            {lastTick
              ? lastTick.toLocaleTimeString("en-GB", { timeZone: "UTC" })
              : "--:--:--"}
          </b>
          <span className="footer-fullscreen">
            <span className="keycap">F</span> {fullscreen ? "EXIT" : "ENTER"}{" "}
            FULLSCREEN
          </span>
        </span>
      </footer>
      <dialog
        ref={dialog}
        aria-label="OANDA connection settings"
        className="settings-modal"
        onCancel={() => setModal(false)}
        onClick={(e) => {
          if (e.target === dialog.current) setModal(false);
        }}
      >
        <div className="modal-inner">
          <button
            className="close-modal"
            aria-label="Close settings"
            onClick={() => setModal(false)}
          >
            <X size={20} />
          </button>
          <div className="modal-icon">
            <Radio size={22} />
          </div>
          <div className="eyebrow">YOUR MARKET CONNECTION</div>
          <h2>Connect the dots.</h2>
          <p>Connect your OANDA account for live market prices.</p>
          <div className="security-note">
            <ShieldCheck size={17} />
            <span>
              Read-only connection. Your token is never saved in browser
              storage. Session credentials clear on reload.
            </span>
          </div>
          <form onSubmit={connect}>
            <label>ENVIRONMENT</label>
            <div className="environment-toggle">
              {(["practice", "live"] as const).map((env) => (
                <button
                  type="button"
                  key={env}
                  onClick={() => setEnvironment(env)}
                  className={environment === env ? "selected" : ""}
                >
                  {environment === env && <Check size={13} />}{" "}
                  {env === "practice" ? "Practice" : "Live"}
                </button>
              ))}
            </div>
            <label htmlFor="account">ACCOUNT ID</label>
            <input
              id="account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="001-001-1234567-001"
              required
              autoComplete="off"
              maxLength={100}
            />
            <label htmlFor="token">
              API ACCESS TOKEN <LockKeyhole size={11} />
            </label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your personal access token"
              required
              autoComplete="off"
              maxLength={300}
            />
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="connect-button" disabled={busy} type="submit">
              {busy ? "Connecting…" : "Connect to OANDA"}
              <ArrowUpRight size={16} />
            </button>
          </form>
          <button className="demo-button" onClick={simulate}>
            <Unplug size={14} /> Use simulated data
          </button>
          <div className="server-note">
            <LockKeyhole size={12} />
            <p>
              For an always-on display, add <code>OANDA_ACCOUNT_ID</code>,{" "}
              <code>OANDA_API_TOKEN</code> and <code>OANDA_ENVIRONMENT</code> in{" "}
              <a
                href="https://vercel.com/next-q/ticker-market-board/settings/environment-variables"
                target="_blank"
                rel="noreferrer"
              >
                Vercel settings ↗
              </a>
              , then redeploy. Server credentials are never sent to this
              browser.
            </p>
          </div>
        </div>
      </dialog>
    </main>
  );
}
