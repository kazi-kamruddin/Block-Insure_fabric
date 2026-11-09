import { decryptEvidenceBytes, encryptEvidenceBytes, type EvidenceEncryptionContext } from "./browser-crypto";

type RecoveryFile = { version: "bif-key-backup-v1"; claimId: string; evidenceId: string; envelope: string };
const contextFor = (context: EvidenceEncryptionContext) => ({ claimId: `key-backup:${context.claimId}`, evidenceId: `key-backup:${context.evidenceId}` });

// Reuses the existing BIF1 authenticated encryption. The server never receives
// the content passphrase, backup password or decrypted recovery payload.
export async function createEvidenceRecovery(passphrase: string, backupPassword: string, context: EvidenceEncryptionContext, contentHash: string) {
  if (passphrase.length < 12 || backupPassword.length < 12 || passphrase === backupPassword) throw new Error("Use separate evidence and backup passwords with at least 12 characters.");
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("Expected content hash is required.");
  const payload = new TextEncoder().encode(JSON.stringify({ passphrase, contentHash }));
  const encrypted = await encryptEvidenceBytes(payload, backupPassword, contextFor(context));
  const file: RecoveryFile = { version: "bif-key-backup-v1", ...context,
    envelope: btoa(Array.from(encrypted.envelope, (byte) => String.fromCharCode(byte)).join("")) };
  const text = JSON.stringify(file);
  if (text.length > 16_384) throw new Error("Recovery payload exceeds the supported size.");
  return text;
}

export async function restoreEvidenceRecovery(text: string, backupPassword: string) {
  if (text.length > 16_384) throw new Error("Recovery file exceeds the supported size.");
  const file = JSON.parse(text) as RecoveryFile;
  if (file.version !== "bif-key-backup-v1" || typeof file.claimId !== "string" || !file.claimId.trim() ||
      typeof file.evidenceId !== "string" || !file.evidenceId.trim() || typeof file.envelope !== "string") throw new Error("Invalid recovery file.");
  const bytes = Uint8Array.from(atob(file.envelope), (value) => value.charCodeAt(0));
  const plaintext = await decryptEvidenceBytes(bytes, backupPassword, contextFor(file));
  const restored = JSON.parse(new TextDecoder().decode(plaintext)) as { passphrase: string; contentHash: string };
  if (typeof restored.passphrase !== "string" || restored.passphrase.length < 12 || !/^[a-f0-9]{64}$/.test(restored.contentHash)) throw new Error("Invalid recovery payload.");
  return { claimId: file.claimId, evidenceId: file.evidenceId, ...restored };
}
