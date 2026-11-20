import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { findDemoAccount } from "@/lib/auth/accounts";
import { ledger } from "@/lib/fabric/ledger";
import { ledgerIdSchema as id } from "@/lib/fabric/validation";
import { medicalDevLiteChannel } from "@/lib/fabric/medical-channel";
import { refreshHospitalRegistrySnapshot } from "@/lib/oracle/hospital-registry";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const action = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("activate") }),
  z.strictObject({ action: z.literal("propose"), hospitalId: id }),
  z.strictObject({ action: z.literal("attest"), id, rootHash: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET() {
  if (process.env.FABRIC_CHANNEL_NAME !== medicalDevLiteChannel) return reply({ message: "Development registry unavailable" }, 404);
  const session = await currentSession().catch(() => null);
  if (session?.role !== "insurerAdmin" && session?.role !== "hospitalOfficer") return reply({ message: "Registry access required" }, 403);
  try {
    const snapshots = await ledger.listOracleRegistrySnapshots();
    return reply({ snapshots: snapshots.filter(item => session.role === "insurerAdmin" || item.hospitalId === session.subjectId) });
  } catch {
    return reply({ message: "Registry unavailable" }, 502);
  }
}

export async function POST(request: Request) {
  if (process.env.FABRIC_CHANNEL_NAME !== medicalDevLiteChannel) return reply({ message: "Development registry unavailable" }, 404);
  const origin = checkMutationOrigin(request);
  if (!origin.trusted) return reply({ message: origin.reason }, 403);
  const session = await currentSession().catch(() => null);
  const input = action.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ message: "Invalid registry action" }, 400);
  if (!session || session.role !== (input.data.action === "attest" ? "hospitalOfficer" : "insurerAdmin")) {
    return reply({ message: "This role cannot perform that action" }, 403);
  }
  try {
    if (input.data.action === "activate") return reply({ result: await ledger.activateMedicalApprovals() });
    if (input.data.action === "attest") {
      return reply({ result: await ledger.attestMedicalRegistrySnapshot(findDemoAccount(session.accountId)?.fabricUserName, input.data.id, input.data.rootHash) });
    }
    const proposal = await refreshHospitalRegistrySnapshot(input.data.hospitalId);
    return proposal ? reply({ result: { id: proposal.snapshotId, rootHash: proposal.rootHash } })
      : reply({ message: "No linked medical episodes for this hospital" }, 409);
  } catch (error) {
    return reply({ message: error instanceof Error ? error.message.slice(0, 280) : "Registry action did not commit" }, 409);
  }
}
