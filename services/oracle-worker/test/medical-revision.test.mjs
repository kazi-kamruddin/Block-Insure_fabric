import { test } from "node:test";
import assert from "node:assert/strict";
import { registryAssessmentRequest } from "../src/medical-revision.mjs";
import { validateAppealBinding } from "../src/registry.mjs";

test("medical clarification verifies without an appeal, while stale and legacy successors still fail", () => {
  const request = { claimId: "claim-test", claimVersion: 2, hospitalVerificationId: "verification-test" };
  const claim = { id: request.claimId, version: 2, episodeId: "episode-test", medicalRevisionKind: "CLARIFICATION", hospitalVerificationId: request.hospitalVerificationId };
  const hospitalVerification = { id: request.hospitalVerificationId, claimId: claim.id, claimVersion: 2,
    medicalRevisionKind: "CLARIFICATION", attestationHash: "a".repeat(64), outcome: "SOURCE_BOUND" };
  const result = registryAssessmentRequest("insurance-medical-reimbursement", request, claim, hospitalVerification);
  assert.equal(validateAppealBinding({ request: result, claim, hospitalVerification }), true);
  assert.equal(request.claimVersion, 2);
  for (const [channel, verification] of [
    ["insurance-workflow-alignment-20261108", hospitalVerification],
    ["insurance-medical-reimbursement", { ...hospitalVerification, claimVersion: 1 }],
    ["insurance-medical-reimbursement", { ...hospitalVerification, appealId: "mismatched-appeal" }],
  ]) {
    const invalid = registryAssessmentRequest(channel, request, claim, verification);
    assert.equal(validateAppealBinding({ request: invalid, claim, hospitalVerification: verification }), false);
  }
});
