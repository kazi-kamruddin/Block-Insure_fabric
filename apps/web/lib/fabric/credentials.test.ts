import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findSingleCredential } from "./credentials";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "block-insure-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("credential discovery", () => {
  it("returns the only non-hidden credential file", async () => {
    const directory = await temporaryDirectory();
    await fs.writeFile(path.join(directory, ".gitkeep"), "");
    await fs.writeFile(path.join(directory, "credential.pem"), "certificate");

    await expect(findSingleCredential(directory)).resolves.toBe(
      path.join(directory, "credential.pem"),
    );
  });

  it("rejects ambiguous credential directories", async () => {
    const directory = await temporaryDirectory();
    await fs.writeFile(path.join(directory, "one.pem"), "one");
    await fs.writeFile(path.join(directory, "two.pem"), "two");

    await expect(findSingleCredential(directory)).rejects.toThrow("found 2");
  });
});
