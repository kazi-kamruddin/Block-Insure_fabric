import { createHash } from "node:crypto";
import type { EvidenceReference, MerkleProofStep } from "@/lib/fabric/types";

export const evidenceLeafEncoding = "block-insure-evidence-leaf-v1" as const;

function canonicalHash(domain: string, ...values: Array<string | number>) {
  const parts = [domain, ...values.map((raw) => {
    const value = String(raw);
    return `${Buffer.byteLength(value, "utf8")}:${value}`;
  })];
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

export function evidenceLeafHash(evidence: EvidenceReference) {
  return canonicalHash(
    evidenceLeafEncoding,
    evidence.id,
    evidence.claimId,
    evidence.claimVersion,
    evidence.documentType,
    evidence.contentHash.toLowerCase(),
    evidence.storageReferenceHash.toLowerCase(),
  );
}

export function evidenceMerkleParent(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) throw new Error("Merkle parent inputs must be SHA-256 hashes");
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from([0x01]), Buffer.from(left, "hex"), Buffer.from(right, "hex")]))
    .digest("hex");
}

export function buildEvidenceMerkleTree(input: EvidenceReference[]) {
  if (input.length === 0) throw new Error("At least one evidence reference is required");
  // Fabric chaincode uses Go's ordinal string ordering. IDs are constrained to
  // ASCII, so an explicit relational comparator reproduces it exactly without
  // host-locale collation differences.
  const evidence = [...input].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (new Set(evidence.map((item) => item.id)).size !== evidence.length) throw new Error("Evidence IDs must be unique");
  const levels: string[][] = [evidence.map(evidenceLeafHash)];
  while (levels.at(-1)!.length > 1) {
    const current = levels.at(-1)!;
    const next: string[] = [];
    for (let index = 0; index < current.length; index += 2) next.push(evidenceMerkleParent(current[index], current[index + 1] ?? current[index]));
    levels.push(next);
  }
  function proofFor(evidenceId: string): MerkleProofStep[] {
    let index = evidence.findIndex((item) => item.id === evidenceId);
    if (index < 0) throw new Error(`Evidence ${evidenceId} is not in this Merkle batch`);
    const proof: MerkleProofStep[] = [];
    for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
      const level = levels[levelIndex];
      const siblingIndex = index % 2 === 0 ? Math.min(index + 1, level.length - 1) : index - 1;
      proof.push({ hash: level[siblingIndex], position: index % 2 === 0 ? "RIGHT" : "LEFT" });
      index = Math.floor(index / 2);
    }
    return proof;
  }
  return { evidence, evidenceIds: evidence.map((item) => item.id), rootHash: levels.at(-1)![0], proofFor };
}

export function verifyEvidenceMerkleProof(leafHash: string, proof: MerkleProofStep[], anchoredRoot: string) {
  return proof.reduce((current, step) => step.position === "LEFT"
    ? evidenceMerkleParent(step.hash, current)
    : evidenceMerkleParent(current, step.hash), leafHash) === anchoredRoot.toLowerCase();
}
