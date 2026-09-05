import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import {
  evidenceStorageReference,
  evidenceStorageRoot,
  hashValue,
  readCiphertext,
} from "@/lib/evidence/storage";
import { ledger } from "@/lib/fabric/ledger";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const idSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/);
type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });

  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ message: "Invalid evidence ID" }, { status: 400 });

  try {
    const evidence = await ledger.readEvidenceReference(id.data);
    const claim = await ledger.readClaim(evidence.claimId);
    const authorized =
      session.role === "insurerAdmin" ||
      (session.role === "policyholder" && claim.claimantId === session.subjectId) ||
      (session.role === "hospitalOfficer" && (claim.status === "SUBMITTED" || Boolean(claim.hospitalVerificationId))) ||
      (session.role === "auditor" && !["SUBMITTED", "HOSPITAL_VERIFIED"].includes(claim.status));
    if (!authorized) return NextResponse.json({ message: "This account cannot retrieve that evidence" }, { status: 403 });

    const reference = evidenceStorageReference(evidence.submittedBy, evidence.id);
    if (hashValue(reference) !== evidence.storageReferenceHash) {
      return NextResponse.json({ message: "Evidence storage reference failed integrity validation" }, { status: 409 });
    }

    const ciphertext = await readCiphertext(evidenceStorageRoot(), evidence.submittedBy, evidence.id);
    const purpose = session.role === "hospitalOfficer"
      ? "VERIFY"
      : session.role === "auditor" ? "AUDIT" : "DOWNLOAD";
    await ledger.recordEvidenceAccess(session.role, {
      id: `access-${randomUUID()}`,
      evidenceId: evidence.id,
      purpose,
    });
    return new NextResponse(ciphertext, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${evidence.id}.enc"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        "x-ciphertext-sha256": hashValue(ciphertext),
        "x-content-sha256": evidence.contentHash,
        "x-evidence-claim-id": evidence.claimId,
      },
    });
  } catch (error) {
    console.error("Evidence retrieval failed", error);
    return NextResponse.json({ message: "Evidence ciphertext was not found" }, { status: 404 });
  }
}
