"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeAbiParameters } from "viem";
import { readContract } from "wagmi/actions";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";

import { coreAbi, pythAbi, type OnchainPosition } from "@/lib/abi";
import { CORE_ADDRESS, EXPLORER_URL, PYTH_ADDRESS, isConfigured } from "@/lib/addresses";
import { fmtPrice8, fmtQty8, fmtTs, fmtUsdc } from "@/lib/format";
import { fetchSettlementUpdate } from "@/lib/hermes";
import { wagmiConfig } from "@/lib/wagmi";

const COLS = "grid-cols-[64px_1.4fr_1fr_1.4fr_1fr_1fr_1.1fr_auto]";

export default function PositionsPage() {
  const { address } = useAccount();

  // Optional read-only view of any writer's book: /positions?addr=0x…
  const [addrParam, setAddrParam] = useState<`0x${string}` | null>(null);
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("addr");
    if (a && /^0x[0-9a-fA-F]{40}$/.test(a)) setAddrParam(a as `0x${string}`);
  }, []);
  const viewAddr = addrParam ?? address;

  return (
    <div className="space-y-6 pt-8">
      <div>
        <div className="micro-amber mb-2">{"~/positions"}</div>
        <h1 className="display text-2xl">YOUR BOOK</h1>
      </div>

      {!viewAddr ? (
        <p className="text-steel-500">connect your wallet to see positions.</p>
      ) : !isConfigured() ? (
        <p className="text-amber">contracts not configured yet.</p>
      ) : (
        <Book addr={viewAddr} />
      )}
    </div>
  );
}

/** Mounted only once a concrete address exists, so reads start immediately.
 * Note: this wagmi/react-query pairing does not fire queries whose `enabled`
 * flips false->true after mount, hence the mount-with-concrete-props split. */
function Book({ addr }: { addr: `0x${string}` }) {
  const { data: ids, refetch: refetchIds } = useReadContract({
    abi: coreAbi,
    address: CORE_ADDRESS,
    functionName: "getWriterPositionIds",
    args: [addr],
    query: { refetchInterval: 15_000 },
  });

  if (ids === undefined) {
    return <p className="text-steel-500">loading book…</p>;
  }
  if (ids.length === 0) {
    return (
      <div className="panel p-8 text-center text-steel-500">
        no positions yet — write your first option on the{" "}
        <a href="/trade" className="text-arc-300 underline underline-offset-2">
          trade
        </a>{" "}
        page.
      </div>
    );
  }
  return <BookRows ids={ids} onChange={refetchIds} />;
}

/** Mounted only once ids exist. Reads positions via a plain viem multicall in
 * an effect — deterministic, no query-layer edge cases with bigint args. */
function BookRows({ ids, onChange }: { ids: readonly bigint[]; onChange: () => void }) {
  const client = usePublicClient();
  const [positions, setPositions] = useState<(OnchainPosition | undefined)[] | null>(null);
  const idsKey = ids.map(String).join(",");

  const load = useCallback(() => {
    if (!client) {
      console.error("[writ] no public client for reads");
      return;
    }
    client
      .multicall({
        contracts: ids.map((id) => ({
          abi: coreAbi,
          address: CORE_ADDRESS,
          functionName: "getPosition" as const,
          args: [id],
        })),
      })
      .then((res) => {
        // The public RPC occasionally fails a burst multicall; keep the last
        // good data and let the 15s interval retry rather than blanking rows.
        if (res.every((r) => r.status === "failure")) return;
        setPositions(
          res.map((r) => (r.status === "success" ? (r.result as OnchainPosition) : undefined)),
        );
      })
      .catch((e) => console.error("[writ] book multicall failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, idsKey]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const rows = useMemo(() => {
    if (!positions) return [];
    return ids
      .map((id, i) => ({ id, pos: positions[i] }))
      .filter((r): r is { id: bigint; pos: OnchainPosition } => !!r.pos)
      .reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, positions]);

  const refresh = () => {
    onChange();
    load();
  };

  if (rows.length === 0) {
    return <p className="text-steel-500">loading {ids.length} positions…</p>;
  }
  return (
    <div className="panel overflow-x-auto">
      <div className={`thead hidden min-w-[860px] gap-3 lg:grid ${COLS}`}>
        <span>type</span>
        <span>strike</span>
        <span>size</span>
        <span>expiry</span>
        <span>premium</span>
        <span>collateral</span>
        <span>status</span>
        <span />
      </div>
      {rows.map(({ id, pos }) => (
        <PositionRow key={id.toString()} id={id} pos={pos} onSettled={refresh} />
      ))}
    </div>
  );
}

function PositionRow({
  id,
  pos,
  onSettled,
}: {
  id: bigint;
  pos: OnchainPosition;
  onSettled: () => void;
}) {
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settleTx, setSettleTx] = useState<`0x${string}` | null>(null);
  const { writeContractAsync } = useWriteContract();

  const now = Math.floor(Date.now() / 1000);
  const expired = now >= Number(pos.expiry);
  const open = pos.state === 1;
  const settled = pos.state === 2;
  const refund = settled ? pos.collateral - pos.payout : 0n;

  const onSettle = async () => {
    setSettling(true);
    setError(null);
    try {
      const updates = await fetchSettlementUpdate(Number(pos.expiry));
      const fee = await readContract(wagmiConfig, {
        abi: pythAbi,
        address: PYTH_ADDRESS,
        functionName: "getUpdateFee",
        args: [updates],
      });
      const oracleData = encodeAbiParameters([{ type: "bytes[]" }], [updates]);
      const hash = await writeContractAsync({
        abi: coreAbi,
        address: CORE_ADDRESS,
        functionName: "settle",
        args: [id, oracleData],
        value: fee,
      });
      setSettleTx(hash);
      onSettled();
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "settle failed");
    } finally {
      setSettling(false);
    }
  };

  return (
    <div className="border-b border-hairline last:border-b-0">
      <div className={`trow min-w-[860px] !border-b-0 text-[12px] lg:grid ${COLS}`}>
        <span
          className={`num inline-flex w-12 justify-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
            pos.isPut ? "bg-danger/10 text-danger" : "bg-arc-500/15 text-arc-300"
          }`}
        >
          {pos.isPut ? "put" : "call"}
        </span>
        <span className="num text-char">
          {fmtPrice8(pos.strike)}
          {!pos.isPut && <span className="text-steel-500"> → {fmtPrice8(pos.cap)}</span>}
        </span>
        <span className="num text-steel-300">{fmtQty8(pos.qty)}</span>
        <span className="num text-steel-300">{fmtTs(pos.expiry)}</span>
        <span className="num tick">{fmtUsdc(pos.premium)}</span>
        <span className="num text-steel-300">{fmtUsdc(pos.collateral)}</span>
        <span>
          {settled ? (
            <span className="text-steel-500">
              settled · {fmtPrice8(pos.settlementPrice)}
            </span>
          ) : expired ? (
            <span className="text-amber">awaiting settlement</span>
          ) : (
            <span className="tick">open</span>
          )}
        </span>
        <span className="justify-self-end">
          {open && expired ? (
            <button className="btn-ghost" disabled={settling} onClick={onSettle}>
              {settling ? "settling…" : "settle"}
            </button>
          ) : settled ? (
            <span className="num text-steel-400">+{fmtUsdc(refund)} back</span>
          ) : (
            <span className="micro">#{id.toString()}</span>
          )}
        </span>
      </div>
      {(error || settleTx) && (
        <div className="px-4 pb-3 text-[11px]">
          {error && <span className="text-danger">{error}</span>}
          {settleTx && (
            <a
              className="text-arc-300 underline underline-offset-2"
              href={`${EXPLORER_URL}/tx/${settleTx}`}
              target="_blank"
              rel="noreferrer"
            >
              settlement tx on arcscan
            </a>
          )}
        </div>
      )}
    </div>
  );
}
