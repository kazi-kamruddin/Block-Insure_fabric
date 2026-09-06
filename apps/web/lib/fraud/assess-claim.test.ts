import { describe, expect, it } from "vitest";
import { scoreFraudInput, type FraudAssessmentInput } from "./engine";

const base: FraudAssessmentInput = {
  schemaVersion: 1,
  claimId: "claim-1",
  policyId: "policy-1",
  amountMinor: 900_000,
  coverageLimitMinor: 1_000_000,
  coverageRatioBps: 9_000,
  evidenceCount: 0,
  priorPolicyClaimCount: 2,
};

describe("transparent fraud decision support", () => {
  it("is deterministic, versioned, and returns explainable signals", () => {
    const first = scoreFraudInput(base);
    const second = scoreFraudInput({ ...base });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ engineId: "transparent-claim-triage", engineVersion: "1.0.0", scoreBps: 8_000, riskLevel: "HIGH" });
    expect(JSON.parse(first.signalsJson)).toEqual(["COVERAGE_RATIO_90_PLUS", "NO_EVIDENCE_REFERENCES", "MULTIPLE_PRIOR_POLICY_CLAIMS"]);
    expect(first.modelHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not return a claim decision or settlement instruction", () => {
    const result = scoreFraudInput({ ...base, coverageRatioBps: 1_000, evidenceCount: 3, priorPolicyClaimCount: 0 });
    expect(result).toMatchObject({ scoreBps: 0, riskLevel: "LOW", signalsJson: "[]" });
    expect(result).not.toHaveProperty("outcome");
    expect(result).not.toHaveProperty("status");
  });
});
