import { NextResponse } from "next/server";
import { z } from "zod";
import { ledgerIdSchema } from "@/lib/fabric/validation";
import { currentSession } from "@/lib/auth/current-session";
import {
  evidenceStorageRoot,
  readCiphertext,
  hashValue,
  evidenceStorageReference,
  storeCiphertext,
} from "@/lib/evidence/storage";
import { ledger } from "@/lib/fabric/ledger";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const metadataSchema = z.object({
  claimId: ledgerIdSchema,
  evidenceId: ledgerIdSchema,
  documentType: z.string().trim().min(1).max(100).transform((value) => value.toUpperCase()),
  contentHash: z.string().trim().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase()),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });

  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  if (session.role !== "policyholder" || !session.subjectId) {
    return NextResponse.json({ message: "Only a policyholder can upload claim evidence" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("ciphertext");
  const parsed = metadataSchema.safeParse({
    claimId: form?.get("claimId"),
    evidenceId: form?.get("evidenceId"),
    documentType: form?.get("documentType"),
    contentHash: form?.get("contentHash"),
  });
  if (!parsed.success || !(file instanceof File)) {
    return NextResponse.json({ message: "Invalid evidence upload" }, { status: 400 });
  }

  const maximumBytes = Number(process.env.EVIDENCE_MAX_UPLOAD_BYTES ?? 10_485_760);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    return NextResponse.json({ message: "Evidence upload is not configured" }, { status: 503 });
  }
  if (file.size === 0 || file.size > maximumBytes || !file.name.toLowerCase().endsWith(".enc")) {
    return NextResponse.json(
      { message: `Upload a non-empty .enc ciphertext file no larger than ${maximumBytes} bytes` },
      { status: 400 },
    );
  }

  const root = evidenceStorageRoot();
  const { claimId, evidenceId, documentType, contentHash } = parsed.data;
  try {
    const claim = await ledger.readClaim(claimId);
    if (claim.claimantId !== session.subjectId) return NextResponse.json({ message: "This claim belongs to another subject" }, { status: 403 });
    const ciphertext = new Uint8Array(await file.arrayBuffer());
    const subjectId = session.subjectId;
    const storage = await storeCiphertext(root, subjectId, evidenceId, ciphertext).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      const retained = await readCiphertext(root, subjectId, evidenceId);
      if (hashValue(retained) !== hashValue(ciphertext)) throw new Error("Existing evidence ciphertext differs; preserve the original bytes");
      const reference = evidenceStorageReference(subjectId, evidenceId);
      return { reference, referenceHash: hashValue(reference), ciphertextHash: hashValue(retained) };
    });
    async function recoverReference() {
      const found = await ledger.readEvidenceReference(evidenceId).catch((error: unknown) => {
        if (String(error).includes("does not exist")) return null;
        throw error;
      });
      if (found && (found.claimId !== claimId || found.claimVersion !== claim.version || found.submittedBy !== subjectId ||
          found.documentType !== documentType || found.contentHash !== contentHash || found.storageReferenceHash !== storage.referenceHash)) {
        throw new Error("Existing evidence reference conflicts with this upload; do not replace original bytes");
      }
      return found;
    }
    const existing = await recoverReference();
    if (existing) return NextResponse.json({ result: existing, ciphertextHash: storage.ciphertextHash, recovered: true });
    try {
      const ledgerReference = await ledger.addEvidenceReference({
      claimId,
      evidenceId,
      documentType,
      contentHash,
      storageReferenceHash: storage.referenceHash,
      expectedClaimVersion: claim.version,
      });
      return NextResponse.json({ result: ledgerReference, ciphertextHash: storage.ciphertextHash });
    } catch {
      const committed = await recoverReference().catch(() => null);
      if (committed) return NextResponse.json({ result: committed, ciphertextHash: storage.ciphertextHash, recovered: true });
      return NextResponse.json({ status: "PENDING_RECONCILIATION", evidenceId, ciphertextHash: storage.ciphertextHash,
        message: "Ciphertext retained. Ledger linkage is unresolved; retry these exact bytes and identifiers to recover, without uploading replacement evidence." }, { status: 202 });
    }
  } catch (error) {
    console.error("Evidence upload failed", error);
    const conflict = error instanceof Error && /exist/i.test(error.message);
    return NextResponse.json(
      { message: conflict ? "Evidence ciphertext already exists" : "Evidence upload failed" },
      { status: conflict ? 409 : 422 },
    );
  }
}
