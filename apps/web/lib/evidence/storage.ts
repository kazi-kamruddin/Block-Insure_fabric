import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const safeSegment = /^[a-zA-Z0-9._:-]+$/;

function assertSafeSegment(name: string, value: string) {
  if (!safeSegment.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid ${name}`);
  }
}

export function evidenceStorageRoot(environment: NodeJS.ProcessEnv = process.env) {
  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    environment.EVIDENCE_STORAGE_ROOT ?? "../../data/evidence",
  );
}

export function evidenceStorageReference(subjectId: string, evidenceId: string) {
  assertSafeSegment("subject ID", subjectId);
  assertSafeSegment("evidence ID", evidenceId);
  return `${subjectId}/${evidenceId}.enc`;
}

export function hashValue(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function evidencePath(root: string, reference: string) {
  const target = path.resolve(root, ...reference.split("/"));
  const relative = path.relative(path.resolve(root), target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Evidence path escapes its storage root");
  }
  return target;
}

export async function storeCiphertext(
  root: string,
  subjectId: string,
  evidenceId: string,
  ciphertext: Uint8Array,
) {
  const reference = evidenceStorageReference(subjectId, evidenceId);
  const target = evidencePath(root, reference);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, ciphertext, { flag: "wx", mode: 0o600 });
  return {
    reference,
    referenceHash: hashValue(reference),
    ciphertextHash: hashValue(ciphertext),
  };
}

export async function readCiphertext(root: string, subjectId: string, evidenceId: string) {
  const reference = evidenceStorageReference(subjectId, evidenceId);
  return fs.readFile(evidencePath(root, reference));
}

export async function removeCiphertext(root: string, subjectId: string, evidenceId: string) {
  const reference = evidenceStorageReference(subjectId, evidenceId);
  await fs.rm(evidencePath(root, reference), { force: true });
}
