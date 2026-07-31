import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

import { bsCappedCall, bsPut } from "./bs";
import { deskConfig } from "./config";

const YEAR_SEC = 365 * 24 * 3600;

const account = privateKeyToAccount(deskConfig.quoterPrivateKey);
export const quoterAddress = account.address;

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
    { name: "isPut", type: "bool" },
    { name: "strike", type: "uint64" },
    { name: "cap", type: "uint64" },
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
  capUsd?: number; // required for calls
  qtyBtc: number;
  expiry: number; // unix seconds
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export async function buildSignedQuote(req: QuoteRequest, spot: number) {
  const now = Math.floor(Date.now() / 1000);
  const T = (req.expiry - now) / YEAR_SEC;
  if (T <= 0) throw new Error("expiry is in the past");
  if (req.qtyBtc <= 0 || req.strikeUsd <= 0) throw new Error("invalid size or strike");
  if (!req.isPut && (!req.capUsd || req.capUsd <= req.strikeUsd)) {
    throw new Error("calls require cap > strike");
  }

  // Fair value per 1 BTC, then desk bid (desk buys volatility below fair).
  const fairPerBtc = req.isPut
    ? bsPut(spot, req.strikeUsd, T, deskConfig.iv, deskConfig.riskFreeRate)
    : bsCappedCall(spot, req.strikeUsd, req.capUsd!, T, deskConfig.iv, deskConfig.riskFreeRate);
  const fairUsd = fairPerBtc * req.qtyBtc;
  const bidUsd = fairUsd * (1 - deskConfig.spread);

  const premium = BigInt(Math.floor(bidUsd * 1e6)); // USDC 1e6
  if (premium <= 0n) throw new Error("premium rounds to zero — size too small");

  const strike = BigInt(Math.round(req.strikeUsd * 1e8));
  const cap = req.isPut ? 0n : BigInt(Math.round(req.capUsd! * 1e8));
  const qty = BigInt(Math.round(req.qtyBtc * 1e8));

  // Mirror of OptionMath.collateralUsdc (ceil).
  const product = req.isPut ? strike * qty : (cap - strike) * qty;
  const collateral = ceilDiv(product, 10n ** 10n);
  if (premium >= collateral) throw new Error("premium >= collateral — refusing to quote");

  const quote = {
    writer: req.writer,
    isPut: req.isPut,
    strike,
    cap,
    qty,
    expiry: BigInt(req.expiry),
    premium,
    quoteDeadline: BigInt(now + deskConfig.quoteTtlSec),
    nonce: BigInt("0x" + randomBytes(32).toString("hex")),
  };

  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: "Quote",
    message: quote,
  });

  return {
    quote: {
      writer: quote.writer,
      isPut: quote.isPut,
      strike: quote.strike.toString(),
      cap: quote.cap.toString(),
      qty: quote.qty.toString(),
      expiry: quote.expiry.toString(),
      premium: quote.premium.toString(),
      quoteDeadline: quote.quoteDeadline.toString(),
      nonce: quote.nonce.toString(),
    },
    signature,
    meta: {
      spotUsd: spot,
      ivAnnualized: deskConfig.iv,
      tenorYears: T,
      fairValueUsd: fairUsd,
      deskBidUsd: bidUsd,
      premiumUsdc: quote.premium.toString(),
      collateralUsdc: collateral.toString(),
      quoter: quoterAddress,
    },
  };
}
