import { NextResponse } from "next/server";
import { buildReadinessPayload } from "@/lib/health/readiness";
import { readOracleWorkerHealth } from "@/lib/oracle/health";
import { ledger } from "@/lib/fabric/ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const expectedSchemaVersion = Number(process.env.FABRIC_EXPECTED_SCHEMA_VERSION ?? "12");
  const payload = await buildReadinessPayload({
    expectedSchemaVersion,
    fabricProbe: async () => ({ ok: true, schemaVersion: await ledger.schemaVersion() }),
    oracle1Probe: async () => ({ ok: (await readOracleWorkerHealth("oracle1")).status === "ONLINE" }),
    oracle2Probe: async () => ({ ok: (await readOracleWorkerHealth("oracle2")).status === "ONLINE" }),
  });
  return NextResponse.json(payload, {
    status: payload.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
