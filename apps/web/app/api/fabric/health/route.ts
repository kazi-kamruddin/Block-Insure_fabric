import { NextResponse } from "next/server";
import { ledger } from "@/lib/fabric/ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const schemaVersion = await ledger.schemaVersion();
    return NextResponse.json({
      status: "ok",
      channel: process.env.FABRIC_CHANNEL_NAME ?? "insurance-channel",
      chaincode: process.env.FABRIC_CHAINCODE_NAME ?? "insurance-contract",
      schemaVersion,
    });
  } catch (error) {
    console.error("Fabric health check failed", error);
    return NextResponse.json(
      { status: "unavailable", message: "Fabric Gateway is not reachable" },
      { status: 503 },
    );
  }
}
