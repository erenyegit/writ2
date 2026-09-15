import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";

import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.writ.fi"),
  title: "Writ Fi — Earn upfront premium, on GIWA",
  description:
    "Sell cash-settled BTC options and receive the premium instantly. Fully collateralized, loss capped at posted collateral, oracle-settled, built on GIWA.",
};

// Header, footer and wallet providers live in app/(desk)/layout.tsx, so the
// coming soon splash renders full screen without loading any of them.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
