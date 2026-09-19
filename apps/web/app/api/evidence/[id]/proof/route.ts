import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { buildEvidenceMerkleTree, evidenceLeafHash } from "@/lib/evidence/merkle";
import { ledger } from "@/lib/fabric/ledger";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };
const idSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/);

export async function GET(request: Request, context: RouteContext) {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  if (!new Set(["policyholder", "insurerAdmin", "auditor"]).has(session.role)) {
    return NextResponse.json({ message: "This role cannot export evidence proofs" }, { status: 403 });
  }
  const evidenceId = idSchema.safeParse((await context.params).id);
  const batchId = idSchema.safeParse(new URL(request.url).searchParams.get("batchId"));
  if (!evidenceId.success || !batchId.success) return NextResponse.json({ message: "Valid evidence and batch IDs are required" }, { status: 400 });
  try {
    const [evidence, batch] = await Promise.all([
      ledger.readEvidenceReference(evidenceId.data),
      ledger.readEvidenceMerkleBatch(batchId.data),
    ]);
    const claim = await ledger.readClaim(evidence.claimId);
    if (session.role === "policyholder" && claim.claimantId !== session.subjectId) {
      return NextResponse.json({ message: "Evidence is not owned by this account" }, { status: 403 });
    }
    const references = await Promise.all(batch.evidenceIds.map((id) => ledger.readEvidenceReference(id)));
    const tree = buildEvidenceMerkleTree(references);
    if (tree.rootHash !== batch.rootHash) throw new Error("Stored batch manifest does not reproduce its anchored root");
    const proof = tree.proofFor(evidence.id);
    const verification = await ledger.verifyEvidenceInclusion(batch.id, evidence.id, JSON.stringify(proof));
    const artifact = {
      schemaVersion: 1,
      batchId: batch.id,
      evidenceId: evidence.id,
      claimId: evidence.claimId,
      claimVersion: evidence.claimVersion,
      leafHash: evidenceLeafHash(evidence),
      rootHash: batch.rootHash,
      hashAlgorithm: batch.hashAlgorithm,
      leafEncoding: batch.leafEncoding,
      proof,
      verification,
    };
    const download = new URL(request.url).searchParams.get("download") === "1";
    return NextResponse.json(artifact, { headers: download ? { "content-disposition": `attachment; filename="${evidence.id}-merkle-proof.json"` } : undefined });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Evidence proof generation failed" }, { status: 502 });
  }
}
