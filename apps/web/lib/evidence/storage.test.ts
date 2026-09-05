import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evidenceStorageReference,
  evidenceStorageRoot,
  hashValue,
  readCiphertext,
  storeCiphertext,
} from "./storage";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("ciphertext evidence storage", () => {
  it("discovers the repository storage root when no deployment override is set", () => {
    expect(evidenceStorageRoot({} as NodeJS.ProcessEnv)).toBe(path.resolve(process.cwd(), "../../data/evidence"));
  });

  it("stores a ciphertext once with deterministic integrity metadata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "block-insure-evidence-"));
    roots.push(root);
    const ciphertext = new TextEncoder().encode("already-encrypted-content");
    const stored = await storeCiphertext(root, "policyholder1", "evidence-1", ciphertext);

    expect(stored.reference).toBe("policyholder1/evidence-1.enc");
    expect(stored.referenceHash).toBe(hashValue(stored.reference));
    expect(await readCiphertext(root, "policyholder1", "evidence-1")).toEqual(Buffer.from(ciphertext));
    await expect(storeCiphertext(root, "policyholder1", "evidence-1", ciphertext)).rejects.toThrow();
  });

  it("rejects path traversal segments", () => {
    expect(() => evidenceStorageReference("..", "evidence-1")).toThrow("Invalid subject ID");
    expect(() => evidenceStorageReference("policyholder1", "../secret")).toThrow("Invalid evidence ID");
  });
});
