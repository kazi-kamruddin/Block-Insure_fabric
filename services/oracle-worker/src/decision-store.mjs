import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { hash } from "./xgboost.mjs";
import { persistJsonFile } from "./state-file.mjs";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const authenticate = (body, key) => createHmac("sha256", key).update(JSON.stringify(body)).digest();

export async function readAuthenticatedDecision(filename, key) {
  const stored = JSON.parse(await fs.readFile(filename, "utf8"));
  const expected = authenticate(stored.body, key);
  const supplied = Buffer.from(String(stored.mac), "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied) ||
      stored.body.version !== 1 || stored.body.identityHash !== path.basename(filename, ".json")) {
    throw new Error("Pinned Oracle decision authentication failed");
  }
  return stored.body.decision;
}

export async function findPinnedDecision(directory, identities, key) {
  for (const identityHash of new Set(identities.map(digest))) {
    try {
      return await readAuthenticatedDecision(path.join(directory, `${identityHash}.json`), key);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

export async function writeExplanationReceipt(root, request, oracleId, decision, verificationCode) {
  const { id: requestId, modelHash: evaluatorHash } = request;
  const result = decision?.assessment?.result;
  if (!result || !/^XGB_(AUTO|REVIEW):[a-f0-9]{64}$/i.test(verificationCode) ||
      verificationCode.toUpperCase() !== decision.assessment.verificationCode.toUpperCase()) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(requestId) || !/^oracle[123]$/.test(oracleId)) {
    throw new Error("Invalid explanation receipt identity");
  }
  const preimage = { evaluatorHash, contextHash: result.contextHash, assessment: result.assessment };
  if (hash(preimage) !== verificationCode.slice(verificationCode.indexOf(":") + 1).toLowerCase()) return null;
  const receipt = { schema: "explanation-receipt-v1", requestId, oracleId, ...preimage };
  const directory = path.join(root, "receipts", requestId);
  const filename = path.join(directory, `${oracleId}.json`);
  try {
    await persistJsonFile(filename, receipt, { exclusive: true });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (hash(JSON.parse(await fs.readFile(filename, "utf8"))) !== hash(receipt)) throw new Error("Existing Oracle explanation receipt differs");
  }
  return receipt;
}

// Immutable, deployment-qualified decisions: commit/reveal must never recompute
// from changed live inputs after a restart. Corruption fails closed, not reset.
export async function pinnedDecision({ directory, identity, fallbackIdentities = [], key, existingCommitment, allowLegacyAdoption = false, create }) {
  const identityHash = digest(identity);
  const filename = path.join(directory, `${identityHash}.json`);
  async function read(hash = identityHash) {
    const decision = await readAuthenticatedDecision(path.join(directory, `${hash}.json`), key);
    if (existingCommitment && decision.commitmentHash !== existingCommitment.commitmentHash) {
      throw new Error("Pinned Oracle decision differs from ledger commitment");
    }
    return decision;
  }
  for (const hash of new Set([identityHash, ...fallbackIdentities.map(digest)])) {
    try { return await read(hash); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (existingCommitment && !allowLegacyAdoption) throw new Error("Pinned Oracle decision missing for existing commitment; restore task state");
  const decision = await create();
  if (!decision || typeof decision.commitmentHash !== "string") throw new Error("Cannot persist an incomplete Oracle decision");
  if (existingCommitment && decision.commitmentHash !== existingCommitment.commitmentHash) throw new Error("Legacy decision cannot reproduce ledger commitment");
  const body = { version: 1, identityHash, decision };
  try {
    await persistJsonFile(filename, { body, mac: authenticate(body, key).toString("hex") }, { exclusive: true });
  } catch (error) {
    if (error.code === "EEXIST") return read();
    throw error;
  }
  return read();
}

export function decisionIdentity(config, identityFingerprint, request) {
  return {
    channel: config.fabric.channelName, chaincode: config.fabric.chaincodeName,
    oracle: config.oracleId, certificate: identityFingerprint,
    request: Object.fromEntries(["id", "claimId", "queryHash", "claimVersion", "hospitalVerificationId",
      "appealId", "appealCommitmentHash", "registrySnapshotId", "registryVersion", "registryRootHash",
      "rulesVersion", "rulesHash", "modelVersion", "modelHash", "privacyPresentationId",
      "privacyPresentationHash", "privacyProtocolVersion", ...(request.modelReleaseId ? ["modelReleaseId"] : [])]
      .map((name) => [name, request[name] ?? ""])),
  };
}

export function historicalDecisionAliases(config, fingerprint, request) {
  if (config.fabric.channelName !== "insurance-dev-lite-190" || request.modelReleaseId ||
      request.modelVersion !== "fabric-xgb-synthetic-v1") return [];
  return [decisionIdentity(config, fingerprint, { ...request, modelReleaseId: "frozen-medical-v1" })];
}
