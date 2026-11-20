import { buildResultDigest, canonicalProtocolHash, ORACLE_PROTOCOL_VERSION } from "./protocol.mjs";

// Keep the frozen evaluator's protocol adapter byte-identical. Only release
// requests use the extended wire format that the dev-lite chaincode verifies.
export function buildReleaseResultDigest(request, assessment) {
  if (!request.modelReleaseId) return buildResultDigest(request, assessment);
  return canonicalProtocolHash(
    `${ORACLE_PROTOCOL_VERSION}:result`,
    request.id, request.claimId, request.queryHash, request.claimVersion, request.hospitalVerificationId,
    request.appealId ?? "", String(request.appealCommitmentHash ?? "").toLowerCase(),
    request.registrySnapshotId, request.registryVersion, request.registryRootHash, request.rulesVersion,
    request.rulesHash, request.modelVersion, request.modelHash, request.privacyPresentationId ?? "",
    request.privacyPresentationHash ?? "", request.privacyProtocolVersion ?? "", Boolean(assessment.verified),
    assessment.verificationCode, String(assessment.recordHash).toLowerCase(), request.modelReleaseId,
  );
}
