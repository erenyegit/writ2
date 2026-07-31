/** Hand-curated ABI slices for the UI. Keep in sync with contracts/src. */

export const coreAbi = [
  {
    type: "function",
    name: "writeOption",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "q",
        type: "tuple",
        components: [
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
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
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
  {
    type: "function",
    name: "getPosition",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "",
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
    name: "getWriterPositionIds",
    stateMutability: "view",
    inputs: [{ name: "writer", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "deskBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalOpenCollateral",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const pythAbi = [
  {
    type: "function",
    name: "getUpdateFee",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ name: "feeAmount", type: "uint256" }],
  },
] as const;

export interface OnchainPosition {
  writer: `0x${string}`;
  isPut: boolean;
  strike: bigint;
  cap: bigint;
  qty: bigint;
  expiry: bigint;
  collateral: bigint;
  premium: bigint;
  payout: bigint;
  settlementPrice: bigint;
  state: number; // 0 none, 1 open, 2 settled
}

export const faucetAbi = [
  {
    type: "function",
    name: "faucet",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "faucetCooldown",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
