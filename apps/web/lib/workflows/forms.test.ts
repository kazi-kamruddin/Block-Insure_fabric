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

  it("builds a validated command and hashes private source text", async () => {
    const hashText = vi.fn().mockResolvedValue("a".repeat(64));
    const command = await buildWorkflowCommand("submitClaim", {
      id: "claim-guided",
      policyId: "policy-guided",
      amountBdt: "2500.50",
      incidentDate: "2026-09-05",
      descriptionText: "case-file-42",
    }, hashText);

    expect(hashText).toHaveBeenCalledWith("case-file-42");
    expect(command).toEqual({
      operation: "submitClaim",
      id: "claim-guided",
      policyId: "policy-guided",
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
});
