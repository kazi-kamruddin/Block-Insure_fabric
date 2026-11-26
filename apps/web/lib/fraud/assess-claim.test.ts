import { describe, expect, it, vi } from "vitest";
import { ledger } from "@/lib/fabric/ledger";
import type { Claim, Policy } from "@/lib/fabric/types";
import { assessClaimFraud } from "./assess-claim";
import { scoreFraudInput, type FraudAssessmentInput } from "./engine";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: {
  readClaim: vi.fn(), listClaims: vi.fn(), readPolicy: vi.fn(),
} }));

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
  it("counts prior claims by instant when equivalent date formats sort differently", async () => {
    const claim = { id: "target", policyId: "policy", amountMinor: 100, evidenceIds: ["a", "b"],
      createdAt: "2026-11-25T09:00:00Z" } as Claim;
    vi.mocked(ledger.readClaim).mockResolvedValue(claim);
    vi.mocked(ledger.listClaims).mockResolvedValue([
      claim,
      { ...claim, id: "earlier", createdAt: "2026-11-25T14:00:00+06:00" },
      { ...claim, id: "same-instant", createdAt: "2026-11-25T09:00:00.000Z" },
      { ...claim, id: "later", createdAt: "2026-11-25T08:30:00-01:00" },
    ]);
    vi.mocked(ledger.readPolicy).mockResolvedValue({ coverageLimitMinor: 1_000 } as Policy);
    expect(await assessClaimFraud("target")).toMatchObject({
      scoreBps: 1_000,
      signalsJson: '["PRIOR_POLICY_CLAIM"]',
    });
  });

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
