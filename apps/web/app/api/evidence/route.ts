import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import {
  evidenceStorageRoot,
  removeCiphertext,
  storeCiphertext,
} from "@/lib/evidence/storage";
import { ledger } from "@/lib/fabric/ledger";

const metadataSchema = z.object({
  claimId: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/),
  evidenceId: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/),
  documentType: z.string().trim().min(1).max(100),
  contentHash: z.string().trim().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase()),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
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
  let stored = false;
  try {
    const ciphertext = new Uint8Array(await file.arrayBuffer());
    const storage = await storeCiphertext(root, session.subjectId, evidenceId, ciphertext);
    stored = true;
    const ledgerReference = await ledger.addEvidenceReference({
      claimId,
      evidenceId,
      documentType,
      contentHash,
      storageReferenceHash: storage.referenceHash,
    });
    return NextResponse.json({
      result: ledgerReference,
      ciphertextHash: storage.ciphertextHash,
    });
  } catch (error) {
    if (stored) await removeCiphertext(root, session.subjectId, evidenceId).catch(() => undefined);
    console.error("Evidence upload failed", error);
    const conflict = error instanceof Error && /exist/i.test(error.message);
    return NextResponse.json(
      { message: conflict ? "Evidence ciphertext already exists" : "Evidence upload failed" },
      { status: conflict ? 409 : 422 },
    );
  }
}
