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
    expect(canExecute("insurerAdmin", "openClaimReview")).toBe(true);
    expect(canExecute("policyholder", "submitClaimAppeal")).toBe(true);
    expect(canExecute("auditor", "recordAuditorDecision")).toBe(true);
    expect(canExecute("insurerAdmin", "requestOracleVerification")).toBe(true);
    expect(canExecute("auditor", "requestOracleVerification")).toBe(false);
  });

  it("validates version-bound Oracle requests and fallback commands", () => {
    expect(workflowCommandSchema.safeParse({ operation: "requestOracleVerification", requestId: "request-1", claimId: "claim-1", snapshotId: "registry-demo-v1", modelVersion: "model-v1", modelHash: "c".repeat(64), assignedOracleIdsJson: '["oracle1","oracle2"]', commitDeadline: "2026-09-09T12:00:00Z", revealDeadline: "2026-09-09T12:10:00Z" }).success).toBe(true);
    expect(workflowCommandSchema.safeParse({ operation: "routeOracleFailureToReview", requestId: "request-1", reviewId: "review-1", assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: 3, rejectionThreshold: 2, deadline: "2026-09-12T12:00:00Z" }).success).toBe(true);
    expect(workflowCommandSchema.safeParse({ operation: "publishOracleRegistrySnapshot", id: "registry-demo-v1", version: 1, rootHash: "not-a-hash", rulesVersion: "rules-v1", rulesHash: "a".repeat(64), recordCount: 3 }).success).toBe(false);
  });

  it("validates versioned review, appeal, and fraud-support commands", () => {
    expect(workflowCommandSchema.safeParse({ operation: "openClaimReview", claimId: "claim-1", reviewId: "review-1", assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: 3, rejectionThreshold: 2, deadline: "2026-09-09T12:00:00Z" }).success).toBe(true);
    expect(workflowCommandSchema.safeParse({ operation: "submitClaimAppeal", appealId: "appeal-1", claimId: "claim-1", reasonCategory: "DOCUMENT_ERROR", reasonHash: "a".repeat(64), descriptionHash: "b".repeat(64), proposedClinicalReferenceHash: "c".repeat(64) }).success).toBe(true);
    expect(workflowCommandSchema.safeParse({ operation: "submitClaimAppeal", appealId: "appeal-1", claimId: "claim-1", reasonCategory: "DOCUMENT_ERROR", reasonHash: "a".repeat(64), descriptionHash: "b".repeat(64) }).success).toBe(false);
    expect(workflowCommandSchema.safeParse({ operation: "recordAuditorDecision", reviewId: "review-1", decisionId: "decision-1", outcome: "APPROVE", reasonHash: "a".repeat(64) }).success).toBe(true);
    expect(workflowCommandSchema.safeParse({ operation: "assessClaimFraud", assessmentId: "fraud-1", claimId: "claim-1" }).success).toBe(true);
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
      hospitalId: "hospital-demo",
      amountMinor: -10,
      incidentDate: "2026-09-05",
      descriptionHash: "not-a-hash",
    });

    expect(parsed.success).toBe(false);
  });
});
