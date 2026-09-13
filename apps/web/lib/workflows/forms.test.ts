import { describe, expect, it, vi } from "vitest";
import {
  applyCommandPreset,
  bdtToMinor,
  buildWorkflowCommand,
  createWorkflowFormValues,
} from "./forms";

describe("guided workflow forms", () => {
  it("converts exact BDT values to integer minor units", () => {
    expect(bdtToMinor("2500")).toBe(250_000);
    expect(bdtToMinor("10.05")).toBe(1_005);
    expect(() => bdtToMinor("10.005")).toThrow(/two decimal/);
    expect(() => bdtToMinor("0")).toThrow(/positive/);
  });

  it("builds immutable quorum and appeal commands", async () => {
    const hashText = vi.fn().mockResolvedValue("d".repeat(64));
    const review = await buildWorkflowCommand("openClaimReview", {
      claimId: "claim-1", reviewId: "review-1", assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: "3", rejectionThreshold: "2", deadline: "2026-09-09T12:00:00Z",
    }, hashText);
    expect(review).toMatchObject({ operation: "openClaimReview", approvalThreshold: 3, rejectionThreshold: 2 });
    const appeal = await buildWorkflowCommand("submitClaimAppeal", {
      appealId: "appeal-1", claimId: "claim-1", reasonCategory: "DOCUMENT_ERROR",
      reasonText: "new medical facts", descriptionText: "corrected invoice", evidenceText: "",
      proposedAmountMinor: "0", proposedIncidentDate: "", proposedDescriptionText: "",
      proposedClinicalReferenceHash: "c".repeat(64),
    }, hashText);
    expect(appeal).toMatchObject({ operation: "submitClaimAppeal", reasonCategory: "DOCUMENT_ERROR", reasonHash: "d".repeat(64), descriptionHash: "d".repeat(64), evidenceHash: "", proposedClinicalReferenceHash: "c".repeat(64) });
  });

  it("builds a validated command and hashes private source text", async () => {
    const hashText = vi.fn().mockResolvedValue("a".repeat(64));
    const command = await buildWorkflowCommand("submitClaim", {
      id: "claim-guided",
      policyId: "policy-guided",
      hospitalId: "hospital-demo",
      amountBdt: "2500.50",
      incidentDate: "2026-09-05",
      descriptionText: "case-file-42",
    }, hashText);

    expect(hashText).toHaveBeenCalledWith("case-file-42");
    expect(command).toEqual({
      operation: "submitClaim",
      id: "claim-guided",
      policyId: "policy-guided",
      hospitalId: "hospital-demo",
      amountMinor: 250_050,
      incidentDate: "2026-09-05",
      descriptionHash: "a".repeat(64),
    });
  });

  it("prefills dashboard commands without leaking placeholder hashes", () => {
    const initial = createWorkflowFormValues("submitClaim", () => "abcdef00");
    const prepared = applyCommandPreset("submitClaim", initial, {
      operation: "submitClaim",
      policyId: "policy-owned",
      amountMinor: 250_000,
      descriptionHash: "b".repeat(64),
    });

    expect(prepared.policyId).toBe("policy-owned");
    expect(prepared.amountBdt).toBe("2500.00");
    expect(prepared.descriptionText).toBe("");
  });

  it("builds a premium compensation command with locally hashed references", async () => {
    const hashText = vi.fn().mockResolvedValueOnce("b".repeat(64)).mockResolvedValueOnce("c".repeat(64));
    const command = await buildWorkflowCommand("recordPremiumAdjustment", {
      id: "adjustment-1", paymentId: "payment-1", amountBdt: "25.50",
      externalReferenceText: "bank-reversal-88", reasonText: "duplicate debit",
    }, hashText);
    expect(command).toEqual({ operation: "recordPremiumAdjustment", id: "adjustment-1", paymentId: "payment-1", amountMinor: 2_550, externalReferenceHash: "b".repeat(64), reasonHash: "c".repeat(64) });
    expect(hashText).toHaveBeenCalledTimes(2);
  });

  it("builds exact two-Oracle request and governed fallback commands", async () => {
    const hashText = vi.fn();
    const oracle = await buildWorkflowCommand("requestOracleVerification", {
      requestId: "request-1", claimId: "claim-1", snapshotId: "registry-demo-v1",
      modelVersion: "model-v1", modelHash: "c".repeat(64), assignedOracleIdsJson: '["oracle1","oracle2"]',
      commitDeadline: "2026-09-09T12:00:00Z", revealDeadline: "2026-09-09T12:10:00Z",
    }, hashText);
    expect(oracle).toMatchObject({ operation: "requestOracleVerification", assignedOracleIdsJson: '["oracle1","oracle2"]' });
    const fallback = await buildWorkflowCommand("routeOracleFailureToReview", {
      requestId: "request-1", reviewId: "review-1", assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]',
      approvalThreshold: "3", rejectionThreshold: "2", deadline: "2026-09-12T12:00:00Z",
    }, hashText);
    expect(fallback).toMatchObject({ operation: "routeOracleFailureToReview", approvalThreshold: 3, rejectionThreshold: 2 });
    expect(hashText).not.toHaveBeenCalled();
  });
});
