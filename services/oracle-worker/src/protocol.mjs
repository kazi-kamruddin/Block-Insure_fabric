import { createHash } from "node:crypto";

export const ORACLE_PROTOCOL_VERSION = "block-insure-oracle-v1";

export function canonicalProtocolHash(domain, ...values) {
  const parts = [domain];
  for (const raw of values) {
    const value = String(raw);
    parts.push(`${Buffer.byteLength(value, "utf8")}:${value}`);
  }
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

export function buildResultDigest(request, { verified, verificationCode, recordHash }) {
  return canonicalProtocolHash(
    `${ORACLE_PROTOCOL_VERSION}:result`,
    request.id,
    request.claimId,
    request.queryHash,
    request.claimVersion,
    request.hospitalVerificationId,
    request.appealId ?? "",
    String(request.appealCommitmentHash ?? "").toLowerCase(),
    request.registrySnapshotId,
    request.registryVersion,
    request.registryRootHash,
    request.rulesVersion,
    request.rulesHash,
    request.modelVersion,
    request.modelHash,
    Boolean(verified),
    verificationCode,
    String(recordHash).toLowerCase(),
  );
}

export function buildCommitmentDigest(request, { verified, resultHash, salt }) {
  return canonicalProtocolHash(
    `${ORACLE_PROTOCOL_VERSION}:commitment`,
    request.id,
    request.claimVersion,
    request.registryVersion,
    Boolean(verified),
    String(resultHash).toLowerCase(),
    request.modelVersion,
    request.modelHash,
    String(salt).toLowerCase(),
  );
}

export function buildDeterministicSalt(privateKeyBytes, requestId, oracleId) {
  return createHash("sha256")
    .update(privateKeyBytes)
    .update("\0")
    .update(String(requestId), "utf8")
    .update("\0")
    .update(String(oracleId), "utf8")
    .digest("hex");
}

export function oracleRequestPhase(request, now = Date.now()) {
  if (request.status !== "PENDING") return "FINALIZED";
  if (now > Date.parse(request.revealDeadline)) return "TIMED_OUT";
  if (request.commitmentCount >= request.expectedResponses || now > Date.parse(request.commitDeadline)) return "REVEAL";
  return "COMMIT";
}
