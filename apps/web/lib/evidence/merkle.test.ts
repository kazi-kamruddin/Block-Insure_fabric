import { describe, expect, it } from "vitest";
import type { EvidenceReference } from "@/lib/fabric/types";
import { buildEvidenceMerkleTree, evidenceLeafHash, verifyEvidenceMerkleProof } from "./merkle";

const evidence = (id: string, content: string): EvidenceReference => ({
  assetType: "evidenceReference", schemaVersion: 12, id, claimId: "claim-1", claimVersion: 1,
  documentType: "INVOICE", contentHash: content.repeat(64), storageReferenceHash: "f".repeat(64),
  submittedBy: "policyholder1", createdAt: "2026-09-05T12:00:00Z",
});

describe("evidence Merkle proofs", () => {
  it("sorts leaves, supports odd batches, and rejects tampering", () => {
    const items = [evidence("evidence-c", "c"), evidence("evidence-a", "a"), evidence("evidence-b", "b")];
    const tree = buildEvidenceMerkleTree(items);
    expect(tree.evidenceIds).toEqual(["evidence-a", "evidence-b", "evidence-c"]);
    const target = items[0];
    const proof = tree.proofFor(target.id);
    expect(verifyEvidenceMerkleProof(evidenceLeafHash(target), proof, tree.rootHash)).toBe(true);
    expect(verifyEvidenceMerkleProof(evidenceLeafHash({ ...target, contentHash: "d".repeat(64) }), proof, tree.rootHash)).toBe(false);
  });

  it("uses the same ordinal ID ordering as Go chaincode", () => {
    const tree = buildEvidenceMerkleTree([
      evidence("evidence-a", "a"),
      evidence("evidence:A", "b"),
      evidence("Evidence-z", "c"),
    ]);
    expect(tree.evidenceIds).toEqual(["Evidence-z", "evidence-a", "evidence:A"]);
  });
});
