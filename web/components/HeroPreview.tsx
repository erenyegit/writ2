"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { bsCappedCall, bsPut } from "@/lib/desk/bs";
import { fmtUsd } from "@/lib/format";

/**
 * Interactive position preview for the landing hero.
 *
 * Prices with the same Black-Scholes model the desk uses (client-side,
 * mirroring the desk's default IV/spread) so slider moves update instantly.
 * Values are indicative — the module is labelled accordingly; real signed
 * quotes only exist on the trade desk.
 */

const SIZE_BTC = 0.01;
// Mirrors the desk's default pricing knobs (indicative preview only).
const IV = 0.55;
const SPREAD = 0.1;
const STEP = 500;
const MIN_GAP = 1000;

type Tab = "put" | "call";
const EXPIRY_DAYS = [1, 3, 7] as const;

const roundStep = (x: number) => Math.round(x / STEP) * STEP;
const clampPct = (p: number) => Math.min(96, Math.max(4, p));

export function HeroPreview({ spot }: { spot: number | null }) {
  const [tab, setTab] = useState<Tab>("put");
  const [days, setDays] = useState<(typeof EXPIRY_DAYS)[number]>(7);
  const [putStrike, setPutStrike] = useState<number | null>(null);
  const [callStrike, setCallStrike] = useState<number | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const seeded = useRef(false);

  // Seed defaults once the first live price arrives.
  useEffect(() => {
    if (!spot || seeded.current) return;
    seeded.current = true;
    setPutStrike(roundStep(spot * 0.965));
    const cs = roundStep(spot);
    setCallStrike(cs);
    setCap(cs + 3000);
  }, [spot]);

  const min = spot ? roundStep(spot * 0.85) : 0;
  const max = spot ? roundStep(spot * 1.05) : 0;
  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  const T = days / 365;
  const premium = useMemo(() => {
    if (!spot) return null;
    if (tab === "put" && putStrike) {
      return Math.max(bsPut(spot, putStrike, T, IV) * SIZE_BTC * (1 - SPREAD), 0);
    }
    if (tab === "call" && callStrike && cap && cap > callStrike) {
      return Math.max(bsCappedCall(spot, callStrike, cap, T, IV) * SIZE_BTC * (1 - SPREAD), 0);
    }
    return null;
  }, [spot, tab, putStrike, callStrike, cap, T]);

  const collateral =
    tab === "put"
      ? (putStrike ?? 0) * SIZE_BTC
      : ((cap ?? 0) - (callStrike ?? 0)) * SIZE_BTC;

  const ready = spot !== null && putStrike !== null && callStrike !== null && cap !== null;

  const tradeHref =
    tab === "put"
      ? `/trade?side=put&strike=${putStrike ?? ""}&days=${days}`
      : `/trade?side=call&strike=${callStrike ?? ""}&cap=${cap ?? ""}&days=${days}`;

  return (
    <div className="flex h-full flex-col">
      {/* ------------------------------------------------ meta row */}
      <div className="flex items-center justify-between">
        <span className="micro">indicative preview</span>
        <span className="num text-[13px] font-semibold text-char" title="price source: pyth">
          <span className="micro mr-2">btc / usd</span>
          {spot ? fmtUsd(spot, 0) : <span className="text-steel-500">loading…</span>}
        </span>
      </div>

      {/* ------------------------------------------------ strategy tabs */}
      <div className="mt-5 flex gap-6 border-b border-hairline">
        {(
          [
            ["put", "btc stays above", "cash-secured put"],
            ["call", "btc stays below", "capped call"],
          ] as const
        ).map(([key, label, sub]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 pb-2.5 text-left transition ${
              tab === key ? "border-arc-500" : "border-transparent"
            }`}
          >
            <span
              className={`block font-mono text-[12px] font-semibold uppercase tracking-wider transition ${
                tab === key ? "text-char" : "text-steel-500 hover:text-steel-400"
              }`}
            >
              {label}
            </span>
            <span
              className={`block text-[10.5px] ${tab === key ? "text-steel-400" : "text-steel-500/70"}`}
            >
              {sub}
            </span>
          </button>
        ))}
      </div>

      {/* ------------------------------------------------ expiry + size */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-steel-500">
            expiry
          </span>
          <div className="flex gap-1">
            {EXPIRY_DAYS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded border px-2 py-0.5 font-mono text-[10.5px] font-semibold transition ${
                  days === d
                    ? "border-arc-500/60 text-char"
                    : "border-transparent text-steel-500 hover:text-steel-400"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-steel-500">
          size 0.01 btc
        </span>
      </div>

      {/* ------------------------------------------------ payoff bar */}
      <div className="mt-6">
        {!ready ? (
          <div className="flex h-[96px] items-center justify-center rounded-lg border border-hairline text-[12px] text-steel-500">
            loading price…
          </div>
        ) : tab === "put" ? (
          <PutBar
            min={min}
            max={max}
            pct={pct}
            spot={spot!}
            strike={putStrike!}
            onStrike={(v) => setPutStrike(v)}
          />
        ) : (
          <CallBar
            min={min}
            max={max}
            pct={pct}
            spot={spot!}
            strike={callStrike!}
            cap={cap!}
            onStrike={(v) => setCallStrike(Math.min(v, cap! - MIN_GAP))}
            onCap={(v) => setCap(Math.max(v, callStrike! + MIN_GAP))}
          />
        )}
      </div>

      {/* ------------------------------------------------ outcome */}
      {ready && (
        <div className="mt-6">
          <p className="text-[13.5px] font-medium leading-snug text-char">
            {tab === "put"
              ? `Keep the full premium if BTC finishes at or above ${fmtUsd(putStrike!, 0)}.`
              : `Keep the full premium if BTC finishes at or below ${fmtUsd(callStrike!, 0)}.`}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-steel-400">
            {tab === "put"
              ? "Below the strike, settlement comes from your USDC collateral."
              : `Above the strike, losses increase until the ${fmtUsd(cap!, 0)} cap and stop there.`}
          </p>
        </div>
      )}

      {/* ------------------------------------------------ metrics */}
      <div
        aria-live="polite"
        className="mt-5 grid grid-cols-2 divide-x divide-[rgba(23,31,56,0.08)] border-t border-hairline pt-4"
      >
        <div className="pr-4">
          <div className="micro mb-1">premium now</div>
          <div className="num text-[16px] font-semibold text-yield">
            {premium !== null ? `+${premium.toFixed(2)}` : "—"}
            <span className="ml-1 text-[10px] font-medium text-steel-500">usdc</span>
          </div>
        </div>
        <div className="pl-4">
          <div className="micro mb-1">collateral locked</div>
          <div className="num text-[16px] font-semibold text-char">
            {ready ? collateral.toFixed(2) : "—"}
            <span className="ml-1 text-[10px] font-medium text-steel-500">usdc</span>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ footer */}
      <div className="mt-auto flex justify-end pt-5">
        <Link
          href={tradeHref}
          className="group font-mono text-[12px] font-semibold uppercase tracking-wider text-arc-300 transition hover:text-arc-600"
        >
          trade this setup{" "}
          <span className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bars */

function Marker({ left, label }: { left: number; label: string }) {
  return (
    <>
      <div
        className="pointer-events-none absolute z-10 w-px bg-char/40"
        style={{ left: `${left}%`, top: -4, bottom: -4 }}
      />
      <div
        className="pointer-events-none absolute top-full z-10 mt-8 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tracking-wide text-steel-400"
        style={{ left: `${clampPct(left)}%` }}
      >
        {label}
      </div>
    </>
  );
}

function Handle({ left, color }: { left: number; color: string }) {
  return (
    <div
      className="pointer-events-none absolute top-1/2 z-20 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_1px_4px_rgba(23,31,56,0.35)] ring-2 ring-white"
      style={{ left: `${left}%`, background: color }}
    />
  );
}

function HandleLabel({ left, text, color }: { left: number; text: string; color: string }) {
  return (
    <div
      className={`pointer-events-none absolute top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap text-center font-mono text-[10px] font-semibold leading-tight ${color}`}
      style={{ left: `${clampPct(left)}%` }}
      dangerouslySetInnerHTML={{ __html: text }}
    />
  );
}

const zoneLabel =
  "font-mono text-[9px] lowercase tracking-[0.08em] text-steel-500/80";

function PutBar({
  min,
  max,
  pct,
  spot,
  strike,
  onStrike,
}: {
  min: number;
  max: number;
  pct: (v: number) => number;
  spot: number;
  strike: number;
  onStrike: (v: number) => void;
}) {
  const s = pct(strike);
  return (
    <div className="px-1 pb-12">
      <div className={`mb-1.5 flex justify-between ${zoneLabel}`}>
        <span>settlement</span>
        <span>full premium</span>
      </div>
      <div className="relative h-3 rounded-full bg-ink-700">
        <div
          className="absolute inset-y-0 left-0 rounded-l-full bg-[#C24438]/20"
          style={{ width: `${s}%` }}
        />
        <div
          className="absolute inset-y-0 rounded-r-full bg-[#0F8A50]/20"
          style={{ left: `${s}%`, right: 0 }}
        />
        <Marker left={pct(spot)} label={`btc now · ${fmtUsd(spot, 0)}`} />
        <Handle left={s} color="#D99A2B" />
        <HandleLabel left={s} text={`strike<br/>${fmtUsd(strike, 0)}`} color="text-amber" />
        <input
          type="range"
          aria-label="strike price"
          className="hero-range absolute inset-0 z-30"
          min={min}
          max={max}
          step={STEP}
          value={strike}
          onChange={(e) => onStrike(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function CallBar({
  min,
  max,
  pct,
  spot,
  strike,
  cap,
  onStrike,
  onCap,
}: {
  min: number;
  max: number;
  pct: (v: number) => number;
  spot: number;
  strike: number;
  cap: number;
  onStrike: (v: number) => void;
  onCap: (v: number) => void;
}) {
  const s = pct(strike);
  const c = pct(cap);
  return (
    <div className="px-1 pb-12">
      <div className={`relative mb-1.5 h-3 ${zoneLabel}`}>
        <span className="absolute left-0">full premium</span>
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: `${Math.min(70, Math.max(26, (s + c) / 2))}%` }}
        >
          settlement
        </span>
        <span className="absolute right-0">max loss</span>
      </div>
      <div className="relative h-3 rounded-full bg-ink-700">
        <div
          className="absolute inset-y-0 left-0 rounded-l-full bg-[#0F8A50]/20"
          style={{ width: `${s}%` }}
        />
        <div
          className="absolute inset-y-0 bg-[#A87718]/20"
          style={{ left: `${s}%`, width: `${c - s}%` }}
        />
        <div
          className="absolute inset-y-0 rounded-r-full bg-[#C24438]/20"
          style={{ left: `${c}%`, right: 0 }}
        />
        <Marker left={pct(spot)} label={`btc now · ${fmtUsd(spot, 0)}`} />
        <Handle left={s} color="#D99A2B" />
        <Handle left={c} color="#3D5EE0" />
        <HandleLabel left={s} text={`strike<br/>${fmtUsd(strike, 0)}`} color="text-amber" />
        <HandleLabel left={c} text={`cap<br/>${fmtUsd(cap, 0)}`} color="text-arc-300" />
        <input
          type="range"
          aria-label="strike price"
          className="hero-range absolute inset-0 z-30"
          min={min}
          max={max}
          step={STEP}
          value={strike}
          onChange={(e) => onStrike(Number(e.target.value))}
        />
        <input
          type="range"
          aria-label="cap price"
          className="hero-range absolute inset-0 z-40"
          min={min}
          max={max}
          step={STEP}
          value={cap}
          onChange={(e) => onCap(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
