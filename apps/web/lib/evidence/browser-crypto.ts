const encoder = new TextEncoder();
const magic = encoder.encode("BIF1");
const saltLength = 16;
const ivLength = 12;
const headerLength = magic.length + 4 + saltLength + ivLength;
export const evidenceKdfIterations = 310_000;

export type EvidenceEncryptionContext = {
  claimId: string;
  evidenceId: string;
};

export type EncryptedEvidence = {
  envelope: Uint8Array;
  contentHash: string;
};

function exactBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function associatedData(context: EvidenceEncryptionContext) {
  return encoder.encode(`block-insure-fabric:evidence:v1:${context.claimId}:${context.evidenceId}`);
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  provider: Crypto,
) {
  const material = await provider.subtle.importKey(
    "raw",
    exactBuffer(encoder.encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return provider.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: exactBuffer(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sha256Hex(bytes: Uint8Array, provider: Crypto = globalThis.crypto) {
  return hex(new Uint8Array(await provider.subtle.digest("SHA-256", exactBuffer(bytes))));
}

export async function encryptEvidenceBytes(
  plaintext: Uint8Array,
  passphrase: string,
  context: EvidenceEncryptionContext,
  provider: Crypto = globalThis.crypto,
): Promise<EncryptedEvidence> {
  if (plaintext.byteLength === 0) throw new Error("The evidence file is empty.");
  if (passphrase.length < 12) throw new Error("Use an evidence passphrase with at least 12 characters.");
  if (!context.claimId.trim() || !context.evidenceId.trim()) {
    throw new Error("Claim ID and evidence ID are required before encryption.");
  }

  const salt = provider.getRandomValues(new Uint8Array(saltLength));
  const iv = provider.getRandomValues(new Uint8Array(ivLength));
  const key = await deriveKey(passphrase, salt, evidenceKdfIterations, provider);
  const ciphertext = new Uint8Array(await provider.subtle.encrypt(
    { name: "AES-GCM", iv: exactBuffer(iv), additionalData: exactBuffer(associatedData(context)), tagLength: 128 },
    key,
    exactBuffer(plaintext),
  ));

  const envelope = new Uint8Array(headerLength + ciphertext.length);
  envelope.set(magic, 0);
  new DataView(envelope.buffer).setUint32(magic.length, evidenceKdfIterations, false);
  envelope.set(salt, magic.length + 4);
  envelope.set(iv, magic.length + 4 + saltLength);
  envelope.set(ciphertext, headerLength);

  return { envelope, contentHash: await sha256Hex(plaintext, provider) };
}

export async function decryptEvidenceBytes(
  envelope: Uint8Array,
  passphrase: string,
  context: EvidenceEncryptionContext,
  provider: Crypto = globalThis.crypto,
) {
  if (envelope.byteLength <= headerLength + 16) throw new Error("The evidence envelope is truncated.");
  if (!magic.every((byte, index) => envelope[index] === byte)) {
    throw new Error("The file is not a Block-Insure evidence envelope.");
  }
  const iterations = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength)
    .getUint32(magic.length, false);
  if (iterations < 100_000 || iterations > 1_000_000) throw new Error("The evidence KDF parameters are invalid.");

  const saltStart = magic.length + 4;
  const ivStart = saltStart + saltLength;
  const salt = envelope.slice(saltStart, ivStart);
  const iv = envelope.slice(ivStart, headerLength);
  const ciphertext = envelope.slice(headerLength);
  const key = await deriveKey(passphrase, salt, iterations, provider);
  const plaintext = await provider.subtle.decrypt(
    { name: "AES-GCM", iv: exactBuffer(iv), additionalData: exactBuffer(associatedData(context)), tagLength: 128 },
    key,
    exactBuffer(ciphertext),
  );
  return new Uint8Array(plaintext);
}
