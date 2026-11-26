import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AuditorDecision } from "./types";
import { canonicalProtocolInput } from "./canonical-protocol";

type Reason = { text: string; evidenceRefs: string[] };
type Scope = { reviewId: string; round: number; auditorId: string };

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function matchesReason(text: string, decision: AuditorDecision) {
  return Boolean(decision.reasonCode &&
    digest(canonicalProtocolInput("medical-reason-v1", decision.reasonCode, digest(text))) === decision.reasonHash.toLowerCase());
}

function key() {
  const hex = process.env.FABRIC_MEDICAL_REVIEW_REASON_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("The review reason encryption key is unavailable");
  return Buffer.from(hex, "hex");
}

// Preserve ordinary demo identifiers. Hash other identifiers into a separate
// namespace to avoid reserved filenames, path traversal and Windows case folding.
function component(id: string) {
  return /^[a-z0-9_-]{3,128}$/.test(id) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id) ? id : "~" + digest(id);
}

function location(scope: Scope, kind: "draft" | "bound", id: string) {
  const directory = path.resolve(process.env.MEDICAL_REVIEW_REASON_ROOT || "../../data/dev-lite/review-reasons",
    component(scope.reviewId), component(scope.auditorId));
  return {
    file: path.join(directory, kind === "bound" ? "bound" : "", component(id) + ".enc"),
    aad: Buffer.from(JSON.stringify(["fabric-medical-review-reason-v1", kind, scope.reviewId, scope.round, scope.auditorId, id])),
  };
}

async function writeReason(place: ReturnType<typeof location>, reason: Reason) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(place.aad);
  const bytes = Buffer.concat([nonce, cipher.update(JSON.stringify(reason), "utf8"), cipher.final(), cipher.getAuthTag()]);
  await fs.mkdir(path.dirname(place.file), { recursive: true });
  const temporary = place.file + "." + randomUUID() + ".tmp";
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, place.file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return false;
    }
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}

async function readReason(place: ReturnType<typeof location>): Promise<Reason | null> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(place.file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAAD(place.aad);
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8")) as Reason;
}

export async function saveReasonDraft(scope: Scope, attemptId: string, reason: Reason) {
  const draft = location(scope, "draft", attemptId);
  if (await writeReason(draft, reason)) return true;
  const existing = await readReason(draft);
  return existing?.text === reason.text && JSON.stringify(existing.evidenceRefs) === JSON.stringify(reason.evidenceRefs);
}

export async function bindReasonDraft(scope: Scope, attemptId: string, decision: AuditorDecision) {
  const reason = await readReason(location(scope, "draft", attemptId));
  if (!reason || !matchesReason(reason.text, decision)) return false;
  const bound = location(scope, "bound", decision.id);
  if (await writeReason(bound, reason)) return true;
  const existing = await readReason(bound);
  return Boolean(existing && matchesReason(existing.text, decision));
}

export async function readBoundReason(decision: AuditorDecision) {
  const scope = { reviewId: decision.reviewId, round: decision.reviewRound, auditorId: decision.auditorId };
  const receipt = { decisionId: decision.id, auditorId: decision.auditorId };
  try {
    const reason = await readReason(location(scope, "bound", decision.id));
    if (!reason) return null;
    if (matchesReason(reason.text, decision)) return { ...receipt, ...reason, matchesLedgerHash: true };
  } catch {
    // A corrupt or unreadable bound receipt cannot authenticate the reason.
  }
  return { ...receipt, text: null, evidenceRefs: [], matchesLedgerHash: false };
}
