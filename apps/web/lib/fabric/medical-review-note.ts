import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type NoteKind = "question" | "answer" | "appeal";

function noteKey() {
  const key = process.env.FABRIC_MEDICAL_REVIEW_NOTE_KEY ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error("Medical review message key is unavailable.");
  return Buffer.from(key, "hex");
}

function noteContext(kind: NoteKind, id: string) {
  return Buffer.from(JSON.stringify(["fabric-medical-review-note-v1", kind, id]));
}

export function sealMedicalReviewNote(kind: NoteKind, id: string, text: string) {
  const message = Buffer.from(text.trim());
  if (!message.length || message.length > 2000) throw new Error("Use a message of 1 to 2000 UTF-8 bytes.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", noteKey(), nonce);
  cipher.setAAD(noteContext(kind, id));
  const ciphertext = Buffer.concat([cipher.update(message), cipher.final()]);
  return "v1." + Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function openMedicalReviewNote(kind: NoteKind, id: string, envelope: string) {
  if (!envelope.startsWith("v1.")) throw new Error("Unknown medical review message version.");
  const data = Buffer.from(envelope.slice(3), "base64url");
  if (data.length <= 28 || data.length > 2028) throw new Error("Invalid medical review message.");
  const cipher = createDecipheriv("aes-256-gcm", noteKey(), data.subarray(0, 12));
  cipher.setAAD(noteContext(kind, id));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8");
}
