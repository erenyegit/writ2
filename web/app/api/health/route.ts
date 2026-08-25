import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";

import { coreAbi } from "@/lib/abi";
import { giwaSepolia } from "@/lib/chain";
import { deskConfig, usingDevKey } from "@/lib/desk/config";
import { quoterAddress } from "@/lib/desk/quote";

export const dynamic = "force-dynamic";

/**
 * Liveness plus the two things that actually stop the desk quoting: a signer
 * that cannot be trusted, and a balance too thin to pay the next premium.
 */
export async function GET() {
  const base = {
    ok: true,
    chainId: deskConfig.chainId,
    core: deskConfig.coreAddress,
    quoter: quoterAddress(),
    devKey: usingDevKey(),
  };

  try {
    const client = createPublicClient({ chain: giwaSepolia, transport: http() });
    const [deskBalance, locked] = await Promise.all([
      client.readContract({
        abi: coreAbi,
        address: deskConfig.coreAddress,
        functionName: "deskBalance",
      }) as Promise<bigint>,
      client.readContract({
        abi: coreAbi,
        address: deskConfig.coreAddress,
        functionName: "totalOpenCollateral",
      }) as Promise<bigint>,
    ]);

    const low = deskBalance < deskConfig.lowLiquidityUsdc;
    return NextResponse.json({
      ...base,
      deskBalanceUsdc: deskBalance.toString(),
      lockedCollateralUsdc: locked.toString(),
      lowLiquidity: low,
      ...(low && { warning: "desk liquidity below threshold — quotes may start failing" }),
    });
  } catch (err) {
    // The desk is still up even when the RPC is not; say so rather than 500.
    return NextResponse.json({
      ...base,
      deskBalanceUsdc: null,
      readError: err instanceof Error ? err.message.split("\n")[0] : "rpc unreachable",
    });
  }
}
