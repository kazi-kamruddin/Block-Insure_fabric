import { createHash } from "node:crypto";
import path from "node:path";
import { environmentFileArgument, loadEnvironmentFile } from "./environment.mjs";

loadEnvironmentFile(environmentFileArgument());

const [{ loadOracleConfig }, { connectOracleGateway }, { loadRegistrySnapshot, validateRegistrySnapshot, assessRegistryRecord }, protocol, cursorModule, retryModule, healthModule] = await Promise.all([
  import("./config.mjs"),
  import("./gateway.mjs"),
  import("./registry.mjs"),
  import("./protocol.mjs"),
  import("./cursor.mjs"),
  import("./retry.mjs"),
  import("./health.mjs"),
]);

const config = loadOracleConfig();
const registry = await loadRegistrySnapshot(config.registryPath);
const healthPath = path.join(config.stateRoot, config.oracleId, "health.json");
const previousHealth = await healthModule.loadPersistedHealth(healthPath, config.oracleId);
const runtime = await connectOracleGateway(config);
const healthState = healthModule.createHealthState(config, registry, previousHealth);
const cursorPath = path.join(config.stateRoot, config.oracleId, "cursor.json");
const decoder = new TextDecoder();
let stopping = false;
let activeEvents;

function log(level, message, details = {}) {
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), service: config.oracleId, message, ...details }));
}

async function updateHealth(patch) {
  const current = healthState.update(patch);
  await healthModule.persistHealth(healthPath, current);
  return current;
}

function decodeJson(payload) {
  return JSON.parse(decoder.decode(payload));
}

async function evaluate(transactionName, ...arguments_) {
  return decodeJson(await runtime.contract.evaluateTransaction(transactionName, ...arguments_.map(String)));
}

async function evaluateOrNull(transactionName, ...arguments_) {
  try {
    return await evaluate(transactionName, ...arguments_);
  } catch (error) {
    if (String(error?.message ?? error).includes("does not exist")) return null;
    throw error;
  }
}

async function submit(transactionName, ...arguments_) {
  return decodeJson(await runtime.contract.submitTransaction(transactionName, ...arguments_.map(String)));
}

async function registryForRequest(request) {
  if (request.registrySnapshotId === registry.snapshotId) return registry;
  if (!config.registryApiUrl) return registry;
  const response = await fetch(`${config.registryApiUrl}/${encodeURIComponent(request.registrySnapshotId)}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(config.registryRequestTimeoutMs),
  });
  if (!response.ok) throw new Error(`Hospital registry API returned ${response.status} for ${request.registrySnapshotId}`);
  const snapshot = validateRegistrySnapshot(await response.json());
  if (snapshot.snapshotId !== request.registrySnapshotId) throw new Error(`Hospital registry API returned snapshot ${snapshot.snapshotId}`);
  return snapshot;
}

function retry(operation) {
  return retryModule.withBoundedRetry(operation, config.retry);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function submitCommitment(request, commitmentHash) {
  return retry(async () => {
    const current = await evaluateOrNull("ReadOracleCommitment", `${request.id}:${config.oracleId}`);
    if (current) {
      if (current.commitmentHash !== commitmentHash) throw new Error(`Stored commitment differs for ${request.id}`);
      return current;
    }
    const result = await submit("SubmitOracleCommitment", request.id, commitmentHash);
    const health = healthState.snapshot();
    await updateHealth({ counts: { commitments: health.counts.commitments + 1 } });
    return result;
  });
}

async function waitForRevealPhase(requestId) {
  for (;;) {
    const request = await evaluate("ReadOracleRequest", requestId);
    const phase = protocol.oracleRequestPhase(request);
    if (phase === "FINALIZED") return request;
    if (await evaluateOrNull("ReadOracleResult", `${requestId}:${config.oracleId}`)) return request;
    if (phase === "REVEAL") return request;
    if (phase === "TIMED_OUT") return request;
    await delay(config.pollIntervalMs);
  }
}

async function submitReveal(request, assessment, resultHash, salt) {
  return retry(async () => {
    const current = await evaluateOrNull("ReadOracleResult", `${request.id}:${config.oracleId}`);
    if (current) {
      if (current.resultHash !== resultHash) throw new Error(`Stored result differs for ${request.id}`);
      return current;
    }
    const result = await submit(
      "RevealOracleResult",
      request.id,
      assessment.verified,
      assessment.verificationCode,
      assessment.recordHash,
      resultHash,
      request.claimVersion,
      request.registryVersion,
      request.modelVersion,
      request.modelHash,
      salt,
    );
    const health = healthState.snapshot();
    await updateHealth({
      counts: {
        reveals: health.counts.reveals + 1,
        verified: health.counts.verified + (assessment.verified ? 1 : 0),
        failed: health.counts.failed + (assessment.verified ? 0 : 1),
      },
    });
    return result;
  });
}

async function processRequest(requestId) {
  const startedAt = Date.now();
  let request = await evaluate("ReadOracleRequest", requestId);
  if (!request.assignedOracleIds.includes(config.oracleId)) return;
  if (request.status !== "PENDING" || await evaluateOrNull("ReadOracleResult", `${request.id}:${config.oracleId}`)) return;
  const [claim, hospitalVerification, appeal] = await Promise.all([
    evaluate("ReadClaim", request.claimId),
    evaluate("ReadHospitalVerification", request.hospitalVerificationId),
    request.appealId ? evaluate("ReadClaimAppeal", request.appealId) : Promise.resolve(null),
  ]);
  const requestRegistry = await registryForRequest(request);
  if (claim.version !== request.claimVersion || claim.currentOracleRequestId !== request.id) {
    await updateHealth({ status: "ONLINE", lastProcessedRequestId: request.id, lastError: `Stale request rejected for claim ${request.claimId}` });
    return;
  }
  const existingCommitment = await evaluateOrNull("ReadOracleCommitment", `${request.id}:${config.oracleId}`);
  if (!existingCommitment && Date.now() > Date.parse(request.commitDeadline)) {
    await updateHealth({ status: "ONLINE", lastProcessedRequestId: request.id, lastError: `Commit deadline expired for ${request.id}` });
    return;
  }
  if (Date.now() > Date.parse(request.revealDeadline)) {
    await updateHealth({ status: "ONLINE", lastProcessedRequestId: request.id, lastError: `Reveal deadline expired for ${request.id}` });
    return;
  }
  const assessment = assessRegistryRecord({
    snapshot: requestRegistry,
    request,
    claim,
    hospitalVerification,
    appeal,
    configuredModelVersion: config.modelVersion,
    configuredModelHash: config.modelHash,
  });
  const resultHash = protocol.buildResultDigest(request, assessment);
  const salt = protocol.buildDeterministicSalt(runtime.privateKey, request.id, config.oracleId);
  const commitmentHash = protocol.buildCommitmentDigest(request, { verified: assessment.verified, resultHash, salt });
  const health = healthState.snapshot();
  await updateHealth({
    status: "PROCESSING",
    registrySource: requestRegistry.sourceId,
    registrySnapshotId: requestRegistry.snapshotId,
    registryVersion: requestRegistry.version,
    registryRootHash: requestRegistry.rootHash,
    lastProcessedRequestId: request.id,
    lastError: null,
    counts: { requests: health.counts.requests + 1 },
  });
  await submitCommitment(request, commitmentHash);
  request = await waitForRevealPhase(request.id);
  if (request.status === "PENDING" && Date.now() <= Date.parse(request.revealDeadline)) await submitReveal(request, assessment, resultHash, salt);
  await updateHealth({
    status: "ONLINE",
    lastProcessedRequestId: request.id,
    lastProcessingLatencyMs: Date.now() - startedAt,
    lastError: null,
  });
  log("log", "Oracle request processed", {
    requestId: request.id,
    verified: assessment.verified,
    verificationCode: assessment.verificationCode,
    latencyMs: Date.now() - startedAt,
  });
}

const cursorIdentity = createHash("sha256").update(JSON.stringify({
  certificate: runtime.identityFingerprint,
  oracleId: config.oracleId,
  channel: config.fabric.channelName,
  chaincode: config.fabric.chaincodeName,
  registrySource: registry.sourceId,
})).digest("hex");
let cursor = await cursorModule.loadCursor(cursorPath, cursorIdentity, config.fabric.startBlock);
const healthServer = healthModule.startHealthServer(config.healthPort, healthState);
await updateHealth({ status: "ONLINE", lastError: null });

async function consumeEvents() {
  const checkpoint = cursor.transactionId ? {
    getBlockNumber: () => BigInt(cursor.nextBlock),
    getTransactionId: () => cursor.transactionId,
  } : undefined;
  activeEvents = await runtime.network.getChaincodeEvents(config.fabric.chaincodeName, {
    checkpoint,
    startBlock: BigInt(cursor.nextBlock),
  });
  try {
    for await (const event of activeEvents) {
      if (stopping) break;
      if (event.eventName === "OracleVerificationRequested") {
        const payload = decodeJson(event.payload);
        await processRequest(payload.id);
      }
      cursor = { nextBlock: Number(event.blockNumber), transactionId: event.transactionId };
      await cursorModule.persistCursor(cursorPath, cursorIdentity, cursor);
      await updateHealth({ lastProcessedBlock: String(event.blockNumber) });
    }
  } finally {
    activeEvents?.close();
    activeEvents = undefined;
  }
}

async function main() {
  log("log", "Oracle worker started", {
    oracleId: config.oracleId,
    registrySource: registry.sourceId,
    registryRootHash: registry.rootHash,
    healthPort: config.healthPort,
  });
  while (!stopping) {
    try {
      await consumeEvents();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateHealth({ status: "DEGRADED", lastError: message });
      log("error", "Oracle event consumption failed", { error: message });
      if (!stopping) await delay(config.pollIntervalMs);
    }
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  activeEvents?.close();
  healthServer.close();
  runtime.close();
  await updateHealth({ status: "STOPPED", lastError: null }).catch(() => undefined);
  log("log", "Oracle worker stopped", { signal });
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void shutdown(signal));

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await updateHealth({ status: "FAILED", lastError: message }).catch(() => undefined);
  log("error", "Oracle worker failed", { error: message });
  runtime.close();
  healthServer.close();
  process.exitCode = 1;
});
