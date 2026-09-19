import { describe, expect, it } from "vitest";
import { applyFabricEvent, emptyEventProjection, notificationsFor } from "./projection";

describe("Fabric event projection", () => {
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
