import { describe, expect, it } from "vitest";
import { createEvidenceRecovery, restoreEvidenceRecovery } from "./recovery";
import { encryptEvidenceBytes, decryptEvidenceBytes } from "./browser-crypto";
describe("user-controlled evidence recovery", () => {
  it("restores actual original plaintext with the exported backup and separate password", async () => {
    const context = { claimId: "claim-backup", evidenceId: "evidence-backup" };
    const original = new TextEncoder().encode("synthetic invoice bytes");
    const encrypted = await encryptEvidenceBytes(original, "original secret passphrase", context);
    const backup = await createEvidenceRecovery("original secret passphrase", "separate backup password", context, encrypted.contentHash);
    expect(backup).not.toContain("original secret passphrase");
    const restored = await restoreEvidenceRecovery(backup, "separate backup password");
    expect(await decryptEvidenceBytes(encrypted.envelope, restored.passphrase, context)).toEqual(original);
    expect(restored.contentHash).toBe(encrypted.contentHash);
    await expect(restoreEvidenceRecovery(backup, "wrong backup password")).rejects.toThrow();
    const changed = { ...JSON.parse(backup), evidenceId: "another-evidence" };
    await expect(restoreEvidenceRecovery(JSON.stringify(changed), "separate backup password")).rejects.toThrow();
  });
  it("rejects oversized files and a backup password identical to the content password", async () => {
    await expect(restoreEvidenceRecovery("x".repeat(16385), "backup password")).rejects.toThrow(/size/);
    await expect(createEvidenceRecovery("same password long", "same password long", { claimId: "c", evidenceId: "e" }, "a".repeat(64))).rejects.toThrow(/separate/);
  });
});
