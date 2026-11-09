import { createHash } from "node:crypto";
import path from "node:path";
import { pinnedDecision, decisionIdentity } from "./decision-store.mjs";
import { routeModel, evaluatorVersion, evaluatorHash } from "./xgboost.mjs";
import { environmentFileArgument, loadEnvironmentFile } from "./environment.mjs";

loadEnvironmentFile(environmentFileArgument());

const [{ loadOracleConfig }, { connectOracleGateway }, { loadRegistrySnapshot, validateRegistrySnapshot, assessRegistryRecord }, protocol, privacy, cursorModule, retryModule, healthModule] = await Promise.all([
  import("./config.mjs"),
  import("./gateway.mjs"),
  import("./registry.mjs"),
  import("./protocol.mjs"),
  import("./privacy.mjs"),
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
let shutdownPromise;

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
    headers: { accept: "application/json", ...(config.registryApiToken ? { authorization: `Bearer ${config.registryApiToken}` } : {}) },
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
    const latest = await evaluate("ReadOracleRequest", request.id);
    if (latest.status !== "PENDING" || Date.now() > Date.parse(latest.commitDeadline)) return null;
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
    // Another worker may have finalized the quorum since our last read or
    // failed submission. Do not retry a completed request and delay later work.
    const latest = await evaluate("ReadOracleRequest", request.id);
    if (latest.status !== "PENDING" || Date.now() > Date.parse(latest.revealDeadline)) return null;
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
  // Check deadlines before any archive fetch. Resume the persisted assessment
  // even when the registry service is unavailable after a successful commit.
  const existingCommitment = await evaluateOrNull("ReadOracleCommitment", `${request.id}:${config.oracleId}`);
  if ((!existingCommitment && Date.now() > Date.parse(request.commitDeadline)) || Date.now() > Date.parse(request.revealDeadline)) return;
  const currentClaim = await evaluate("ReadClaim", request.claimId);
  if (currentClaim.version !== request.claimVersion || currentClaim.currentOracleRequestId !== request.id) return;
  const decision = await pinnedDecision({
    directory: path.join(config.stateRoot, config.oracleId, "decisions"),
    identity: decisionIdentity(config, runtime.identityFingerprint, request),
    key: runtime.privateKey,
    existingCommitment,
    allowLegacyAdoption: request.modelVersion === "model-v1",
    create: async () => {
  const [claim, hospitalVerification, appeal, publicPresentation, privatePresentation] = await Promise.all([
    evaluate("ReadClaim", request.claimId),
    evaluate("ReadHospitalVerification", request.hospitalVerificationId),
    request.appealId ? evaluate("ReadClaimAppeal", request.appealId) : Promise.resolve(null),
    request.privacyPresentationId ? evaluate("ReadSelectiveDisclosurePresentation", request.privacyPresentationId) : Promise.resolve(null),
    request.privacyPresentationId ? evaluate("ReadSelectiveDisclosurePresentationPrivate", request.privacyPresentationId) : Promise.resolve(null),
  ]);
  const [invoiceCredential, policyCredential] = publicPresentation
    ? await Promise.all([
      evaluate("ReadPrivacyCredential", publicPresentation.invoiceCredentialId),
      evaluate("ReadPrivacyCredential", publicPresentation.policyCredentialId),
    ])
    : [null, null];
  const requestRegistry = await registryForRequest(request);
  if (claim.version !== request.claimVersion || claim.currentOracleRequestId !== request.id) {
    throw new Error(`Stale request rejected for claim ${request.claimId}`);
  }
  if (!existingCommitment && Date.now() > Date.parse(request.commitDeadline)) {
    throw new Error(`Commit deadline expired for ${request.id}`);
  }
  if (Date.now() > Date.parse(request.revealDeadline)) {
    throw new Error(`Reveal deadline expired for ${request.id}`);
  }
  let assessment = assessRegistryRecord({
    snapshot: requestRegistry,
    request,
    claim,
    hospitalVerification,
    appeal,
    configuredModelVersion: request.modelVersion === evaluatorVersion ? evaluatorVersion : config.modelVersion,
    configuredModelHash: request.modelVersion === evaluatorVersion ? evaluatorHash : config.modelHash,
  });
  const privacyAssessment = privacy.verifySelectiveDisclosurePresentation({
    request, claim, publicPresentation, privatePresentation, invoiceCredential, policyCredential,
  });
  if (!privacyAssessment.valid) {
    assessment = {
      verified: false,
      verificationCode: privacyAssessment.code,
      recordHash: request.privacyPresentationHash || "0".repeat(64),
    };
  }
  assessment = routeModel({ snapshot: requestRegistry, request, claim, assessment });
  const resultHash = protocol.buildResultDigest(request, assessment);
  const salt = protocol.buildDeterministicSalt(runtime.privateKey, request.id, config.oracleId);
  const commitmentHash = protocol.buildCommitmentDigest(request, { verified: assessment.verified, resultHash, salt });
  return { assessment, resultHash, salt, commitmentHash, registry: {
    sourceId: requestRegistry.sourceId, snapshotId: requestRegistry.snapshotId,
    version: requestRegistry.version, rootHash: requestRegistry.rootHash, provenance: requestRegistry.provenance,
  } };
    },
  });
  const { assessment, resultHash, salt, commitmentHash, registry: requestRegistry } = decision;
  const health = healthState.snapshot();
  await updateHealth({
    status: "PROCESSING",
    registrySource: requestRegistry.sourceId,
    registrySnapshotId: requestRegistry.snapshotId,
    registryVersion: requestRegistry.version,
    registryRootHash: requestRegistry.rootHash,
    registryDatasetId: requestRegistry.provenance?.datasetId ?? null,
    registryDatasetVersion: requestRegistry.provenance?.datasetVersion ?? null,
    registryInputSha256: requestRegistry.provenance?.inputSha256 ?? null,
    registryTransformationVersion: requestRegistry.provenance?.transformationVersion ?? null,
    lastProcessedRequestId: request.id,
    lastError: null,
    counts: { requests: health.counts.requests + 1 },
  });
  if (await submitCommitment(request, commitmentHash)) {
    request = await waitForRevealPhase(request.id);
    if (request.status === "PENDING" && Date.now() <= Date.parse(request.revealDeadline)) await submitReveal(request, assessment, resultHash, salt);
  }
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
  // Persist health before opening the stream. Awaiting filesystem work between
  // opening a gRPC stream and attaching its async iterator leaves early stream
  // errors unhandled and can terminate the worker instead of reconnecting.
  await updateHealth({ status: "ONLINE", lastError: null });
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
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  shutdownPromise = (async () => {
    activeEvents?.close();
    runtime.close();
    await updateHealth({ status: "STOPPED", lastError: null }).catch(() => undefined);
    await new Promise((resolve) => healthServer.close(resolve));
    log("log", "Oracle worker stopped", { signal });
  })();
  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await updateHealth({ status: "FAILED", lastError: message }).catch(() => undefined);
  log("error", "Oracle worker failed", { error: message });
  runtime.close();
  healthServer.close();
  process.exitCode = 1;
});
