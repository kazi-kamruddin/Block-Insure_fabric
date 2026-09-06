const once = process.argv.includes("--once");
const endpoint = process.env.EVENT_SYNC_URL ?? "http://127.0.0.1:3000/api/internal/events/sync";
const secret = process.env.EVENT_WORKER_SECRET ?? "";
const intervalMs = boundedInteger("EVENT_WORKER_INTERVAL_MS", 5_000, 1_000, 3_600_000);
const maximumBackoffMs = boundedInteger("EVENT_WORKER_MAX_BACKOFF_MS", 60_000, intervalMs, 3_600_000);
const requestTimeoutMs = boundedInteger("EVENT_WORKER_REQUEST_TIMEOUT_MS", 30_000, 1_000, 3_600_000);
const maximumBatches = boundedInteger("EVENT_WORKER_MAX_BATCHES", 20, 1, 1_000);
let stopping = false;

function boundedInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function log(level, message, details = {}) {
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), service: "fabric-event-worker", message, ...details }));
}

async function synchronizeBatch() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`event sync returned ${response.status}: ${body.message ?? "unknown failure"}`);
  return body;
}

async function catchUp() {
  let processed = 0;
  for (let batch = 1; batch <= maximumBatches; batch += 1) {
    const result = await synchronizeBatch();
    processed += Number(result.processed ?? 0);
    if (!result.limitReached) {
      log("log", "projection synchronized", { processed, batches: batch, checkpoint: result.checkpoint ?? null });
      return;
    }
  }
  throw new Error(`event catch-up still requires another batch after ${maximumBatches} requests`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  if (secret.length < 32) throw new Error("EVENT_WORKER_SECRET must contain at least 32 characters");
  const parsedEndpoint = new URL(endpoint);
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(parsedEndpoint.hostname);
  if (parsedEndpoint.protocol !== "https:" && !(parsedEndpoint.protocol === "http:" && localHost)) {
    throw new Error("EVENT_SYNC_URL must use HTTPS unless it targets the local machine");
  }
  let backoffMs = intervalMs;
  do {
    try {
      await catchUp();
      backoffMs = intervalMs;
      if (once) return;
      await delay(intervalMs);
    } catch (error) {
      log("error", "synchronization failed", { error: error instanceof Error ? error.message : String(error), retryInMs: once ? 0 : backoffMs });
      if (once) throw error;
      await delay(backoffMs);
      backoffMs = Math.min(backoffMs * 2, maximumBackoffMs);
    }
  } while (!stopping);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    log("log", "shutdown requested", { signal });
  });
}

main().catch((error) => {
  log("error", "worker stopped", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
