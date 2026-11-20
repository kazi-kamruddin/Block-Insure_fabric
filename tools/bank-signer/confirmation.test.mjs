import assert from "node:assert/strict";
import test from "node:test";
import { confirmWithApproval, parseSigningRequest } from "./confirmation.mjs";

const request = { settlementId: "settlement-1", transferId: "transfer-1", bankReferenceHash: "a".repeat(64) };
const certificateHash = "b".repeat(64);
const settlement = { id: request.settlementId, claimId: "claim-1", amountMinor: 4000, status: "AUTHORIZED",
  currency: "BDT", approvalCertificateHash: certificateHash };
const claim = { id: "claim-1", medicalSettlementId: request.settlementId, status: "SETTLEMENT_AUTHORIZED",
  amountMinor: 4000, version: 2 };
const certificate = { claimId: claim.id, claimVersion: 2, amountMinor: 4000, currency: "BDT", hash: certificateHash };

function ledger(overrides = {}) {
  return async name => ({ ReadSettlement: settlement, ReadClaim: claim,
    ReadMedicalApprovalCertificate: certificate, ...overrides })[name];
}

test("accepts only typed, narrow requests", () => {
  assert.deepEqual(parseSigningRequest(request), request);
  assert.throws(() => parseSigningRequest({ ...request, amountMinor: 1 }));
  assert.throws(() => parseSigningRequest({ ...request, bankReferenceHash: "bogus" }));
});

test("requires explicit assent before submitting the reviewed settlement", async () => {
  const submit = async (actual, review) => {
    assert.deepEqual(actual, request);
    assert.equal(review.claimVersion, 2);
    assert.equal(review.amountMinor, 4000);
    return "submitted";
  };
  assert.equal(await confirmWithApproval({ request, evaluate: ledger(), approve: async () => true, submit }), "submitted");
  await assert.rejects(confirmWithApproval({ request, evaluate: ledger(), approve: async () => false,
    submit: () => assert.fail("must not submit") }), /declined/);
});

test("refuses an inconsistent certificate or a payout changed after assent", async () => {
  await assert.rejects(confirmWithApproval({ request,
    evaluate: ledger({ ReadMedicalApprovalCertificate: { ...certificate, claimVersion: 1 } }),
    approve: () => assert.fail("must not show approval"), submit: () => assert.fail("must not submit") }), /certificate/);
  let approved = false;
  await assert.rejects(confirmWithApproval({ request,
    evaluate: name => approved ? ledger({ ReadSettlement: { ...settlement, status: "PAYMENT_FAILED" } })(name) : ledger()(name),
    approve: async () => { approved = true; return true; }, submit: () => assert.fail("must not submit") }), /changed/);
});
