# Writ on GIWA

**Cash-settled BTC options with instant premiums, built for [GIWA](https://docs.giwa.io) —
Upbit's OP Stack L2.**

Writers sell European options to the protocol desk and receive the premium the moment the
trade executes. Every position is collateralized at its maximum possible payout, so there
are no liquidations, no margin calls, and no pooled risk. Settlement reads the first Pyth
price published at or after expiry — *when* you settle can never change *what* you get.

> Testnet MVP. Unaudited. Use testnet funds only.

## Why GIWA — the desk gets structurally better here

The desk works on **signed quotes**: the pricing engine signs an EIP-712 offer, the
contract verifies it on-chain. That model has exactly two weaknesses, and GIWA removes
both at the architecture level:

1. **Quote staleness.** A quote must live long enough for the writer's transaction to
   land. GIWA **Flashblocks preconfirm in ~200ms**, so quotes live **20 seconds instead
   of 60**. A desk that carries three times less stale-price risk prices that risk out
   of the spread — writers keep more premium.
2. **Front-running.** GIWA has **no public mempool** — only the sequencer sees pending
   transactions. A signed quote can never be observed and traded against before it lands.

Neither property is something we bolted on; the same product simply runs better on this
chain.

## Products

| Product | Writer locks | Max payout | Pays at expiry |
| --- | --- | --- | --- |
| Cash-secured put | `strike × qty` | `strike × qty` | `max(strike − S, 0) × qty` |
| Capped call (call spread) | `(cap − strike) × qty` | `(cap − strike) × qty` | `min(max(S − strike, 0), cap − strike) × qty` |

Premiums are quoted off-chain by a Black-Scholes desk engine, signed as EIP-712 typed
data, and verified on-chain — the desk can only set premiums, never touch collateral
beyond the signed trade.

## Repository layout

```
contracts/   Foundry — WritOptions core, PythAdapter, TestUSDC (faucet-backed
             settlement token; GIWA has no canonical stablecoin yet), 36 tests
web/         Next.js app: trade + positions UI, plus the desk itself served as
             /api routes (Black-Scholes quoting + EIP-712 signing) — one deploy
pricing/     settlement keeper script + optional standalone desk service
```

## GIWA Sepolia constants

| What | Value |
| --- | --- |
| Chain ID | `91342` |
| RPC (Flashblocks, ~200ms preconf) | `https://sepolia-rpc-flashblocks.giwa.io` |
| RPC (standard) | `https://sepolia-rpc.giwa.io` |
| Explorer | `https://sepolia-explorer.giwa.io` |
| Gas token | ETH — faucet: <https://faucet.lambda256.io/giwa-sepolia> |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| BTC/USD feed id | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |

## Quickstart

```bash
# 1. Contracts — build & test
cd contracts
npm install && forge install foundry-rs/forge-std
forge test

# 2. App (UI + desk API in one — quotes signed with a dev key by default)
cd ../
pnpm install
pnpm web:dev            # http://localhost:3000  (+ /api/market, /api/quote)
```

## Deploy to GIWA Sepolia

```bash
cd contracts
cp .env.example .env    # fill DEPLOYER_PRIVATE_KEY and QUOTE_SIGNER
source .env
forge script script/Deploy.s.sol --rpc-url giwa_sepolia --broadcast
```

The script deploys TestUSDC + PythAdapter + WritOptions and seeds the desk with the
deployer's first faucet claim. Then put the deployed addresses into `web/.env.local`
(`NEXT_PUBLIC_CORE_ADDRESS`, `NEXT_PUBLIC_USDC_ADDRESS`, `CORE_ADDRESS`) along with
`QUOTER_PRIVATE_KEY`.

Test USDC is self-serve: the trade page has a **claim** button (2,000 per 8h per
address), so anyone can try the demo without asking for funds.

## Design notes

**Scales.** Prices and quantities use 1e8 (Pyth-native for BTC/USD); the settlement
token uses 1e6 (USDC precision — amounts carry over unchanged to bridged USDC on
mainnet). Collateral rounds up, payouts round down, so `payout ≤ collateral` holds
unconditionally (fuzz-tested).

**MVP trust assumptions.** (1) The desk quote signer prices fairly; it cannot move
collateral. (2) After `fallbackDelay` (default 3 days) past expiry the owner can settle
with a manual price as an oracle-outage escape hatch. Both are explicit, temporary, and
designed out in later phases (RFQ maker competition; permissionless keeper settlement).

## Roadmap

- **Now:** transparent desk MVP on GIWA Sepolia, 20s quotes over Flashblocks.
- **Next:** RedStone as a second oracle behind the same `IOracleAdapter` seam;
  up.id name resolution in the UI; bridged-USDC settlement on mainnet.
- **Compliance-ready:** Dojang (`isVerified`) integration is a one-line gate if
  verified-wallet tiers become a requirement — kept out of the MVP deliberately.

## License

MIT
