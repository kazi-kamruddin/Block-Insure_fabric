import "server-only";

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

export type OracleWorkerHealth = {
  schemaVersion: number;
  oracleId: "oracle1" | "oracle2";
  label: string;
  status: string;
  registrySource: string;
  registrySnapshotId: string;
  registryVersion: number;
  registryRootHash: string;
  modelVersion: string;
  startedAt: string;
  updatedAt: string;
  lastProcessedBlock: string | number | null;
  lastProcessedRequestId: string | null;
  lastError: string | null;
  counts: { requests: number; commitments: number; reveals: number; verified: number; failed: number };
  lastProcessingLatencyMs: number | null;
};

type HealthReadOptions = {
  environment?: NodeJS.ProcessEnv;
  startDirectory?: string;
  fetcher?: typeof fetch;
};

function stateRoot(environment: NodeJS.ProcessEnv = process.env, startDirectory = process.cwd()) {
  if (environment.ORACLE_STATE_ROOT?.trim()) return path.resolve(startDirectory, environment.ORACLE_STATE_ROOT);
  let current = path.resolve(startDirectory);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, "services", "oracle-worker", "package.json"))) return path.join(current, "data", "oracle");
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDirectory, "data", "oracle");
}

function offlineHealth(oracleId: "oracle1" | "oracle2"): OracleWorkerHealth {
  return {
    schemaVersion: 1, oracleId, label: oracleId === "oracle1" ? "Oracle 1" : "Oracle 2",
    status: "OFFLINE", registrySource: "Unavailable", registrySnapshotId: "", registryVersion: 0,
    registryRootHash: "", modelVersion: "", startedAt: "", updatedAt: "", lastProcessedBlock: null,
    lastProcessedRequestId: null, lastError: "No worker health record exists", counts: { requests: 0, commitments: 0, reveals: 0, verified: 0, failed: 0 },
    lastProcessingLatencyMs: null,
  };
}

export async function readOracleWorkerHealth(oracleId: "oracle1" | "oracle2", options: HealthReadOptions = {}) {
  const environment = options.environment ?? process.env;
  const endpoint = environment[oracleId === "oracle1" ? "ORACLE1_HEALTH_URL" : "ORACLE2_HEALTH_URL"]
    ?? `http://127.0.0.1:${oracleId === "oracle1" ? 3301 : 3302}/health`;
  try {
    const response = await (options.fetcher ?? fetch)(endpoint, { cache: "no-store", signal: AbortSignal.timeout(1_500) });
    if (!response.ok) throw new Error(`health endpoint returned ${response.status}`);
    const live = await response.json() as OracleWorkerHealth;
    if (live.oracleId !== oracleId) throw new Error(`health endpoint returned ${live.oracleId}`);
    return live;
  } catch {
    try {
      const stored = JSON.parse(await fs.readFile(path.join(stateRoot(environment, options.startDirectory), oracleId, "health.json"), "utf8")) as OracleWorkerHealth;
      return {
        ...stored,
        status: stored.status === "STOPPED" ? "STOPPED" : "OFFLINE",
        lastError: stored.lastError
          ? `Worker endpoint unavailable. Last worker error: ${stored.lastError}`
          : "Worker endpoint unavailable; showing the last durable checkpoint",
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return offlineHealth(oracleId);
    }
  }
}
