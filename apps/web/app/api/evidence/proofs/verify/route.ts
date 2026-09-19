import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";

export const runtime = "nodejs";
const requestSchema = z.object({
  batchId: z.string().trim().min(1).max(128),
  evidenceId: z.string().trim().min(1).max(128),
  proof: z.array(z.object({ hash: z.string().regex(/^[a-fA-F0-9]{64}$/), position: z.enum(["LEFT", "RIGHT"]) })).max(16),
});

export async function POST(request: Request) {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  if (!new Set(["policyholder", "insurerAdmin", "auditor"]).has(session.role)) {
    return NextResponse.json({ message: "This role cannot verify evidence proofs" }, { status: 403 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Invalid evidence proof" }, { status: 400 });
  try {
    if (session.role === "policyholder") {
      const evidence = await ledger.readEvidenceReference(parsed.data.evidenceId);
      const claim = await ledger.readClaim(evidence.claimId);
      if (claim.claimantId !== session.subjectId) {
        return NextResponse.json({ message: "Evidence is not owned by this account" }, { status: 403 });
      }
    }
    const result = await ledger.verifyEvidenceInclusion(parsed.data.batchId, parsed.data.evidenceId, JSON.stringify(parsed.data.proof));
    return NextResponse.json({ verification: result }, { status: result.included ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Evidence proof verification failed" }, { status: 502 });
  }
}
