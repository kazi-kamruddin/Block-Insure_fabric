import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eventProjectionRoot } from "./location";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("event projection location", () => {
  it("discovers stable repository data storage from a nested standalone runtime", async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), "block-insure-events-"));
    temporaryRoots.push(repository);
    await fs.mkdir(path.join(repository, "network", "config"), { recursive: true });
    await fs.writeFile(path.join(repository, "network", "config", "configtx.yaml"), "Organizations: []\n");
    const runtime = path.join(repository, "apps", "web", ".next", "standalone");
    await fs.mkdir(runtime, { recursive: true });

    expect(eventProjectionRoot({} as NodeJS.ProcessEnv, runtime)).toBe(path.join(repository, "data", "events"));
  });

  it("honors an explicit deployment root relative to the runtime", () => {
    const runtime = path.resolve("runtime");
    expect(eventProjectionRoot({ EVENT_PROJECTION_ROOT: "../events" } as unknown as NodeJS.ProcessEnv, runtime))
      .toBe(path.resolve(runtime, "../events"));
  });
});
