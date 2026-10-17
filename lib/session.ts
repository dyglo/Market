export type DailyCandle = {
  time: string;
  complete: boolean;
  mid: { c: string };
};

/** OANDA's daily trading session starts at 17:00 America/New_York. */
export function sessionKey(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()))
    throw new Error("OANDA quote timestamp is unavailable.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value;
  const session = new Date(
    `${value("year")}-${value("month")}-${value("day")}T00:00:00Z`,
  );
  if (Number(value("hour")) < 17) session.setUTCDate(session.getUTCDate() - 1);
  return session.toISOString().slice(0, 10);
}

export function previousSessionClose(
  candles: DailyCandle[],
  priceTime: string,
  tradeable: boolean,
) {
  const timestamp = new Date(priceTime).getTime();
  if (!Number.isFinite(timestamp))
    throw new Error("OANDA quote timestamp is unavailable.");
  const observed = candles
    .filter((c) => new Date(c.time).getTime() <= timestamp)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const current = observed.at(-1);
  // A closed Friday candle remains the current session on weekends. Exclude it
  // even though it is complete, so Friday's performance does not become zero.
  // At a live rollover the new candle can lag the quote: use the last completed
  // session in that case, rather than skipping back an extra trading day.
  const waitingForNewCandle =
    current && tradeable && sessionKey(current.time) !== sessionKey(priceTime);
  const candidates = waitingForNewCandle ? observed : observed.slice(0, -1);
  const reference = candidates.filter((c) => c.complete === true).at(-1);
  const close = Number(reference?.mid?.c);
  if (!Number.isFinite(close) || close <= 0)
    throw new Error(
      "Previous-session closing prices are currently unavailable.",
    );
  return { close, previousSessionStart: reference!.time };
}
