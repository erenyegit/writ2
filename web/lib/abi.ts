/** Hand-curated ABI slices for the UI. Keep in sync with contracts/src. */

const quoteTuple = {
  name: "q",
  type: "tuple",
  components: [
    { name: "writer", type: "address" },
    { name: "isPut", type: "bool" },
    { name: "strike", type: "uint64" },
    { name: "qty", type: "uint64" },
    { name: "expiry", type: "uint64" },
    { name: "premium", type: "uint128" },
    { name: "quoteDeadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const view = (name: string, type = "uint256") =>
  ({ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ name: "", type }] }) as const;

export const coreAbi = [
  {
    type: "function",
    name: "writeOption",
    stateMutability: "nonpayable",
    inputs: [quoteTuple, { name: "signature", type: "bytes" }],
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
    name: "settleMany",
    stateMutability: "payable",
    inputs: [
      { name: "ids", type: "uint256[]" },
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
          { name: "qty", type: "uint64" },
          { name: "expiry", type: "uint64" },
          { name: "collateral", type: "uint128" },
          { name: "premium", type: "uint128" },
          { name: "settlementPrice", type: "uint64" },
          { name: "assigned", type: "bool" },
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
    name: "deskCapacity",
    stateMutability: "view",
    inputs: [
      { name: "isPut", type: "bool" },
      { name: "strike", type: "uint64" },
      { name: "qty", type: "uint64" },
    ],
    outputs: [{ name: "positions", type: "uint256" }],
  },
  view("deskUsdcFree"),
  view("deskUsdcReserved"),
  view("deskBtcFree"),
  view("deskBtcReserved"),
  view("writerUsdcCollateral"),
  view("writerBtcCollateral"),
  view("totalOpenNotional"),
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

export const faucetAbi = [
  { type: "function", name: "faucet", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "faucetCooldown",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface OnchainPosition {
  writer: `0x${string}`;
  isPut: boolean;
  strike: bigint;
  qty: bigint;
  expiry: bigint;
  /** USDC (1e6) for puts, the underlying (1e8) for covered calls. */
  collateral: bigint;
  premium: bigint;
  settlementPrice: bigint;
  /** True when the two sides swapped at the strike. */
  assigned: boolean;
  state: number; // 0 none, 1 open, 2 settled
}
