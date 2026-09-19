import { loadApplicationEnvironment } from "./load-environment.mjs";

loadApplicationEnvironment();

const once = process.argv.includes("--once");
const endpoint = process.env.BANKING_COLLECTION_URL ?? "http://127.0.0.1:3000/api/internal/banking/collections";
const secret = process.env.BANKING_WORKER_SECRET ?? "";
const timezone = process.env.BANKING_BUSINESS_TIMEZONE ?? "Asia/Dhaka";
const intervalMs = boundedInteger("BANKING_COLLECTION_INTERVAL_MS", 60_000, 1_000, 3_600_000);
const maximumBackoffMs = boundedInteger("BANKING_COLLECTION_MAX_BACKOFF_MS", 300_000, intervalMs, 3_600_000);
const requestTimeoutMs = boundedInteger("BANKING_COLLECTION_REQUEST_TIMEOUT_MS", 60_000, 1_000, 3_600_000);
let stopping = false;

function boundedInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return value;
}

function businessDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function log(level, message, details = {}) {
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), service: "premium-collection-worker", message, ...details }));
}

async function runCollectionCycle() {
  const asOfDate = businessDate();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ action: "run", asOfDate }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`collection cycle returned ${response.status}: ${body.message ?? "unknown failure"}`);
  log("log", "collection cycle completed", body);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  if (secret.length < 32) throw new Error("BANKING_WORKER_SECRET must contain at least 32 characters");
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const parsedEndpoint = new URL(endpoint);
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(parsedEndpoint.hostname);
  if (parsedEndpoint.protocol !== "https:" && !(parsedEndpoint.protocol === "http:" && localHost)) throw new Error("BANKING_COLLECTION_URL must use HTTPS unless it targets the local machine");
  let backoffMs = intervalMs;
  do {
    try {
      await runCollectionCycle();
      backoffMs = intervalMs;
      if (once) return;
      await delay(intervalMs);
    } catch (error) {
      log("error", "collection cycle failed", { error: error instanceof Error ? error.message : String(error), retryInMs: once ? 0 : backoffMs });
      if (once) throw error;
      await delay(backoffMs);
      backoffMs = Math.min(backoffMs * 2, maximumBackoffMs);
    }
  } while (!stopping);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; log("log", "shutdown requested", { signal }); });

main().catch((error) => {
  log("error", "worker stopped", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
