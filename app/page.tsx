"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Expand,
  LockKeyhole,
  Settings2,
  ShieldCheck,
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
    [filter, setFilter] = useState<Category | "ALL">("ALL"),
    [mode, setMode] = useState<Mode>("connecting"),
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
    requestId = useRef(0),
    serverEnabled = useRef(true),
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
  const fetchPrices = useCallback(async (c: Credentials | null) => {
    const res = await fetch("/api/market", {
      method: c ? "POST" : "GET",
      headers: c ? { "Content-Type": "application/json" } : undefined,
      body: c ? JSON.stringify(c) : undefined,
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
      if (!serverEnabled.current || connected.current) return;
      const id = requestId.current;
      try {
        const data = await fetchPrices(null);
        if (active && id === requestId.current && serverEnabled.current) {
          applyQuotes(data);
          setError("");
        }
      } catch (failure) {
        if (!active || id !== requestId.current || !serverEnabled.current)
          return;
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
      if (active && !connected.current && serverEnabled.current)
        retry = setTimeout(attempt, 15000);
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
      serverEnabled.current = false;
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
    serverEnabled.current = false;
    simulating.current = true;
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
    <main className={`terminal ${idle && !modal ? "cursor-hidden" : ""}`}>
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
                      : `No ${side.title.toLowerCase()} in this category.`}
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
        <button
          ref={opener}
          onClick={() => setModal(true)}
          title="Settings (S)"
          aria-label="Open settings"
        >
          <Settings2 size={16} />
        </button>
      </div>
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
          <h2>OANDA settings</h2>
          <p className="connection-status">{feedStatus}</p>
          {error && (
            <div className="form-error" role="status">
              {error}
            </div>
          )}
          <label className="filter-label" htmlFor="market-filter">
            DISPLAY
          </label>
          <select
            id="market-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Category | "ALL")}
          >
            <option value="ALL">All markets</option>
            <option value="FX">Forex</option>
            <option value="GOLD">Gold</option>
            <option value="OIL">Crude oil</option>
          </select>
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
