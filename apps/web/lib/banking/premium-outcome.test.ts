import { describe, expect, it } from "vitest";
import type { BankTransfer, PremiumPayment } from "@/lib/fabric/types";
import { reconcilePremiumOutcome } from "./premium-outcome";
const intent = { transferId: "transfer-1", paymentId: "payment-1", policyId: "policy-1", sourceAccountId: "customer-1", destinationAccountId: "insurer-1",
  periodStartDate: "2026-01-01", periodEndDate: "2026-01-30", amountMinor: 1000, externalReferenceHash: "a".repeat(64) };
const transfer: BankTransfer = { ...intent, id: intent.transferId, status: "SETTLED", method: "OTP", assetType: "bankTransfer", schemaVersion: 15,
  bankId: "bank-demo", mandateId: "", collectionId: "", settlementId: "", currency: "BDT", failureCode: "", authorizationHash: "b".repeat(64), createdAt: "2026-01-01T00:00:00Z" };
const payment: PremiumPayment = { ...intent, id: intent.paymentId, method: "OTP", assetType: "premiumPayment", schemaVersion: 15, mandateId: "", recordedAt: "2026-01-01T00:00:00Z" };
describe("premium committed outcome reconciliation", () => {
  it("recovers the exact original outcome without creating another payment", () => {
    expect(reconcilePremiumOutcome(intent, transfer, payment).status).toBe("SETTLED");
    expect(reconcilePremiumOutcome(intent, { ...transfer, status: "BOUNCED" }).status).toBe("BOUNCED");
  });
  it("does not infer settlement from a transfer alone or changed period/amount", () => {
    expect(() => reconcilePremiumOutcome(intent, transfer)).toThrow(/incomplete/);
    expect(() => reconcilePremiumOutcome({ ...intent, amountMinor: 2000 }, transfer, payment)).toThrow(/differs/);
    expect(() => reconcilePremiumOutcome(intent, transfer, { ...payment, periodEndDate: "2026-02-01" })).toThrow(/inconsistent/);
  });
});
