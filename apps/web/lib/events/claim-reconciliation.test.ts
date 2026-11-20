import { describe, expect, it } from "vitest";
import { projectedClaims, reconcileClaimProjection } from "./claim-reconciliation";

describe("claim projection reconciliation", () => {
  it("reports every corrupted field in one synthetic row", () => {
    const valid = { id: "claim", status: "SETTLED", version: 2, amountMinor: 4000, certificateHash: "valid" };
    const events = [{ id: "1", blockNumber: "1", transactionId: "tx1", eventName: "ClaimSubmitted",
      payload: { id: "claim", status: "SUBMITTED", version: 2, amountMinor: 4000 } },
    { id: "2", blockNumber: "2", transactionId: "tx2", eventName: "SettlementConfirmed",
      payload: { claimId: "claim", amountMinor: 4000, approvalCertificateHash: "valid" } }];
    const rows = projectedClaims(events);
    expect(reconcileClaimProjection(rows, [valid])).toEqual([]);
    expect(reconcileClaimProjection([{ ...rows[0], status: "APPROVED", version: 1, amountMinor: 4100, certificateHash: "stale" }], [valid]))
      .toEqual([{ id: "claim", issues: ["different-status", "different-version", "different-amountMinor", "different-certificateHash"] }]);
  });
});
