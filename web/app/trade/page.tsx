"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { erc20Abi, maxUint256 } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { coreAbi, faucetAbi } from "@/lib/abi";
import { CORE_ADDRESS, EXPLORER_URL, USDC_ADDRESS, isConfigured } from "@/lib/addresses";
import { getMarket, getQuote, type Market, type SignedQuote } from "@/lib/api";
import { fmtTs, fmtUsd, fmtUsdc } from "@/lib/format";

type Side = "put" | "call";

const QTY_PRESETS = ["0.0002", "0.001", "0.01", "0.1"];

export default function TradePage() {
  const { address, isConnected } = useAccount();

  const [market, setMarket] = useState<Market | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("put");
  const [strike, setStrike] = useState<number | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [qty, setQty] = useState("0.001");
  const [expiry, setExpiry] = useState<number | null>(null);
  const [quote, setQuote] = useState<SignedQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);

  // Deep-link params from the hero preview: ?side, ?strike, ?cap, ?days
  const urlParams = useRef<{ cap?: number; days?: number }>({});
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("side");
    if (s === "call" || s === "put") setSide(s);
    const st = Number(q.get("strike"));
    if (Number.isFinite(st) && st > 0) setStrike(st);
    const cp = Number(q.get("cap"));
    if (Number.isFinite(cp) && cp > 0) {
      setCap(cp);
      urlParams.current.cap = cp;
    }
    const dy = Number(q.get("days"));
    if (Number.isFinite(dy) && dy > 0) urlParams.current.days = dy;
  }, []);

  // ------------------------------------------------------------ market data

  useEffect(() => {
    let alive = true;
    const load = () =>
      getMarket()
        .then((m) => {
          if (!alive) return;
          setMarket(m);
          setMarketError(null);
          setStrike((s) => s ?? nearestStrike(m));
          setExpiry((e) => {
            if (e) return e;
            const dy = urlParams.current.days;
            if (dy && m.expiries.length) {
              const target = Math.floor(Date.now() / 1000) + dy * 86400;
              return m.expiries.reduce((a, b) =>
                Math.abs(b - target) < Math.abs(a - target) ? b : a,
              );
            }
            return m.expiries[1] ?? m.expiries[0] ?? null;
          });
        })
        .catch((e) => alive && setMarketError(e.message));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (side !== "call" || !market || !strike) return;
    if (urlParams.current.cap) {
      urlParams.current.cap = undefined; // deep-linked cap wins once
      return;
    }
    const above = market.strikes.filter((s) => s > strike);
    setCap(above[1] ?? above[0] ?? null);
  }, [side, strike, market]);

  // ------------------------------------------------------------ quoting

  const qtyNum = Number(qty);
  const paramsReady =
    !!address &&
    !!strike &&
    !!expiry &&
    qtyNum > 0 &&
    (side === "put" || (!!cap && cap > (strike ?? 0)));

  const refreshQuote = useCallback(() => {
    if (!paramsReady || !address || !strike || !expiry) return;
    setQuoting(true);
    getQuote({
      writer: address,
      isPut: side === "put",
      strike,
      cap: side === "call" ? cap! : undefined,
      qty: qtyNum,
      expiry,
    })
      .then((q) => {
        setQuote(q);
        setQuoteError(null);
      })
      .catch((e) => {
        setQuote(null);
        setQuoteError(e.message);
      })
      .finally(() => setQuoting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, side, strike, cap, qtyNum, expiry, paramsReady]);

  useEffect(() => {
    refreshQuote();
    const t = setInterval(refreshQuote, 20_000);
    return () => clearInterval(t);
  }, [refreshQuote]);

  // ------------------------------------------------------------ txs

  const collateral = quote ? BigInt(quote.meta.collateralUsdc) : 0n;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: erc20Abi,
    address: USDC_ADDRESS,
    functionName: "allowance",
    args: address ? [address, CORE_ADDRESS] : undefined,
    query: { enabled: !!address && isConfigured() },
  });
  const { data: usdcBalance, refetch: refetchBalance } = useReadContract({
    abi: erc20Abi,
    address: USDC_ADDRESS,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const needsApproval = allowance !== undefined && quote !== null && allowance < collateral;

  const { writeContract: approve, data: approveHash, isPending: approving } = useWriteContract();
  const { isSuccess: approved } = useWaitForTransactionReceipt({ hash: approveHash });
  useEffect(() => {
    if (approved) refetchAllowance();
  }, [approved, refetchAllowance]);

  // TestUSDC faucet — GIWA has no canonical stablecoin, the desk mints its own.
  const { writeContract: claim, data: claimHash, isPending: claiming } = useWriteContract();
  const { isSuccess: claimed } = useWaitForTransactionReceipt({ hash: claimHash });
  useEffect(() => {
    if (claimed) refetchBalance();
  }, [claimed]);
  const onClaimFaucet = () =>
    claim({ abi: faucetAbi, address: USDC_ADDRESS, functionName: "faucet" });

  const {
    writeContract: sell,
    data: sellHash,
    isPending: selling,
    error: sellError,
    reset: resetSell,
  } = useWriteContract();
  const { isSuccess: sold } = useWaitForTransactionReceipt({ hash: sellHash });

  const onApprove = () =>
    approve({
      abi: erc20Abi,
      address: USDC_ADDRESS,
      functionName: "approve",
      args: [CORE_ADDRESS, maxUint256],
    });

  const onSell = () => {
    if (!quote) return;
    const q = quote.quote;
    sell({
      abi: coreAbi,
      address: CORE_ADDRESS,
      functionName: "writeOption",
      args: [
        {
          writer: q.writer,
          isPut: q.isPut,
          strike: BigInt(q.strike),
          cap: BigInt(q.cap),
          qty: BigInt(q.qty),
          expiry: BigInt(q.expiry),
          premium: BigInt(q.premium),
          quoteDeadline: BigInt(q.quoteDeadline),
          nonce: BigInt(q.nonce),
        },
        quote.signature,
      ],
    });
  };

  // ------------------------------------------------------------ derived

  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 5_000);
    return () => clearInterval(t);
  }, []);

  const spot = market?.spotUsd;
  const premiumUsd = quote ? Number(quote.quote.premium) / 1e6 : null;
  const breakeven =
    quote && strike && premiumUsd !== null && qtyNum > 0
      ? side === "put"
        ? strike - premiumUsd / qtyNum
        : strike + premiumUsd / qtyNum
      : null;
  const premiumBig = quote ? BigInt(quote.quote.premium) : 0n;
  const maxNetLoss = quote ? collateral - premiumBig : 0n;
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setConfirming(false);
  }, [quote?.quote.nonce, side, strike, cap, expiry]);

  const insufficient = usdcBalance !== undefined && quote !== null && usdcBalance < collateral;
  const maxSize =
    usdcBalance !== undefined && strike
      ? side === "put"
        ? Math.floor((Number(usdcBalance) / 1e6 / strike) * 1e4) / 1e4
        : cap && cap > strike
          ? Math.floor((Number(usdcBalance) / 1e6 / (cap - strike)) * 1e4) / 1e4
          : 0
      : null;
  const quoteExpired = quote !== null && nowSec > Number(quote.quote.quoteDeadline);

  return (
    <div className="space-y-6 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="micro-amber mb-2">{"~/trade"}</div>
          <h1 className="display text-2xl">SELL BTC OPTIONS</h1>
        </div>
        <div className="text-right">
          <div className="micro">btc / usd · pyth</div>
          <div className="num display text-2xl">{spot ? fmtUsd(spot, 0) : "—"}</div>
        </div>
      </div>

      {!isConfigured() && (
        <div className="panel border-amber/40 p-4 text-amber">
          contracts not configured — set NEXT_PUBLIC_CORE_ADDRESS after deployment.
        </div>
      )}
      {marketError && (
        <div className="panel border-danger/40 p-4 text-danger">
          desk api unreachable — retrying shortly ({marketError})
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* ---------------------------------------------------- builder */}
        <div className="panel divide-y divide-[rgba(148,163,184,0.14)]">
          <div className="p-5">
            <span className="label">strategy</span>
            <div className="seg max-w-md">
              <button data-active={side === "put"} onClick={() => setSide("put")}>
                cash-secured put
              </button>
              <button data-active={side === "call"} onClick={() => setSide("call")}>
                capped call
              </button>
            </div>
            <p className="mt-3 text-steel-400">
              {side === "put"
                ? "if btc closes below your strike, the difference is paid from your usdc collateral — no btc changes hands. collateral: strike × size."
                : "you sell the upside between strike and cap — settled in usdc, losses stop at the cap. collateral: (cap − strike) × size."}
            </p>
          </div>

          <div className="p-5">
            <span className="label">strike</span>
            <div className="overflow-hidden rounded-md border border-hairline">
              <div className="grid grid-cols-3 border-b border-hairline bg-ink-900 sm:grid-cols-5">
                {market?.strikes.slice(0, 10).map((s) => {
                  const isAtm = spot && nearestStrike(market!) === s;
                  const active = strike === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setStrike(s)}
                      className={`num border-b border-r border-hairline px-2 py-2.5 text-[12px] transition last:border-r-0 ${
                        active
                          ? "bg-arc-500/15 text-char shadow-[inset_0_0_0_1px_rgba(46,95,224,0.6)]"
                          : "text-steel-400 hover:bg-ink-800 hover:text-steel-300"
                      }`}
                    >
                      <div>{fmtUsd(s, 0)}</div>
                      <div className={`text-[10px] ${isAtm ? "text-amber" : "text-steel-500"}`}>
                        {isAtm ? "atm" : spot ? `${(((s - spot) / spot) * 100).toFixed(1)}%` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid gap-5 p-5 sm:grid-cols-2">
            {side === "call" && (
              <div>
                <span className="label">cap</span>
                <select
                  className="field"
                  value={cap ?? ""}
                  onChange={(e) => setCap(Number(e.target.value))}
                >
                  {market?.strikes
                    .filter((s) => strike && s > strike)
                    .map((s) => (
                      <option key={s} value={s}>
                        {fmtUsd(s, 0)}
                      </option>
                    ))}
                </select>
                <p className="mt-2 text-[11px] text-steel-400">
                  the cap is the price where your loss stops growing.
                </p>
              </div>
            )}
            <div>
              <span className="label">size · btc</span>
              <input
                className="field"
                type="number"
                min="0.0001"
                step="0.01"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
              <div className="mt-2 flex gap-1.5">
                {QTY_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setQty(p)}
                    className={`rounded border border-hairline px-2 py-1 text-[11px] transition ${
                      qty === p ? "border-arc-500/60 text-char" : "text-steel-500 hover:text-steel-300"
                    }`}
                  >
                    {p}
                  </button>
                ))}
                {maxSize !== null && maxSize > 0 && (
                  <button
                    onClick={() => setQty(String(maxSize))}
                    className="rounded border border-arc-500/40 px-2 py-1 text-[11px] text-arc-300 transition hover:border-arc-500 hover:text-char"
                  >
                    max · {maxSize}
                  </button>
                )}
              </div>
              {strike && qtyNum > 0 && (
                <p className="num mt-2 text-[11px] text-steel-500">
                  {side === "put"
                    ? `you promise to buy ${qtyNum} btc @ ${fmtUsd(strike, 0)} → locks ${fmtUsd(qtyNum * strike)} · settled in usdc`
                    : cap && cap > strike
                      ? `you sell upside on ${qtyNum} btc (${fmtUsd(strike, 0)}→${fmtUsd(cap, 0)}) → locks ${fmtUsd(qtyNum * (cap - strike))} · settled in usdc`
                      : ""}
                </p>
              )}
            </div>
            <div>
              <span className="label">expiry · 08:00 utc</span>
              <select
                className="field"
                value={expiry ?? ""}
                onChange={(e) => setExpiry(Number(e.target.value))}
              >
                {market?.expiries.map((t) => (
                  <option key={t} value={t}>
                    {fmtTs(t)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------- ticket */}
        <div className="panel h-fit lg:sticky lg:top-20">
          <div className="flex items-center justify-between border-b border-hairline bg-ink-850 px-5 py-3">
            <span className="micro-amber">{"~/ticket"}</span>
            <span className="micro">{quoting ? "quoting…" : "desk quote"}</span>
          </div>

          <div className="space-y-4 p-5">
            {!isConnected ? (
              <p className="text-steel-500">connect your wallet to get a quote.</p>
            ) : quoteError ? (
              <p className="text-danger">{quoteError}</p>
            ) : !quote ? (
              <p className="text-steel-500">set parameters to quote.</p>
            ) : (
              <>
                <div>
                  <div className="micro mb-1">you receive now</div>
                  <div className="num display text-3xl text-yield">
                    {fmtUsdc(BigInt(quote.quote.premium))}
                  </div>
                  <div className="ttl-bar mt-3" key={quote.quote.nonce} />
                </div>

                <div className="panel-inset divide-y divide-[rgba(20,23,30,0.12)] text-[12px]">
                  <Row k="max profit" v={fmtUsdc(premiumBig)} tone="good" />
                  <Row k="max net loss" v={fmtUsdc(maxNetLoss)} tone="bad" />
                  {breakeven !== null && <Row k="breakeven at expiry" v={fmtUsd(breakeven, 0)} />}
                  {side === "call" && cap !== null && (
                    <Row k="max loss reached at" v={fmtUsd(cap, 0)} />
                  )}
                </div>

                <p className="text-[11px] leading-relaxed text-steel-400">
                  {side === "put"
                    ? `keep the full premium if btc expires at or above ${strike ? fmtUsd(strike, 0) : "your strike"}. below it, the difference is paid from your collateral — in usdc.`
                    : `keep the full premium if btc expires at or below ${strike ? fmtUsd(strike, 0) : "your strike"}. above it, losses grow until the cap and stop there.`}
                </p>

                <div className="panel-inset divide-y divide-[rgba(20,23,30,0.12)] text-[12px]">
                  <Row k="collateral to lock" v={fmtUsdc(collateral)} />
                  <Row k="black-scholes estimate" v={fmtUsd(quote.meta.fairValueUsd)} />
                  <Row k="quote expires" v={fmtTs(Number(quote.quote.quoteDeadline))} />
                  {usdcBalance !== undefined && <Row k="your usdc" v={fmtUsdc(usdcBalance)} />}
                </div>

                {insufficient ? (
                  <div className="space-y-2">
                    <div className="panel-inset border-danger/40 p-3 text-[12px] leading-relaxed text-danger">
                      insufficient usdc — this trade locks {fmtUsdc(collateral)} but you hold{" "}
                      {fmtUsdc(usdcBalance!)}.
                      {maxSize ? ` max size at this strike ≈ ${maxSize} btc.` : ""}
                    </div>
                    <button
                      className="btn-primary btn-lg w-full"
                      disabled={claiming}
                      onClick={onClaimFaucet}
                    >
                      {claiming ? "claiming…" : "claim 2,000 test usdc"}
                    </button>
                  </div>
                ) : quoteExpired ? (
                  <button className="btn-ghost btn-lg w-full" onClick={refreshQuote}>
                    quote expired — refresh
                  </button>
                ) : needsApproval ? (
                  <button
                    className="btn-primary btn-lg w-full"
                    disabled={approving}
                    onClick={onApprove}
                  >
                    {approving ? "approving…" : "approve usdc"}
                  </button>
                ) : !confirming ? (
                  <button
                    className="btn-primary btn-lg w-full"
                    disabled={!isConfigured()}
                    onClick={() => setConfirming(true)}
                  >
                    {`sell ${side} · collect premium`}
                  </button>
                ) : (
                  <div className="panel-inset border-arc-500/30 text-[12px]">
                    <div className="micro border-b border-hairline px-3 py-2">review & sign</div>
                    <Row k="receive now" v={fmtUsdc(premiumBig)} tone="good" />
                    <Row k="lock as collateral" v={fmtUsdc(collateral)} />
                    <Row k="max net loss" v={fmtUsdc(maxNetLoss)} tone="bad" />
                    <Row k="expiry" v={fmtTs(Number(quote.quote.expiry))} />
                    <div className="flex gap-2 p-3 pt-2">
                      <button
                        className="btn-primary flex-1"
                        disabled={selling}
                        onClick={onSell}
                      >
                        {selling ? "signing…" : "confirm & sign"}
                      </button>
                      <button className="btn-ghost" onClick={() => setConfirming(false)}>
                        back
                      </button>
                    </div>
                  </div>
                )}

                {sellError && (
                  <p className="break-all text-[11px] text-danger">
                    {sellError.message.split("\n")[0]}
                  </p>
                )}
                {sold && sellHash && (
                  <div className="panel-inset border-yield/30 p-3 text-[12px]">
                    <div className="mb-1 flex items-center gap-2 font-semibold text-yield">
                      <span className="dot bg-yield" /> filled · preconfirmed in ~200ms
                    </div>
                    <a
                      className="text-arc-300 underline underline-offset-2"
                      href={`${EXPLORER_URL}/tx/${sellHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      view on arcscan
                    </a>
                    <button
                      className="ml-4 text-steel-500 underline underline-offset-2"
                      onClick={() => {
                        resetSell();
                        refreshQuote();
                      }}
                    >
                      new trade
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="border-t border-hairline px-5 py-3">
            <p className="micro !normal-case !tracking-normal leading-relaxed">
              quotes are eip-712 signed by the desk and verified on-chain. settlement reads
              pyth's first tick at/after expiry — claiming later never changes the outcome.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function nearestStrike(m: Market): number {
  return m.strikes.reduce((a, b) =>
    Math.abs(b - m.spotUsd) < Math.abs(a - m.spotUsd) ? b : a,
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-steel-500">{k}</span>
      <span
        className={`num ${
          tone === "good" ? "text-yield" : tone === "bad" ? "text-danger" : "text-steel-300"
        }`}
      >
        {v}
      </span>
    </div>
  );
}
