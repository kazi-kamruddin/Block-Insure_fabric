import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readOracleWorkerHealth, type OracleWorkerHealth } from "./health";

const temporaryRoots: string[] = [];
const health: OracleWorkerHealth = {
  schemaVersion: 1, oracleId: "oracle1", label: "Oracle 1", status: "ONLINE",
  registrySource: "source-1", registrySnapshotId: "snapshot-1", registryVersion: 1,
  registryRootHash: "a".repeat(64), modelVersion: "model-v1", startedAt: "2026-09-06T00:00:00Z",
  updatedAt: "2026-09-06T00:01:00Z", lastProcessedBlock: "42", lastProcessedRequestId: "request-1",
  lastError: null, counts: { requests: 1, commitments: 1, reveals: 1, verified: 1, failed: 0 },
  lastProcessingLatencyMs: 120,
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Oracle worker health", () => {
  it("prefers a live worker response", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(health), { status: 200 }));
    await expect(readOracleWorkerHealth("oracle1", { fetcher })).resolves.toEqual(health);
  });

  it("marks a durable checkpoint offline when the worker endpoint is unavailable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "block-insure-oracle-web-health-"));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, "oracle1"), { recursive: true });
    await fs.writeFile(path.join(root, "oracle1", "health.json"), JSON.stringify(health));
    const result = await readOracleWorkerHealth("oracle1", {
      environment: { ORACLE_STATE_ROOT: root } as unknown as NodeJS.ProcessEnv,
      fetcher: vi.fn(async () => { throw new Error("offline"); }),
    });
    expect(result.status).toBe("OFFLINE");
    expect(result.lastProcessedBlock).toBe("42");
    expect(result.lastError).toContain("last durable checkpoint");
  });
});
