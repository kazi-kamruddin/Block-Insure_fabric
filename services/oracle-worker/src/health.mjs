import http from "node:http";
import { promises as fs } from "node:fs";
import { persistJsonFile } from "./state-file.mjs";

const emptyCounts = () => ({ requests: 0, commitments: 0, reveals: 0, verified: 0, failed: 0 });

function restoredCounts(previous) {
  const result = emptyCounts();
  for (const key of Object.keys(result)) {
    const value = previous?.counts?.[key];
    if (Number.isSafeInteger(value) && value >= 0) result[key] = value;
  }
  return result;
}

export async function loadPersistedHealth(filePath, oracleId) {
  try {
    const stored = JSON.parse(await fs.readFile(filePath, "utf8"));
    return stored?.schemaVersion === 1 && stored?.oracleId === oracleId ? stored : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function createHealthState(config, registry, previous = null) {
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
    lastProcessedBlock: previous?.lastProcessedBlock ?? null,
    lastProcessedRequestId: previous?.lastProcessedRequestId ?? null,
    lastError: null,
    counts: restoredCounts(previous),
    lastProcessingLatencyMs: previous?.lastProcessingLatencyMs ?? null,
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
  await persistJsonFile(filePath, health);
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
