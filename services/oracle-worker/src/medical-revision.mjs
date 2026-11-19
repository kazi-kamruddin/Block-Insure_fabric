// The legacy check assumes every later version is an appeal. Only a matching
// medical attestation can use the original non-appeal registry checks. The
// actual version still binds the event, evaluator, reveal and commitment.
export function registryAssessmentRequest(channel, request, claim, verification) {
  if (channel !== "insurance-medical-reimbursement" || request.claimVersion <= 1 || !claim.episodeId ||
      request.appealId || request.appealCommitmentHash || claim.currentAppealId || verification.appealId ||
      !["CORRECTION", "CLARIFICATION"].includes(verification.medicalRevisionKind) ||
      verification.medicalRevisionKind !== claim.medicalRevisionKind ||
      request.claimId !== claim.id || verification.claimId !== claim.id ||
      request.claimVersion !== claim.version || verification.claimVersion !== claim.version ||
      request.hospitalVerificationId !== verification.id || claim.hospitalVerificationId !== verification.id ||
      verification.outcome !== "SOURCE_BOUND" || !/^[a-f0-9]{64}$/.test(verification.attestationHash)) return request;
  return { ...request, claimVersion: 1 };
}
