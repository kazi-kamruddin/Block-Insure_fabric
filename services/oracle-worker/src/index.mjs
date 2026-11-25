import { createHash } from "node:crypto";
import path from "node:path";
import { pinnedDecision, decisionIdentity, historicalDecisionAliases, findPinnedDecision, writeExplanationReceipt } from "./decision-store.mjs";
import { observeProviderShadow } from "./provider-risk.mjs";
import { buildReleaseResultDigest } from "./release-protocol.mjs";
import { routeModel, evaluatorVersion, evaluatorHash } from "./xgboost.mjs";
import { registryAssessmentRequest } from "./medical-revision.mjs";
import { environmentFileArgument, loadEnvironmentFile } from "./environment.mjs";
import { OrderedEvents } from "./ordered-events.mjs";
import { devLiteProfile } from "../../../scripts/dev-lite-gateway.mjs";

loadEnvironmentFile(environmentFileArgument());

const [{ checkOracleNodeVersion, loadOracleConfig }, { connectOracleGateway }, { loadRegistrySnapshot, validateRegistrySnapshot, assessRegistryRecord }, protocol, privacy, cursorModule, retryModule, healthModule] = await Promise.all([
  import("./config.mjs"),
  import("./gateway.mjs"),
  import("./registry.mjs"),
  import("./protocol.mjs"),
  import("./privacy.mjs"),
  import("./cursor.mjs"),
  import("./retry.mjs"),
  import("./health.mjs"),
]);

checkOracleNodeVersion();
const config = loadOracleConfig();
const shadowFile = process.env.ORACLE_CHALLENGER_SHADOW_ARTIFACT?.trim();
const shadow = shadowFile ? await import("./challenger-shadow.mjs").then(async (module) => ({
  artifact: await module.loadChallengerShadow(config.fabric.channelName, shadowFile, process.env.ORACLE_CHALLENGER_SHADOW_HASH ?? ""),
  score: module.shadowChallengerScores,
})).catch(() => { log("warn", "Challenger shadow configuration rejected"); return null; }) : null;
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
let healthPersisted = Promise.resolve();
let inFlightRequests = 0;
const revealWaiters = new Map();

function log(level, message, details = {}) {
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), service: config.oracleId, message, ...details }));
}

async function updateHealth(patch) {
  const current = healthState.update(patch);
  const write = healthPersisted.then(() => healthModule.persistHealth(healthPath, current));
  healthPersisted = write.catch(() => undefined);
  await write;
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
  while (!stopping) {
    const request = await evaluate("ReadOracleRequest", requestId);
    const phase = protocol.oracleRequestPhase(request);
    if (phase === "FINALIZED") return request;
    if (await evaluateOrNull("ReadOracleResult", `${requestId}:${config.oracleId}`)) return request;
    if (phase === "REVEAL") return request;
    if (phase === "TIMED_OUT") return request;
    await new Promise(resolve => {
      const wake = () => {
        clearTimeout(timer);
        if (revealWaiters.get(requestId) === wake) revealWaiters.delete(requestId);
        resolve();
      };
      const timer = setTimeout(wake, config.pollIntervalMs);
      revealWaiters.set(requestId, wake);
    });
  }
  return null;
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
  let shadowPacket;
  const decision = await pinnedDecision({
    directory: path.join(config.stateRoot, config.oracleId, "decisions"),
    identity: decisionIdentity(config, runtime.identityFingerprint, request),
    fallbackIdentities: historicalDecisionAliases(config, runtime.identityFingerprint, request),
    key: runtime.privateKey,
    existingCommitment,
    allowLegacyAdoption: request.modelVersion === "model-v1",
    create: async () => {
  if (request.modelReleaseId && (request.modelVersion !== evaluatorVersion || request.modelHash !== evaluatorHash)) {
    const assessment = { verified: false, verificationCode: "XGB_EVALUATOR_UNAVAILABLE", recordHash: "0".repeat(64) };
    const resultHash = buildReleaseResultDigest(request, assessment);
    const salt = protocol.buildDeterministicSalt(runtime.privateKey, request.id, config.oracleId);
    return { assessment, resultHash, salt, commitmentHash: protocol.buildCommitmentDigest(request, { ...assessment, resultHash, salt }),
      registry: { sourceId: "unavailable-evaluator", snapshotId: request.registrySnapshotId, version: request.registryVersion, rootHash: request.registryRootHash } };
  }
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
    request: registryAssessmentRequest(config.fabric.channelName, request, claim, hospitalVerification),
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
  try {
    const sourceVerified = assessment.verified;
    assessment = routeModel({ snapshot: requestRegistry, request, claim, assessment });
    if (sourceVerified && !assessment.verified && !assessment.verificationCode.startsWith("XGB_REVIEW:")) {
      log("warn", "Oracle model routing unavailable", { requestId, failureReason: assessment.verificationCode });
    }
  } catch (error) {
    log("error", "Oracle model routing failed", { requestId, failureReason: "MODEL_ROUTING_EXCEPTION" });
    throw error;
  }
  if (shadow && assessment.result?.prepared && request.modelHash === evaluatorHash) {
    const records = requestRegistry.modelContext.records;
    const source = records.find(row => row.invoiceId === claim.hospitalInvoiceId && row.hospitalId === claim.hospitalId);
    if (source) shadowPacket = { source, records, prepared: assessment.result.prepared };
  }
  const resultHash = buildReleaseResultDigest(request, assessment);
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
    if (request?.status === "PENDING" && Date.now() <= Date.parse(request.revealDeadline)) await submitReveal(request, assessment, resultHash, salt);
  }
  if (stopping) return;
  if (config.fabric.channelName === devLiteProfile.channel && process.env.ORACLE_PROVIDER_SHADOW_RELEASE &&
      process.env.ORACLE_PROVIDER_SHADOW_ARTIFACT && process.env.ORACLE_PROVIDER_SHADOW_CATALOG) {
    setImmediate(async () => {
      try {
        const release = await evaluate("ReadMedicalModelRelease", process.env.ORACLE_PROVIDER_SHADOW_RELEASE);
        const observation = await observeProviderShadow({ release, artifactPath: process.env.ORACLE_PROVIDER_SHADOW_ARTIFACT,
          catalogPath: process.env.ORACLE_PROVIDER_SHADOW_CATALOG, hospitalId: currentClaim.hospitalId });
        if (observation) log("log", "Provider review shadow score", { requestId, ...observation });
      } catch {
        log("warn", "Provider review shadow score unavailable", { requestId });
      }
    });
  }
  if (shadowPacket) setImmediate(() => {
    try {
      const observation = shadow.score(shadow.artifact, shadowPacket);
      if (observation) log("log", "Challenger shadow scores", { requestId, ...observation });
    } catch {
      log("warn", "Challenger shadow evaluation failed", { requestId });
    }
  });
  await updateHealth({
    status: inFlightRequests > 1 ? "PROCESSING" : "ONLINE",
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

async function recordFinalizedExplanation(request) {
  if (!request.resultHash || request.modelHash !== evaluatorHash || !request.assignedOracleIds.includes(config.oracleId)) return;
  const result = await evaluateOrNull("ReadOracleResult", `${request.id}:${config.oracleId}`);
  if (result?.resultHash !== request.resultHash || !/^XGB_(AUTO|REVIEW):/.test(result.verificationCode)) return;
  const decision = await findPinnedDecision(path.join(config.stateRoot, config.oracleId, "decisions"), [
    decisionIdentity(config, runtime.identityFingerprint, request),
    ...historicalDecisionAliases(config, runtime.identityFingerprint, request),
  ], runtime.privateKey);
  if (decision?.resultHash === result.resultHash) {
    await writeExplanationReceipt(config.stateRoot, request, config.oracleId, decision, result.verificationCode);
  }
}

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
  const operations = new Map();
  const queue = new OrderedEvents(3, async event => {
    if (event.eventName === "OracleVerificationRequested") {
      const { id } = decodeJson(event.payload);
      let task = operations.get(id);
      if (!task) {
        inFlightRequests++;
        task = processRequest(id).finally(() => {
          inFlightRequests--;
          operations.delete(id);
        });
        operations.set(id, task);
      }
      await task;
    }
    if (event.eventName === "OracleRequestFinalized") {
      const request = decodeJson(event.payload);
      await operations.get(request.id);
      await recordFinalizedExplanation(request);
    }
  }, async event => {
    if (stopping) return;
    const nextCursor = { nextBlock: Number(event.blockNumber), transactionId: event.transactionId };
    await cursorModule.persistCursor(cursorPath, cursorIdentity, nextCursor);
    cursor = nextCursor;
    await updateHealth({ lastProcessedBlock: String(event.blockNumber) });
  }, () => activeEvents?.close());
  try {
    for await (const event of activeEvents) {
      if (stopping) break;
      if (event.eventName === "OracleCommitmentSubmitted") {
        const { requestId } = decodeJson(event.payload);
        revealWaiters.get(requestId)?.();
      }
      if (!await queue.offer(event)) break;
    }
  } finally {
    activeEvents?.close();
    activeEvents = undefined;
    await queue.finish();
  }
}

async function main() {
  log("log", "Oracle worker started", {
    oracleId: config.oracleId,
    registrySource: registry.sourceId,
    registryRootHash: registry.rootHash,
    healthPort: config.healthPort,
    nodeVersion: process.version,
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
    for (const wake of revealWaiters.values()) wake();
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
