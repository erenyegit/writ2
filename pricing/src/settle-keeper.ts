/**
 * Settlement keeper: waits for a position's expiry, fetches the archived Pyth
 * update for the first tick at/after expiry (Hermes benchmarks), and settles.
 *
 * Env: CORE_ADDRESS, POSITION_ID, KEEPER_PRIVATE_KEY,
 *      optional RPC_URL, PYTH_ADDRESS, BTC_USD_FEED_ID, HERMES_URL.
 *
 * Run: POSITION_ID=1 KEEPER_PRIVATE_KEY=0x... tsx src/settle-keeper.ts
 */
import { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const arcTestnet = defineChain({
  id: 91342,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? "https://sepolia-rpc.giwa.io"] } },
});

const CORE = process.env.CORE_ADDRESS as `0x${string}`;
const PYTH = (process.env.PYTH_ADDRESS ??
  "0x2880aB155794e7179c9eE2e38200202908C17B43") as `0x${string}`;
const FEED =
  process.env.BTC_USD_FEED_ID ??
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const HERMES = process.env.HERMES_URL ?? "https://hermes.pyth.network";
const POSITION_ID = BigInt(process.env.POSITION_ID ?? "0");
const KEY = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;

if (!CORE || !KEY || POSITION_ID === 0n) {
  console.error("CORE_ADDRESS, KEEPER_PRIVATE_KEY and POSITION_ID are required");
  process.exit(1);
}

const coreAbi = [
  {
    type: "function",
    name: "getPosition",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "writer", type: "address" },
          { name: "isPut", type: "bool" },
          { name: "strike", type: "uint64" },
          { name: "cap", type: "uint64" },
          { name: "qty", type: "uint64" },
          { name: "expiry", type: "uint64" },
          { name: "collateral", type: "uint128" },
          { name: "premium", type: "uint128" },
          { name: "payout", type: "uint128" },
          { name: "settlementPrice", type: "uint64" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "payable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "oracleData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const pythAbi = [
  {
    type: "function",
    name: "getUpdateFee",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const account = privateKeyToAccount(KEY);
  const pub = createPublicClient({ chain: arcTestnet, transport: http() });
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });

  const pos = await pub.readContract({
    abi: coreAbi,
    address: CORE,
    functionName: "getPosition",
    args: [POSITION_ID],
  });
  if (pos.state !== 1) {
    console.log(`position ${POSITION_ID} is not open (state=${pos.state}) — nothing to do`);
    return;
  }

  const expiry = Number(pos.expiry);
  const waitMs = expiry * 1000 + 10_000 - Date.now();
  if (waitMs > 0) {
    console.log(`waiting ${(waitMs / 1000).toFixed(0)}s until expiry ${expiry}…`);
    await sleep(waitMs);
  }

  // Hermes benchmarks may lag the tick by a few seconds — retry politely.
  let updates: `0x${string}`[] | null = null;
  for (let i = 0; i < 60 && !updates; i++) {
    const res = await fetch(`${HERMES}/v2/updates/price/${expiry}?ids[]=${FEED}&encoding=hex`);
    if (res.ok) {
      const body = (await res.json()) as { binary: { data: string[] } };
      updates = body.binary.data.map((d) => (d.startsWith("0x") ? d : `0x${d}`) as `0x${string}`);
    } else {
      console.log(`benchmark not ready (HTTP ${res.status}), retrying in 10s…`);
      await sleep(10_000);
    }
  }
  if (!updates) throw new Error("could not fetch settlement update from Hermes");

  const fee = await pub.readContract({
    abi: pythAbi,
    address: PYTH,
    functionName: "getUpdateFee",
    args: [updates],
  });

  const oracleData = encodeAbiParameters([{ type: "bytes[]" }], [updates]);
  const hash = await wallet.writeContract({
    abi: coreAbi,
    address: CORE,
    functionName: "settle",
    args: [POSITION_ID, oracleData],
    value: fee,
  });
  console.log(`settle tx: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`status: ${receipt.status}`);

  const after = await pub.readContract({
    abi: coreAbi,
    address: CORE,
    functionName: "getPosition",
    args: [POSITION_ID],
  });
  console.log(
    `settled — price=$${Number(after.settlementPrice) / 1e8} payout=${Number(after.payout) / 1e6} USDC refund=${(Number(after.collateral) - Number(after.payout)) / 1e6} USDC`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
