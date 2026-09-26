import { NextResponse } from "next/server";
import { buildReadinessPayload } from "@/lib/health/readiness";
import { isOracleWorkerOperational, readOracleWorkerHealth } from "@/lib/oracle/health";
import { ledger } from "@/lib/fabric/ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const expectedSchemaVersion = Number(process.env.FABRIC_EXPECTED_SCHEMA_VERSION ?? "14");
  const payload = await buildReadinessPayload({
    expectedSchemaVersion,
    fabricProbe: async () => ({ ok: true, schemaVersion: await ledger.schemaVersion() }),
    oracle1Probe: async () => ({ ok: isOracleWorkerOperational((await readOracleWorkerHealth("oracle1")).status) }),
    oracle2Probe: async () => ({ ok: isOracleWorkerOperational((await readOracleWorkerHealth("oracle2")).status) }),
    oracle3Probe: async () => ({ ok: isOracleWorkerOperational((await readOracleWorkerHealth("oracle3")).status) }),
  });
  return NextResponse.json(payload, {
    status: payload.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
