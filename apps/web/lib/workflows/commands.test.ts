import { describe, expect, it } from "vitest";
import { canExecute, workflowCommandSchema } from "./commands";

describe("workflow command boundary", () => {
  it("maps operations to server-owned roles", () => {
    expect(canExecute("policyholder", "submitClaim")).toBe(true);
    expect(canExecute("policyholder", "authorizeSettlement")).toBe(false);
    expect(canExecute("bankOfficer", "confirmSettlement")).toBe(true);
    expect(canExecute("policyholder", "acquirePolicy")).toBe(true);
    expect(canExecute("policyholder", "reviewBankMandate")).toBe(false);
    expect(canExecute("bankOfficer", "recordPremiumAdjustment")).toBe(true);
    expect(canExecute("insurerAdmin", "markBenefitPaymentReady")).toBe(true);
  });

  it("validates policy, payment, and benefit lifecycle commands", () => {
    expect(workflowCommandSchema.safeParse({ operation: "recordPremiumPayment", id: "payment-1", policyId: "policy-1", mandateId: "mandate-1", periodStartDate: "2026-01-01", periodEndDate: "2026-01-30", amountMinor: 10_000, externalReferenceHash: "a".repeat(64), method: "OTP" }).success).toBe(true);
    expect(workflowCommandSchema.safeParse({ operation: "setBeneficiaries", policyId: "policy-1", allocationsJson: '[{"beneficiaryId":"person-1","shareBps":10000}]' }).success).toBe(true);
    expect(workflowCommandSchema.safeParse({ operation: "confirmBenefitPayment", id: "benefit-1", bankReferenceHash: "not-a-hash" }).success).toBe(false);
  });

  it("rejects invalid hashes and monetary values before Gateway", () => {
    const parsed = workflowCommandSchema.safeParse({
      operation: "submitClaim",
      id: "claim-1",
      policyId: "policy-1",
      amountMinor: -10,
      incidentDate: "2026-09-05",
      descriptionHash: "not-a-hash",
    });

    expect(parsed.success).toBe(false);
  });
});
