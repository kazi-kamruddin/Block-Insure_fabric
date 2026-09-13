import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { findDemoAccount } from "@/lib/auth/accounts";
import {
  evidenceStorageReference,
  evidenceStorageRoot,
  hashValue,
  readCiphertext,
} from "@/lib/evidence/storage";
import { ledger } from "@/lib/fabric/ledger";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const idSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/);
const retrievalSchema = z.object({ grantId: idSchema.optional() });
type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });

  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ message: "Invalid evidence ID" }, { status: 400 });
  const retrieval = retrievalSchema.safeParse(await request.json().catch(() => ({})));
  if (!retrieval.success) return NextResponse.json({ message: "Invalid evidence retrieval request" }, { status: 400 });

  try {
    const evidence = await ledger.readEvidenceReference(id.data);
    const claim = await ledger.readClaim(evidence.claimId);
    const account = findDemoAccount(session.accountId);
    const auditorAssigned = session.role === "auditor" && Boolean(claim.currentReviewId)
      ? (await ledger.readClaimReview(claim.currentReviewId)).assignedAuditorIds.includes(session.subjectId ?? "")
      : false;
    const workflowAuthorized =
      session.role === "insurerAdmin" ||
      (session.role === "policyholder" && claim.claimantId === session.subjectId) ||
      (session.role === "hospitalOfficer" && claim.hospitalId === session.subjectId && ["SUBMITTED", "APPEAL_SUBMITTED"].includes(claim.status)) ||
      (session.role === "auditor" && auditorAssigned && !["SUBMITTED", "HOSPITAL_VERIFIED"].includes(claim.status));
    let grantAuthorized = false;
    if (retrieval.data.grantId && account) {
      const grant = await ledger.readEvidenceAccessGrant(retrieval.data.grantId);
      const expectedPurpose = session.role === "hospitalOfficer" ? "VERIFY" : session.role === "auditor" ? "AUDIT" : "DOWNLOAD";
      grantAuthorized = grant.evidenceId === evidence.id && grant.claimId === claim.id &&
        grant.status === "ACTIVE" && Date.parse(grant.expiresAt) > Date.now() &&
        grant.accessCount < grant.maxAccesses && grant.granteeMsp === account.organization &&
        grant.granteeRole === session.role && grant.purpose === expectedPurpose &&
        (grant.granteeSubject === "*" || grant.granteeSubject === session.subjectId);
    }
    if (!workflowAuthorized && !grantAuthorized) return NextResponse.json({ message: "This account cannot retrieve that evidence" }, { status: 403 });

    const reference = evidenceStorageReference(evidence.submittedBy, evidence.id);
    if (hashValue(reference) !== evidence.storageReferenceHash) {
      return NextResponse.json({ message: "Evidence storage reference failed integrity validation" }, { status: 409 });
    }

    const ciphertext = await readCiphertext(evidenceStorageRoot(), evidence.submittedBy, evidence.id);
    const purpose = session.role === "hospitalOfficer"
      ? "VERIFY"
      : session.role === "auditor" ? "AUDIT" : "DOWNLOAD";
    const accessInput = {
      id: `access-${randomUUID()}`,
      evidenceId: evidence.id,
      purpose,
    } as const;
    if (retrieval.data.grantId) {
      await ledger.recordGrantedEvidenceAccess(session.role, { ...accessInput, grantId: retrieval.data.grantId }, account?.fabricUserName);
    } else {
      await ledger.recordEvidenceAccess(session.role, accessInput, account?.fabricUserName);
    }
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
