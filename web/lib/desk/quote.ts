import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

import { bsCall, bsPut } from "./bs";
import { deskConfig } from "./config";
import { deskSpread, impliedVol } from "./surface";

const YEAR_SEC = 365 * 24 * 3600;

/** Derived on first use, not at module load: the build should never need to
 *  resolve a secret just to collect route metadata. */
let cachedAccount: ReturnType<typeof privateKeyToAccount> | undefined;
function deskAccount() {
  cachedAccount ??= privateKeyToAccount(deskConfig.quoterPrivateKey);
  return cachedAccount;
}

export const quoterAddress = () => deskAccount().address;

/** EIP-712 domain — must match WritOptions' EIP712("WritOptions", "1"). */
const domain = {
  name: "WritOptions",
  version: "1",
  chainId: deskConfig.chainId,
  verifyingContract: deskConfig.coreAddress,
} as const;

/** Must match QUOTE_TYPEHASH in WritOptions.sol field-for-field. */
const types = {
  Quote: [
    { name: "writer", type: "address" },
    { name: "maker", type: "address" },
    { name: "isPut", type: "bool" },
    { name: "strike", type: "uint64" },
    { name: "qty", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "premium", type: "uint128" },
    { name: "quoteDeadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface QuoteRequest {
  writer: `0x${string}`;
  isPut: boolean;
  strikeUsd: number;
  qtyBtc: number;
  expiry: number; // unix seconds
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export async function buildSignedQuote(req: QuoteRequest, spot: number) {
  const now = Math.floor(Date.now() / 1000);
  const T = (req.expiry - now) / YEAR_SEC;
  if (T <= 0) throw new Error("expiry is in the past");
  if (req.qtyBtc <= 0 || req.strikeUsd <= 0) throw new Error("invalid size or strike");

  // Vol comes from the surface, so a far strike and a near one are not priced
  // off the same number.
  const iv = impliedVol(spot, req.strikeUsd, T);
  // A covered call is the plain, uncapped call: the underlying it posts covers
  // its own upside, so there is no short leg to subtract.
  const fairPerBtc = req.isPut
    ? bsPut(spot, req.strikeUsd, T, iv, deskConfig.riskFreeRate)
    : bsCall(spot, req.strikeUsd, T, iv, deskConfig.riskFreeRate);
  const spread = deskSpread(spot, req.strikeUsd, T);
  const fairUsd = fairPerBtc * req.qtyBtc;
  const bidUsd = fairUsd * (1 - spread);

  const premium = BigInt(Math.floor(bidUsd * 1e6)); // USDC 1e6
  if (premium <= 0n) throw new Error("premium rounds to zero — size too small");

  const strike = BigInt(Math.round(req.strikeUsd * 1e8));
  const qty = BigInt(Math.round(req.qtyBtc * 1e8));

  // Mirror of OptionMath.notionalUsdc — the cash side of the trade, quoted
  // once so a put's collateral and a covered call's proceeds always agree.
  const notional = ceilDiv(strike * qty, 10n ** 10n);
  if (premium >= notional) throw new Error("premium >= notional — refusing to quote");
  // A put locks that cash; a covered call locks the underlying, one for one.
  const collateral = req.isPut ? notional : qty;

  const quote = {
    writer: req.writer,
    maker: deskConfig.makerAddress,
    isPut: req.isPut,
    strike,
    qty,
    expiry: BigInt(req.expiry),
    premium,
    quoteDeadline: BigInt(now + deskConfig.quoteTtlSec),
    nonce: BigInt("0x" + randomBytes(32).toString("hex")),
  };

  const signature = await deskAccount().signTypedData({
    domain,
    types,
    primaryType: "Quote",
    message: quote,
  });

  return {
    quote: {
      writer: quote.writer,
      maker: quote.maker,
      isPut: quote.isPut,
      strike: quote.strike.toString(),
      qty: quote.qty.toString(),
      expiry: quote.expiry.toString(),
      premium: quote.premium.toString(),
      quoteDeadline: quote.quoteDeadline.toString(),
      nonce: quote.nonce.toString(),
    },
    signature,
    meta: {
      spotUsd: spot,
      ivAnnualized: iv,
      deskSpread: spread,
      tenorYears: T,
      fairValueUsd: fairUsd,
      deskBidUsd: bidUsd,
      premiumUsdc: quote.premium.toString(),
      collateralUsdc: collateral.toString(),
      collateralAsset: req.isPut ? ("usdc" as const) : ("btc" as const),
      notionalUsdc: notional.toString(),
      /**
       * The premium as an annualized rate on the capital it locks up. This is
       * the number a writer actually compares between strikes and tenors; a
       * raw premium says nothing without the tenor beside it.
       */
      /** Both products commit full notional, so the rates are comparable:
       *  a put locks the cash, a covered call locks an asset worth about it. */
      aprPct:
        (Number(premium) / 1e6 / (req.isPut ? (Number(notional) / 1e6) : req.qtyBtc * spot) / T) *
        100,
      maker: deskConfig.makerAddress,
      quoter: quoterAddress(),
    },
  };
}
