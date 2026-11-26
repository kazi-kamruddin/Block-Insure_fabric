import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pinnedDecision } from "./decision-store.mjs";
import { persistJsonFile } from "./state-file.mjs";
import { evaluatorE3Hash, evaluatorE3Version } from "./e3-release.mjs";
import { digest } from "./v2/canonical.mjs";
import { commitmentHash } from "./v2/commitment-v2.mjs";
import { workerDiagnosticsHash } from "./v2/diagnostics.mjs";
import { identifier, sha256Hex } from "./v2/fact-vector.mjs";
import { assessV2Request } from "./v2/worker.mjs";

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function sourceProfile(oracle, environment) {
  const token = environment[`ORACLE_ADAPTER_TOKEN_${oracle.toUpperCase()}`];
  if (!token || token.length < 24) fail("ADAPTER_PROFILE_UNAVAILABLE");
  let urls;
  try { urls = JSON.parse(environment.ORACLE_V2_SOURCE_URLS ?? "{}"); }
  catch { fail("ADAPTER_PROFILE_UNAVAILABLE"); }
  return {
    token,
    endpoint(issuer) {
      const address = urls[oracle]?.[issuer];
      if (typeof address !== "string") fail("ADAPTER_PROFILE_UNAVAILABLE");
      const url = new URL(address);
      if (url.username || url.password || url.search || url.hash ||
          (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))) {
        fail("ADAPTER_PROFILE_UNAVAILABLE");
      }
      return url.toString();
    },
  };
}

export async function assessE3Request({ request, claim, evaluate, config, oracleId, log }) {
  if (!Number.isInteger(request.patientTokenKeyVersion) || request.patientTokenKeyVersion < 1) fail("E3_TOKEN_VERSION_REQUIRED");
  const sources = await evaluate("ReadMedicalOracleE3SourcesForRequest", request.id);
  const token = sources?.current?.patientReferenceHash;
  if (sources?.current?.digestVersion !== 2 || sources.current.associationStatus !== "VERIFIED" || !sha256Hex.test(token ?? "")) {
    fail("E3_CURRENT_SOURCE_UNAVAILABLE");
  }
  // The frozen scorer compares SHA-256(claimantId) with the stored patient
  // reference. Adapt that interface using only the scoped pseudonym.
  const adapt = (row) => {
    if (!sha256Hex.test(row.patientReferenceHash ?? "")) fail("E3_CONTEXT_INCOMPLETE");
    return { ...row, patientReferenceHash: createHash("sha256").update(row.patientReferenceHash).digest("hex") };
  };
  const projected = { ...sources, current: adapt(sources.current), priors: sources.priors.map(adapt) };
  const evaluateSources = (name, ...args) => name === "ReadMedicalOracleSourcesForRequest" ? projected : evaluate(name, ...args);
  const assessment = await assessV2Request({ request, claim: { ...claim, claimantId: token }, evaluate: evaluateSources, config, oracleId, log });
  const diagnostics = {
    ...assessment.diagnostics,
    evaluatorHash: evaluatorE3Hash,
    contextHash: digest("oracle-v2:e3-evaluator-context", [assessment.diagnostics.contextHash, request.patientTokenKeyVersion]),
  };
  return { ...assessment, diagnostics, diagnosticsHash: workerDiagnosticsHash(diagnostics) };
}

export async function processE3Request({ request, claim, config, runtime, evaluate, evaluateOrNull, submit, retry,
  waitForRevealPhase, saltFor, log, environment = process.env }) {
  if (environment.ORACLE_E3_NODE_VERSION && process.version !== environment.ORACLE_E3_NODE_VERSION) fail("E3_NODE_VERSION_MISMATCH");
  if (request.modelVersion !== evaluatorE3Version || request.modelHash !== evaluatorE3Hash ||
      (environment.ORACLE_E3_HASH && environment.ORACLE_E3_HASH !== evaluatorE3Hash)) fail("E3_RELEASE_MISMATCH");
  const oracle = config.oracleId;
  if (!identifier.test(request.id) || !["oracle1", "oracle2", "oracle3"].includes(oracle)) fail("INVALID_REQUEST_IDENTITY");
  const id = `${request.id}:${oracle}`;
  const existingCommitment = await evaluateOrNull("ReadOracleCommitment", id);
  const pinned = await pinnedDecision({
    directory: path.join(config.stateRoot, oracle, "decisions-e3"),
    identity: [config.fabric.channelName, config.fabric.chaincodeName, runtime.identityFingerprint, oracle, request.id,
      request.claimId, request.claimVersion, request.manifestHash, request.rosterVersion, request.modelReleaseId,
      evaluatorE3Hash, request.patientTokenKeyVersion],
    key: runtime.privateKey,
    existingCommitment,
    async create() {
      const outcome = await assessE3Request({ request, claim, evaluate, config: sourceProfile(oracle, environment), oracleId: oracle, log });
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
  if (!sha256Hex.test(pinned.diagnosticsHash) || workerDiagnosticsHash(pinned.diagnostics) !== pinned.diagnosticsHash) fail("DIAGNOSTICS_CHANGED");
  const receipt = { schema: "oracle-v2-explanation-receipt-v1", requestId: request.id, oracleId: oracle,
    workerDiagnosticsHash: pinned.diagnosticsHash, ...pinned.diagnostics };
  const receiptPath = path.join(config.stateRoot, "receipts", request.id, `${oracle}.json`);
  try { await persistJsonFile(receiptPath, receipt, { exclusive: true }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = JSON.parse(await readFile(receiptPath, "utf8"));
    if (previous.requestId !== request.id || previous.oracleId !== oracle ||
        workerDiagnosticsHash(previous) !== pinned.diagnosticsHash) fail("DIAGNOSTICS_CHANGED");
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
