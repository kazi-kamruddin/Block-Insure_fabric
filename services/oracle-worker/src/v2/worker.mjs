import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonical, digest } from "./canonical.mjs";
import { commitmentHash } from "./commitment-v2.mjs";
import { decide, diagnosticPolicy } from "./decision.mjs";
import { workerDiagnosticsHash } from "./diagnostics.mjs";
import { evaluateV2 } from "./evaluator-v2.mjs";
import { factsFromSources } from "./evidence-policy.mjs";
import { factVectorHash, identifier, sha256Hex } from "./fact-vector.mjs";
import { evaluatorE2Hash, evaluatorE2Version } from "./release.mjs";
import { fetchPinnedFeed } from "./sources.mjs";
import { pinnedDecision } from "../decision-store.mjs";
import { persistJsonFile } from "../state-file.mjs";

const policy = { ...diagnosticPolicy, requireReceiptNumber: true };
const retrievalPaths = { oracle1: "DIRECT", oracle2: "MIRROR", oracle3: "ORACLE_PEER_AND_SIGNED_FEEDS" };

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function adapterConfig(oracleId, environment) {
  const token = environment[`ORACLE_ADAPTER_TOKEN_${oracleId.toUpperCase()}`];
  if (!token || token.length < 24) fail("ADAPTER_PROFILE_UNAVAILABLE");
  let urls;
  try { urls = JSON.parse(environment.ORACLE_V2_SOURCE_URLS ?? "{}"); }
  catch { fail("ADAPTER_PROFILE_UNAVAILABLE"); }
  return {
    token,
    endpoint(issuerId) {
      const endpoint = urls[oracleId]?.[issuerId];
      if (typeof endpoint !== "string") fail("ADAPTER_PROFILE_UNAVAILABLE");
      const url = new URL(endpoint);
      if (url.username || url.password || url.search || url.hash ||
          (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))) {
        fail("ADAPTER_PROFILE_UNAVAILABLE");
      }
      return url.toString();
    },
  };
}

async function pinnedRecords(request, evaluate, config, log) {
  const manifest = request.manifest;
  if (!manifest || manifest.schema !== "oracle-v2-source-manifest-v1" ||
      manifest.requestedAt !== request.requestedAt || manifest.pins?.length !== 3 ||
      digest("oracle-v2:manifest", manifest) !== request.manifestHash) fail("MANIFEST_MISMATCH");
  const records = new Map(), issuers = new Map(), sourceStatus = {}, checkpoints = [];
  for (const pin of manifest.pins) {
    const [issuer, anchor] = await Promise.all([evaluate("ReadSourceIssuer", pin.issuerId, pin.keyVersion),
      evaluate("ReadSourceFeed", pin.issuerId, pin.feedVersion)]);
    if (Object.entries(pin).some(([key, value]) => anchor[key] !== value)) fail("ANCHOR_MISMATCH");
    issuers.set(issuer.issuerId, issuer);
    const input = { baseUrl: config.endpoint(pin.issuerId), token: config.token, checkpoint: pin, issuer,
      requestedAt: manifest.requestedAt, fetcher: config.fetcher };
    let retrieval = await fetchPinnedFeed(input);
    if (retrieval.status === "STALE_MIRROR" && Date.now() + 2_000 < Date.parse(request.commitDeadline)) {
      retrieval = await fetchPinnedFeed(input);
    }
    checkpoints.push({ issuerId: pin.issuerId, feedVersion: pin.feedVersion, status: retrieval.status });
    if (retrieval.status !== "VERIFIED") {
      log(retrieval.status);
      for (const name of issuer.authorizedFacts) sourceStatus[name] = retrieval.integrity ?? retrieval.status;
      continue;
    }
    if (retrieval.feed.anchorSignature !== anchor.signature) fail("ANCHOR_MISMATCH");
    for (const record of retrieval.feed.records) {
      if (records.has(record.recordId)) fail("DUPLICATE_SOURCE_RECORD");
      records.set(record.recordId, record);
    }
  }
  return { records, issuers, sourceStatus, checkpoints };
}

function inferAdvice(request, claim, sources, records, vector, log) {
  const tariff = records.get(vector.facts.tariffBand.evidence[0]);
  if (vector.facts.tariffBand.status !== "PASS" || !tariff) return { advice: "REVIEW" };
  const current = { ...sources.current, expectedMinMinor: tariff.payload.bandMinMinor,
    expectedMaxMinor: tariff.payload.bandMaxMinor, invoiceStatus: "VALID", recordStatus: "VALID",
    licenseStatus: vector.facts.licenceActiveOnServiceDate.status === "PASS" ? "ACTIVE" : "SUSPENDED" };
  try {
    const result = evaluateV2({
      records: [current, ...sources.priors],
      claim: { ...claim, hospitalMsp: current.hospitalMsp, claimantMsp: "InsurerMSP",
        hospitalInvoiceId: current.invoiceId, invoiceHash: current.invoiceHash, treatmentType: current.treatmentType },
      snapshotTimestamp: request.requestedAt,
    });
    return { advice: result.modelAdvice, assessment: result.assessment };
  } catch (error) {
    log(error.code ?? "EVALUATOR_FAILURE");
    return { advice: "REVIEW" };
  }
}

export async function assessV2Request({ request, claim, evaluate, config, oracleId, log }) {
  const [sources, verified] = await Promise.all([
    evaluate("ReadMedicalOracleSourcesForRequest", request.id), pinnedRecords(request, evaluate, config, log),
  ]);
  if (sources.current.hospitalId !== claim.hospitalId || sources.current.serviceDate !== claim.incidentDate ||
      sources.current.invoiceId !== claim.hospitalInvoiceId) fail("CURRENT_SOURCE_MISMATCH");
  const scopedClaim = { id: claim.id, version: claim.version, hospitalId: claim.hospitalId,
    service: sources.current.treatmentType, serviceDate: sources.current.serviceDate, billMinor: sources.current.amountMinor,
    invoiceDate: sources.current.invoiceDate, invoiceHash: sources.current.invoiceHash, diagnosisCode: sources.current.diagnosisCode,
    admissionDate: sources.current.admissionDate, dischargeDate: sources.current.dischargeDate };
  const input = { ...verified, manifestHash: request.manifestHash, claim: scopedClaim, policy, privateReceipt: sources.receipt };
  const preliminary = factsFromSources({ ...input, modelAdvice: "REVIEW" });
  const { advice, assessment } = inferAdvice(request, claim, sources, verified.records, preliminary, log);
  const vector = factsFromSources({ ...input, modelAdvice: advice });
  const diagnostics = {
    evaluatorHash: evaluatorE2Hash,
    contextHash: digest("oracle-v2:evaluator-context", [request.id, request.manifestHash, sources.current.invoiceHash,
      sources.priors.map(row => row.invoiceHash).sort()]),
    explanation: assessment?.explanation ?? null,
    outOfDistribution: assessment?.uncertainty?.ood ?? null,
    ratios: assessment?.ratios ?? {},
    retrievalPath: retrievalPaths[oracleId],
    retrievalReceipts: verified.checkpoints,
  };
  return { encoded: canonical(vector), vectorHash: factVectorHash(vector), decision: decide(vector, policy),
    diagnostics, diagnosticsHash: workerDiagnosticsHash(diagnostics) };
}

export async function processV2Request({ request, claim, config, runtime, evaluate, evaluateOrNull, submit, retry,
  waitForRevealPhase, saltFor, log, environment = process.env }) {
  if (environment.ORACLE_E2_NODE_VERSION && process.version !== environment.ORACLE_E2_NODE_VERSION) {
    fail("E2_NODE_VERSION_MISMATCH");
  }
  if (request.modelVersion !== evaluatorE2Version || request.modelHash !== evaluatorE2Hash ||
    (environment.ORACLE_E2_HASH && environment.ORACLE_E2_HASH !== evaluatorE2Hash)) {
    log("E2_EVALUATOR_UNAVAILABLE");
    fail("E2_RELEASE_MISMATCH");
  }
  const oracle = config.oracleId;
  const id = `${request.id}:${oracle}`;
  if (!identifier.test(request.id) || !Object.hasOwn(retrievalPaths, oracle)) fail("INVALID_REQUEST_IDENTITY");
  const existingCommitment = await evaluateOrNull("ReadOracleCommitment", id);
  const pinned = await pinnedDecision({
    directory: path.join(config.stateRoot, oracle, "decisions-v2"),
    identity: [config.fabric.channelName, config.fabric.chaincodeName, runtime.identityFingerprint, oracle, request.id,
      request.claimId, request.claimVersion, request.manifestHash, request.rosterVersion, request.modelReleaseId, evaluatorE2Hash],
    key: runtime.privateKey,
    existingCommitment,
    async create() {
      const urls = adapterConfig(oracle, environment);
      const outcome = await assessV2Request({ request, claim, evaluate, config: urls, oracleId: oracle, log });
      const salt = saltFor();
      return { ...outcome, salt, commitmentHash: commitmentHash({
        channelId: config.fabric.channelName, requestId: request.id, claimVersion: request.claimVersion,
        oracleSubject: oracle, factVectorHash: outcome.vectorHash, decision: outcome.decision, salt,
      }) };
    },
  });
  if (!existingCommitment) await retry(async () => {
    const current = await evaluateOrNull("ReadOracleCommitment", id);
    if (current) {
      if (current.commitmentHash !== pinned.commitmentHash) fail("COMMITMENT_CHANGED");
      return;
    }
    const latest = await evaluate("ReadOracleRequest", request.id);
    if (latest.status === "PENDING" && Date.now() <= Date.parse(latest.commitDeadline)) {
      await submit("SubmitOracleCommitmentV2", request.id, pinned.commitmentHash);
    }
  });
  const committed = await evaluateOrNull("ReadOracleCommitment", id);
  if (committed?.commitmentHash !== pinned.commitmentHash) return;
  const receiptPath = path.join(config.stateRoot, "receipts", request.id, `${oracle}.json`);
  if (!sha256Hex.test(pinned.diagnosticsHash) || workerDiagnosticsHash(pinned.diagnostics) !== pinned.diagnosticsHash) fail("DIAGNOSTICS_CHANGED");
  const receipt = { schema: "oracle-v2-explanation-receipt-v1", requestId: request.id, oracleId: oracle,
    workerDiagnosticsHash: pinned.diagnosticsHash, ...pinned.diagnostics };
  try { await persistJsonFile(receiptPath, receipt, { exclusive: true }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(receiptPath, "utf8"));
    if (existing.requestId !== request.id || existing.oracleId !== oracle || workerDiagnosticsHash(existing) !== pinned.diagnosticsHash) fail("DIAGNOSTICS_CHANGED");
  }
  const latest = await waitForRevealPhase(request.id);
  if (latest.status !== "PENDING" || Date.now() > Date.parse(latest.revealDeadline)) return;
  await retry(async () => {
    if (await evaluateOrNull("ReadOracleResult", id)) return;
    const current = await evaluate("ReadOracleRequest", request.id);
    if (current.status === "PENDING" && Date.now() <= Date.parse(current.revealDeadline)) {
      await submit("RevealOracleResultV2", request.id, pinned.encoded, pinned.decision, pinned.salt, pinned.diagnosticsHash);
    }
  });
}
