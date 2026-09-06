import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";

export function createHealthState(config, registry) {
  let state = {
    schemaVersion: 1,
    oracleId: config.oracleId,
    label: config.label,
    status: "STARTING",
    registrySource: registry.sourceId,
    registrySnapshotId: registry.snapshotId,
    registryVersion: registry.version,
    registryRootHash: registry.rootHash,
    modelVersion: config.modelVersion,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastProcessedBlock: null,
    lastProcessedRequestId: null,
    lastError: null,
    counts: { requests: 0, commitments: 0, reveals: 0, verified: 0, failed: 0 },
    lastProcessingLatencyMs: null,
  };
  return {
    snapshot: () => structuredClone(state),
    update(patch) {
      state = {
        ...state,
        ...patch,
        counts: patch.counts ? { ...state.counts, ...patch.counts } : state.counts,
        updatedAt: new Date().toISOString(),
      };
      return structuredClone(state);
    },
  };
}

export async function persistHealth(filePath, health) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(health, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, filePath);
}

export function startHealthServer(port, state) {
  const server = http.createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"message":"Not found"}');
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(state.snapshot()));
  });
  server.listen(port, "127.0.0.1");
  return server;
}
