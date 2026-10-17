import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "TAFOREX — Global Market Board",
  description:
    "A fullscreen market board for forex, gold and crude oil. Live OANDA pricing and simulated market data.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
