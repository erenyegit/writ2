import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";

import { Header } from "@/components/Header";

import { Providers } from "./providers";
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
  title: "Writ — Earn upfront premium, on GIWA",
  description:
    "Sell cash-settled BTC options and receive the premium instantly. Fully collateralized, loss capped at posted collateral, oracle-settled, built on GIWA.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${sans.variable}`}>
      <body>
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-6xl px-4 pb-24">{children}</main>
          <footer className="border-t border-hairline py-5">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4">
              <span className="micro">writ · options desk on giwa</span>
              <span className="micro">testnet · unaudited mvp · not investment advice</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
