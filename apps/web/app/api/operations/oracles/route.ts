import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { readOracleWorkerHealth } from "@/lib/oracle/health";

export const runtime = "nodejs";

export async function GET() {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  if (session.role !== "insurerAdmin" && session.role !== "auditor") return NextResponse.json({ message: "Oracle operations are visible to insurer and auditor roles" }, { status: 403 });
  const [oracle1, oracle2, requests] = await Promise.all([
    readOracleWorkerHealth("oracle1"), readOracleWorkerHealth("oracle2"), ledger.listOracleRequests(),
  ]);
  const finalized = requests.filter((item) => item.status !== "PENDING");
  return NextResponse.json({
    workers: [oracle1, oracle2],
    metrics: {
      requests: requests.length,
      pending: requests.filter((item) => item.status === "PENDING").length,
      agreements: requests.filter((item) => item.finalizationCode === "EXACT_CONSENSUS" || item.finalizationCode === "NEGATIVE_RESULT").length,
      conflicts: requests.filter((item) => item.finalizationCode === "CONFLICT").length,
      timeouts: requests.filter((item) => item.finalizationCode === "TIMEOUT").length,
      finalized: finalized.length,
    },
  });
}
