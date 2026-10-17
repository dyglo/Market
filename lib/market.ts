export type Category = "FX" | "GOLD" | "OIL";
export type Quote = {
  symbol: string;
  name: string;
  category: Category;
  price: number;
  previousClose: number;
  priceTime?: string;
  previousSessionStart?: string;
  digits: number;
  history: number[];
  tick: number;
  tradeable?: boolean;
};
const instruments: [string, string, Category, number, number, number][] = [
  ["XAU_USD", "Gold / US Dollar", "GOLD", 2673.42, 1.82, 2],
  ["GBP_JPY", "British Pound / Japanese Yen", "FX", 195.634, 1.24, 3],
  ["AUD_USD", "Australian Dollar / US Dollar", "FX", 0.66482, 0.96, 5],
  ["EUR_USD", "Euro / US Dollar", "FX", 1.08654, 0.74, 5],
  ["NZD_USD", "New Zealand Dollar / US Dollar", "FX", 0.60437, 0.62, 5],
  ["GBP_USD", "British Pound / US Dollar", "FX", 1.29876, 0.48, 5],
  ["EUR_JPY", "Euro / Japanese Yen", "FX", 163.684, 0.35, 3],
  ["AUD_JPY", "Australian Dollar / Japanese Yen", "FX", 100.147, 0.21, 3],
  ["BCO_USD", "Brent Crude Oil", "OIL", 74.36, -2.14, 2],
  ["WTICO_USD", "West Texas Intermediate", "OIL", 70.82, -1.76, 2],
  ["USD_JPY", "US Dollar / Japanese Yen", "FX", 150.642, -1.12, 3],
  ["USD_CHF", "US Dollar / Swiss Franc", "FX", 0.86543, -0.89, 5],
  ["USD_CAD", "US Dollar / Canadian Dollar", "FX", 1.38124, -0.67, 5],
  ["EUR_GBP", "Euro / British Pound", "FX", 0.83662, -0.43, 5],
  ["EUR_CHF", "Euro / Swiss Franc", "FX", 0.94036, -0.28, 5],
  [
    "AUD_NZD",
    "Australian Dollar / New Zealand Dollar",
    "FX",
    1.10005,
    -0.15,
    5,
  ],
];
export const INITIAL: Quote[] = instruments.map(
  ([symbol, name, category, price, pct, digits], i) => ({
    symbol,
    name,
    category,
    price,
    previousClose: price / (1 + pct / 100),
    digits,
    tick: 0,
    history: Array.from(
      { length: 32 },
      (_, j) =>
        price *
        (1 +
          (Math.sin(j * 1.8 + i) * 0.0004 +
            (j - 31) * (pct > 0 ? 0.000035 : -0.000035))),
    ),
  }),
);
export const change = (q: Quote) => (q.price / q.previousClose - 1) * 100;
export const displaySymbol = (s: string) =>
  s === "XAU_USD"
    ? "XAU / USD"
    : s === "BCO_USD"
      ? "BRENT"
      : s === "WTICO_USD"
        ? "WTI CRUDE"
        : s.replace("_", " / ");
export const money = (q: Quote) =>
  q.price.toLocaleString("en-US", {
    minimumFractionDigits: q.digits,
    maximumFractionDigits: q.digits,
  });
