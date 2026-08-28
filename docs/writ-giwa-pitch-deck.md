# Writ — Pitch Deck

**Options income, physically settled on GIWA.**
GASOK application · Track: DeFi / RWA

---

## Slide 1 — Title

# Writ

### Get paid for a price you already believe in.

A physically settled, fully collateralized options desk on GIWA. No leverage,
no liquidations, no margin calls — a premium paid the moment you take a position,
and the price you named if it comes.

*Live on GIWA Sepolia · github.com/erenyegit/writ2*

---

## Slide 2 — The behaviour already exists

Every holder has a price in their head.

> *"I'd buy BTC at $74,000."*
> *"I'd sell at $82,000."*

Today that conviction sits idle in a spreadsheet or a limit order that earns
nothing while it waits.

**Writ pays you for it, upfront.**

---

## Slide 3 — What Writ is

**An on-chain options desk for income, not leverage.**

You sell one of two promises and receive the premium immediately:

| You believe | You sell | You lock | If it comes |
|---|---|---|---|
| BTC stays **above** your price | Cash-secured put | `strike × size` USDC | you buy BTC at your price |
| BTC stays **below** your price | Covered call | `size` in BTC | you sell BTC at your price |

Settlement is **physical**. The promise is a price, so the price is what you get.

---

## Slide 4 — How a trade works

**Four steps, under a second.**

1. **Request a quote** — every registered maker is asked at once, best bid wins
2. **The maker signs it** — EIP-712; the contract verifies that signature on-chain
3. **Collateral locks, premium lands** — preconfirmed in ~200ms
4. **Expiry settles itself** — the first Pyth price at or after expiry decides it

Nobody can influence the result by choosing *when* to claim.

---

## Slide 5 — Why this is structurally safer

Most on-chain derivatives fail the same way: leverage → liquidation → cascade.

**Writ removes the failure mode instead of managing it.**

- Every position is collateralized at its **full notional**
- Therefore: **no liquidations, no margin calls, no pooled risk** between writers
- Your worst case is fixed and visible **before** you sign
- The solvency invariant is fuzz-tested and holds on-chain, per asset

This matters in Korea specifically: **this is an income product, not a leveraged derivative.**

---

## Slide 6 — Physical settlement is the product

A cash-settled option pays you a difference. That is not what you asked for.

If you said *"I'd buy BTC at $74,000"* and BTC finishes at $70,000, a cash-settled
desk hands you a smaller balance. Writ hands you **BTC, at $74,000** — the price
you named, plus the premium you were already paid.

At expiry an option is either out of the money, and every leg goes back where it
came from, or assigned, and the two sides swap **in full** at the strike. There
is no partial payout, because there is no difference being settled.

---

## Slide 7 — Not a house, a venue

**The protocol is not the counterparty.**

Makers hold their own balances in the contract and sign their own quotes. Writing
an option reserves the side that maker may owe, so no position can be opened that
its counterparty could not honour.

- A quote names its maker; the signature is checked against **that maker's** key
- One maker's signer can never commit another's inventory
- Deactivating a maker stops it quoting and leaves its open positions untouched
- A request for quote asks every maker at once and shows the writer the best bid

One maker or twenty, the code path is identical.

---

## Slide 8 — It already works

**Deployed and verified end-to-end on GIWA Sepolia.**

| | |
|---|---|
| WritOptions | `0xd2f64c2fd06AA6B8c295d7C37CE6459D89B4f7B0` |
| PythAdapter | `0x484E61922DDc7E8f23586fC3B37a6206fcA8DCC6` |
| TestUSDC (public faucet) | `0x0b76264Bb1eD80e5FB219828464d0C809567e309` |
| TestBTC (public faucet) | `0xD23c5fA0f4029874be6338fdaDC66e81709DAbFf` |

- ✅ **49 tests passing**, including two solvency-invariant fuzz tests
- ✅ A **real option written on-chain**, with the maker's delivery reserved for it
- ✅ **Both invariants verified live**, one per collateral asset
- ✅ Contracts **verified with source** on sepolia-explorer.giwa.io

**Anyone can try it right now** — both assets have public faucets, so the demo
needs no hand-outs.

---

## Slide 9 — Why GIWA (the core thesis)

Writ runs on **signed quotes**. That design has exactly two weaknesses.
GIWA removes both **at the architecture level**.

### 1. Quote staleness → tighter spreads

A quote must survive until the writer's transaction lands. The longer it lives,
the more stale-price risk the maker carries — and prices into the spread.

**GIWA Flashblocks preconfirm in ~200ms.** So our quotes live **20 seconds instead of 60**.

> Three times less stale-price risk → less risk priced in → **the writer keeps more premium.**

### 2. No public mempool → no front-running

On GIWA only the sequencer sees pending transactions. A signed quote
**cannot be observed and traded against before it lands.**

**Neither property was bolted on. The same product is simply better here.**

---

## Slide 10 — The category is proven

We are not inventing demand. We are moving a validated product to a better venue.

- **Rysk** (same primitive, same two products, physically settled) processed
  **$240M+ in notional volume**
- Covered calls and cash-secured puts are among the oldest income strategies in finance
- Institutions already run this at scale — retail on-chain access is the gap

**Korea makes the timing right.** Retail appetite for derivatives is enormous, but
leveraged products are restricted domestically. An income product with fixed,
pre-disclosed maximum loss is a fundamentally different instrument — and GIWA,
built by Upbit, is where that audience already lives.

---

## Slide 11 — Roadmap

**Now — live on testnet**
Two products, physical settlement, maker accounts, RFQ ·
20-second quotes over Flashblocks · Pyth settlement · public faucets

**Phase 2 — depth**
External makers onboarded against the published quote API ·
RedStone as a second oracle behind the same adapter seam · position analytics

**Phase 3 — mainnet readiness**
Bridged USDC and wrapped BTC settlement · permissionless keeper settlement ·
higher maker capacity

**Phase 4 — market structure**
KRW-denominated strikes when a KRW stablecoin lands on GIWA ·
Dojang (`isVerified`) tiering if verified-wallet limits become a requirement

---

## Slide 12 — What we optimise for

| KPI | Why it's the right measure |
|---|---|
| **Notional written** | The real size of risk absorbed |
| **Unique writers** | Breadth, not a handful of whales |
| **Premium paid out** | Value actually delivered to users |
| **Settlement integrity** | 100% of expiries settled at the correct oracle price |
| **Competing bids per RFQ** | Whether this is becoming a market or staying a desk |
| **Effective spread** | Should tighten as Flashblocks lets us shorten quote TTL |

The last two are our GIWA-specific claims, and both are measurable.

---

## Slide 13 — Ask

**GASOK — DeFi / RWA track**

What we need most, in order:

1. **Mainnet launch support** on GIWA
2. **Maker onboarding** — the product improves with every counterparty added
3. **Distribution** into the Upbit ecosystem
4. **Grant** to fund maker inventory

---

## Slide 14 — Links

- **Live demo:** https://writ2.vercel.app
- **Code:** github.com/erenyegit/writ2
- **Explorer:** sepolia-explorer.giwa.io/address/0xd2f64c2fd06AA6B8c295d7C37CE6459D89B4f7B0
- **Network:** GIWA Sepolia · chain 91342

---

## Appendix — One-liners for Q&A

**"Where does the premium come from?"**
A market maker buys the option from you and pays the premium from its own
balance in the contract. It quotes below fair value — that spread is its edge.
Multiple makers compete on every request, so the spread is what the market will
bear rather than what one desk decides.

**"What's the worst case for a user?"**
For a put: you buy BTC at your strike when it is below that. For a covered call:
you sell your BTC at your strike when it is above that. Both are shown on the
ticket before signing, and you keep the premium either way.

**"Is BTC actually delivered?"**
Yes. Settlement is physical — that is the point. The counterparty reserves the
asset it may owe when the position opens, so delivery is guaranteed at expiry.

**"Why not just run this on any EVM chain?"**
It runs anywhere, but it prices better here. Quote-based venues are priced on
latency and orderflow privacy — GIWA gives both natively, so the same product
returns more premium to the writer.

**"Can a maker cheat on price?"**
No. A maker can only set premiums on its own quotes. It can never touch
collateral, another maker's inventory, or the settlement price, which comes from
Pyth's first tick at or after expiry.
