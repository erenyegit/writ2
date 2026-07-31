"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useReadContracts } from "wagmi";

import { HeroPreview } from "@/components/HeroPreview";
import { coreAbi } from "@/lib/abi";
import { CORE_ADDRESS, isConfigured } from "@/lib/addresses";
import { getMarket, type Market } from "@/lib/api";
import { fmtUsdc } from "@/lib/format";

const faq: [string, string][] = [
  [
    "which pyth price settles my option?",
    "the first btc/usd price pyth publishes at or after your expiry timestamp. this is enforced by pyth's parsePriceFeedUpdatesUnique — neither you nor the desk can pick a different tick, and settling later never changes the outcome.",
  ],
  [
    "does any btc ever change hands?",
    "no. positions are cash-settled: at expiry the price difference is paid in usdc out of the locked collateral. btc is only the reference price.",
  ],
  [
    "what if the oracle is late or down?",
    "settlement can be triggered any time after expiry using pyth's archived data, and the price is still the first tick after expiry — so waiting costs nothing. as a documented mvp escape hatch, the owner can settle manually only after a 3-day delay.",
  ],
  [
    "can i close a position early?",
    "not in this mvp — positions run to expiry. your maximum loss is fixed the moment you open, so there is nothing to manage in between.",
  ],
  [
    "how is the desk's price set?",
    "a black-scholes engine prices each quote from live pyth spot; the desk bids below fair value (its spread), which is shown on the ticket. every quote is eip-712 signed, verified on-chain, single-use, and expires in 20 seconds — giwa's ~200ms preconfirmations make that short window practical.",
  ],
  [
    "can my quote be front-run?",
    "no. giwa has no public mempool — only the sequencer sees pending transactions, so a signed quote cannot be seen and traded against before it lands.",
  ],
  [
    "what if the desk goes offline?",
    "open positions are untouched — collateral sits in the contract and settlement only needs the oracle. you just can't open new positions until quoting resumes.",
  ],
];

export default function EarnPage() {
  const [market, setMarket] = useState<Market | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => getMarket().then((m) => alive && setMarket(m)).catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const { data: deskStats } = useReadContracts({
    contracts: [
      { abi: coreAbi, address: CORE_ADDRESS, functionName: "deskBalance" },
      { abi: coreAbi, address: CORE_ADDRESS, functionName: "totalOpenCollateral" },
    ],
    query: { enabled: isConfigured(), refetchInterval: 15_000 },
  });
  const deskBalance = deskStats?.[0]?.result as bigint | undefined;
  const openCollateral = deskStats?.[1]?.result as bigint | undefined;

  return (
    <div className="space-y-10 pt-10">
      {/* ------------------------------------------------------------ hero */}
      <section className="panel overflow-hidden shadow-lift">
        <div className="grid lg:grid-cols-[44%_56%]">
          <div className="space-y-6 p-8 sm:p-10">
            <div className="micro-amber">{"{ options desk · giwa l2 }"}</div>
            <h1 className="display text-[40px] leading-[1.04] sm:text-[52px]">
              Earn upfront <span className="text-arc-500">premium</span>.
              <br />
              In USDC.
            </h1>
            <p className="max-w-md text-[15px] leading-relaxed text-steel-400">
              Pick a strike and expiry. Lock USDC collateral and receive your premium
              immediately.
            </p>
            <p className="max-w-md text-[13px] font-medium text-steel-300">
              Your maximum loss is fixed before you trade.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <Link href="/trade" className="btn-primary btn-lg">
                sell options
              </Link>
              <Link
                href="/positions"
                className="btn border border-hairline bg-transparent text-steel-400 hover:border-midline hover:text-char"
              >
                positions
              </Link>
            </div>
          </div>

          <div className="bg-ink-850/60 p-6 sm:p-8">
            <HeroPreview spot={market?.spotUsd ?? null} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ stats */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-ink-700/70 shadow-soft lg:grid-cols-4">
        {[
          ["testnet desk liquidity", deskBalance !== undefined ? fmtUsdc(deskBalance) : "—"],
          ["testnet open collateral", openCollateral !== undefined ? fmtUsdc(openCollateral) : "—"],
          ["settlement oracle", "pyth · first tick after expiry"],
          ["collateralization", "100% · loss capped at posted collateral"],
        ].map(([k, v]) => (
          <div key={k} className="bg-ink-900 px-5 py-4">
            <div className="micro mb-1.5">{k}</div>
            <div className="num text-[15.5px] font-semibold text-char">{v}</div>
          </div>
        ))}
      </section>

      {/* ------------------------------------------------------------ products */}
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-hairline bg-ink-850 px-4 py-3">
          <span className="micro-amber">{"~/products"}</span>
          <span className="micro">cash-settled · european · usdc collateral</span>
        </div>

        <div className="thead hidden grid-cols-[1.2fr_2.2fr_1.2fr_1fr_auto] sm:grid">
          <span>strategy</span>
          <span>outcome</span>
          <span>max collateral</span>
          <span>premium</span>
          <span />
        </div>

        {[
          {
            name: "cash-secured put",
            desc: "keep the full premium if btc expires at or above your strike.",
            sub: "below it, settlement is deducted from your usdc collateral.",
            coll: "strike × size",
            side: "put",
          },
          {
            name: "capped call",
            desc: "keep the full premium if btc expires at or below your strike.",
            sub: "above it, settlement is deducted until your cap — and stops there.",
            coll: "(cap − strike) × size",
            side: "call",
          },
        ].map((p) => (
          <div key={p.side} className="trow grid-cols-1 sm:grid-cols-[1.2fr_2.2fr_1.2fr_1fr_auto]">
            <span className="font-semibold text-char">{p.name}</span>
            <span>
              <span className="font-medium text-char">{p.desc}</span>{" "}
              <span className="text-[12px] text-steel-400">{p.sub}</span>
            </span>
            <span>
              <span className="num rounded border border-hairline bg-ink-800 px-1.5 py-0.5 text-[12px] text-steel-300">
                {p.coll}
              </span>
            </span>
            <span className="num tick">paid upfront in usdc</span>
            <Link href={`/trade?side=${p.side}`} className="btn-ghost">
              sell {p.side}s
            </Link>
          </div>
        ))}
      </section>

      {/* ------------------------------------------------------------ mechanics */}
      <section className="panel overflow-hidden">
        <div className="border-b border-hairline bg-ink-850 px-4 py-3">
          <span className="micro-amber">{"~/how-it-works"}</span>
        </div>
        <ol className="grid sm:grid-cols-2">
          {[
            [
              "01",
              "request a quote",
              "black-scholes priced against live pyth spot, valid for 20 seconds",
            ],
            [
              "02",
              "the desk signs it",
              "the contract verifies that signature on-chain before anything moves",
            ],
            [
              "03",
              "collateral locks, premium lands",
              "preconfirmed in ~200ms on giwa flashblocks — fast enough for short-lived quotes",
            ],
            [
              "04",
              "expiry settles itself",
              "pyth fixes the price at expiry; claiming later never changes the outcome",
            ],
          ].map(([n, title, body], i) => (
            <li
              key={n}
              className={[
                "flex gap-4 border-hairline p-6",
                i < 3 ? "border-b" : "", // mobile: divide every row but the last
                i === 2 ? "sm:border-b-0" : "", // desktop: bottom row has no rule
                i < 2 ? "sm:border-b" : "", // desktop: rule under the first row
                i % 2 === 0 ? "sm:border-r" : "", // desktop: rule between columns
              ].join(" ")}
            >
              <span className="num text-[13px] font-semibold text-arc-400">{n}</span>
              <div>
                <div className="mb-1 font-semibold text-char">{title}</div>
                <div className="text-[13px] leading-relaxed text-steel-400">{body}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------------ faq */}
      <section className="panel overflow-hidden">
        <div className="border-b border-hairline bg-ink-850 px-4 py-3">
          <span className="micro-amber">{"~/faq"}</span>
        </div>
        <div className="divide-y divide-[rgba(20,23,30,0.12)]">
          {faq.map(([q, a]) => (
            <details key={q} className="group px-5 py-4">
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-[13px] text-steel-300 transition hover:text-char">
                {q}
                <span className="num text-steel-500 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-3xl text-[12px] leading-relaxed text-steel-400">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
