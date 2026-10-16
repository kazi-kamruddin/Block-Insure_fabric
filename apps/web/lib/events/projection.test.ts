import { describe, expect, it } from "vitest";
import { applyFabricEvent, emptyEventProjection, notificationsFor } from "./projection";

describe("Fabric event projection", () => {
  it("keeps subjectless policyholder notices scoped to owned assets", () => {
    const projection = applyFabricEvent(emptyEventProjection(), {
      id: "9:tx-private:ClaimHospitalVerified", blockNumber: "9", transactionId: "tx-private", eventName: "ClaimHospitalVerified",
      payload: { claimId: "claim-private" },
    }, "2026-09-06T12:00:00Z");
    expect(notificationsFor(projection, "policyholder", "another-holder")).toHaveLength(0);
    expect(notificationsFor(projection, "policyholder", "owner", new Set(["claim-private"]))).toHaveLength(1);
    expect(notificationsFor(projection, "insurerAdmin")).toHaveLength(1);
  });

  it.each([
    ["PremiumPaymentRecorded", { id: "receipt-1", method: "OTP" }, "SETTLED", "OTP"],
    ["PremiumAdjustmentRecorded", { id: "adjustment-1" }, "SETTLED", "REVERSAL"],
    ["PremiumCollectionProcessed", { id: "collection-1", status: "COMPLETED" }, "SETTLED", "EFT"],
    ["PremiumCollectionProcessed", { id: "collection-1", status: "BOUNCED", failureCode: "INSUFFICIENT_FUNDS" }, "BOUNCED", "EFT"],
    ["SettlementConfirmed", { id: "settlement-1", status: "CONFIRMED" }, "SETTLED", "CLAIM_PAYOUT"],
    ["SettlementPaymentFailed", { id: "settlement-1", status: "PAYMENT_FAILED" }, "BOUNCED", "CLAIM_PAYOUT"],
  ])("projects communication from the single committed %s event", (eventName, payload, status, method) => {
    const event = { id: `12:tx-final:${eventName}`, blockNumber: "12", transactionId: "tx-final", eventName,
      payload: { ...payload, transferId: "transfer-final", policyId: "policy-1", amountMinor: 10_000 } };
    const projected = applyFabricEvent(emptyEventProjection(), event, "2026-09-06T12:00:00Z");
    expect(projected.communications[0]).toMatchObject({ assetId: "transfer-final", variables: { status, method, amountMinor: 10_000 } });
    expect(applyFabricEvent(projected, event, "2026-09-06T12:00:01Z").communications).toHaveLength(1);
  });
  it("deduplicates replayed events and advances a transaction checkpoint", () => {
    const event = { id: "7:tx-1:ClaimSubmitted", blockNumber: "7", transactionId: "tx-1", eventName: "ClaimSubmitted", payload: { id: "claim-1" } };
    const once = applyFabricEvent(emptyEventProjection(), event, "2026-09-06T12:00:00Z");
    const twice = applyFabricEvent(once, event, "2026-09-06T12:01:00Z");
    expect(twice).toEqual(once);
    expect(once.checkpoint).toEqual({ blockNumber: "7", transactionId: "tx-1" });
    expect(once.countsByName.ClaimSubmitted).toBe(1);
  });

  it("routes review notifications only to assigned certificate subjects", () => {
    const projection = applyFabricEvent(emptyEventProjection(), {
      id: "8:tx-2:ClaimReviewOpened", blockNumber: "8", transactionId: "tx-2", eventName: "ClaimReviewOpened",
      payload: { id: "review-1", assignedAuditorIds: ["auditor1", "auditor2"] },
    }, "2026-09-06T12:00:00Z");
    expect(notificationsFor(projection, "auditor", "auditor1")).toHaveLength(1);
    expect(notificationsFor(projection, "auditor", "auditor4")).toHaveLength(0);
  });

  it("projects Oracle request and exact-consensus finalization for insurer operations", () => {
    const requested = applyFabricEvent(emptyEventProjection(), {
      id: "9:tx-3:OracleVerificationRequested", blockNumber: "9", transactionId: "tx-3", eventName: "OracleVerificationRequested",
      payload: { id: "oracle-request-1", claimId: "claim-1", commitmentCount: 0, revealCount: 0 },
    }, "2026-09-06T12:00:00Z");
    const finalized = applyFabricEvent(requested, {
      id: "11:tx-5:OracleRequestFinalized", blockNumber: "11", transactionId: "tx-5", eventName: "OracleRequestFinalized",
      payload: { id: "oracle-request-1", claimId: "claim-1", finalizationCode: "EXACT_CONSENSUS" },
    }, "2026-09-06T12:01:00Z");
    expect(finalized.countsByName.OracleVerificationRequested).toBe(1);
    expect(finalized.countsByName.OracleRequestFinalized).toBe(1);
    expect(notificationsFor(finalized, "insurerAdmin").at(-1)?.title).toBe("Oracle exact consensus");
  });

  it("creates one replay-safe email communication for a committed Bank transfer", () => {
    const event = {
      id: "12:tx-6:BankTransferProcessed", blockNumber: "12", transactionId: "tx-6", eventName: "BankTransferProcessed",
      payload: { id: "transfer-1", policyId: "policy-1", method: "EFT", status: "BOUNCED", failureCode: "INSUFFICIENT_FUNDS", amountMinor: 10_000, currency: "BDT" },
    };
    const once = applyFabricEvent(emptyEventProjection(), event, "2026-09-06T12:02:00Z");
    const replayed = applyFabricEvent(once, event, "2026-09-06T12:03:00Z");
    expect(replayed.communications).toHaveLength(1);
    expect(replayed.communications[0]).toMatchObject({ template: "bank-transaction-status", status: "PENDING", policyId: "policy-1" });
  });
});
