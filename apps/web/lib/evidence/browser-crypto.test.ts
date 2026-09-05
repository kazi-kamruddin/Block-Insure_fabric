import { describe, expect, it } from "vitest";
import { decryptEvidenceBytes, encryptEvidenceBytes, evidenceKdfIterations, sha256Hex } from "./browser-crypto";

const context = { claimId: "claim-browser", evidenceId: "evidence-browser" };

describe("browser evidence encryption", () => {
  it("round-trips an authenticated AES-256-GCM evidence envelope", async () => {
    const plaintext = new TextEncoder().encode("private medical evidence");
    const encrypted = await encryptEvidenceBytes(plaintext, "correct horse battery staple", context);
    const decrypted = await decryptEvidenceBytes(encrypted.envelope, "correct horse battery staple", context);

    expect(new TextDecoder().decode(decrypted)).toBe("private medical evidence");
    expect(encrypted.contentHash).toBe(await sha256Hex(plaintext));
    expect(new DataView(encrypted.envelope.buffer).getUint32(4, false)).toBe(evidenceKdfIterations);
    expect(new TextDecoder().decode(encrypted.envelope.slice(0, 4))).toBe("BIF1");
  });

  it("rejects the wrong passphrase or a different ledger binding", async () => {
    const encrypted = await encryptEvidenceBytes(
      new TextEncoder().encode("bound evidence"),
      "correct horse battery staple",
      context,
    );

    await expect(decryptEvidenceBytes(encrypted.envelope, "wrong passphrase value", context)).rejects.toThrow();
    await expect(decryptEvidenceBytes(encrypted.envelope, "correct horse battery staple", {
      ...context,
      claimId: "claim-other",
    })).rejects.toThrow();
  });
});
