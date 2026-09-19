import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistJsonFile } from "./state-file";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("event projection state files", () => {
  it("remain valid under concurrent Windows-style replacements", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "block-insure-event-state-"));
    temporaryRoots.push(root);
    const filePath = path.join(root, "projection.json");
    await Promise.all(Array.from({ length: 8 }, (_, sequence) => persistJsonFile(filePath, { sequence })));
    const stored = JSON.parse(await fs.readFile(filePath, "utf8")) as { sequence: number };
    expect(Number.isInteger(stored.sequence)).toBe(true);
    expect(stored.sequence).toBeGreaterThanOrEqual(0);
    expect(stored.sequence).toBeLessThan(8);
    expect((await fs.readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
