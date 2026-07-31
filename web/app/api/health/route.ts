import { NextResponse } from "next/server";

import { deskConfig } from "@/lib/desk/config";
import { quoterAddress } from "@/lib/desk/quote";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, quoter: quoterAddress, chainId: deskConfig.chainId });
}
