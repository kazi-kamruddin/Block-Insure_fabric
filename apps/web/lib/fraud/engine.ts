import { createHash } from "node:crypto";

const engine = {
  engineId: "transparent-claim-triage",
  engineVersion: "1.0.0",
  thresholds: { medium: 3_500, high: 7_000 },
  weights: { coverageRatio90: 3_500, coverageRatio70: 2_500, coverageRatio40: 1_000, noEvidence: 2_500, oneEvidence: 800, twoPriorClaims: 2_000, onePriorClaim: 1_000 },
} as const;

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type FraudAssessmentResult = { engineId: string; engineVersion: string; modelHash: string; inputHash: string; scoreBps: number; riskLevel: "LOW" | "MEDIUM" | "HIGH"; signalsJson: string };
export type FraudAssessmentInput = { schemaVersion: 1; claimId: string; policyId: string; amountMinor: number; coverageLimitMinor: number; coverageRatioBps: number; evidenceCount: number; priorPolicyClaimCount: number };

export function scoreFraudInput(input: FraudAssessmentInput): FraudAssessmentResult {
  let scoreBps = 0;
  const signals: string[] = [];
  if (input.coverageRatioBps >= 9_000) { scoreBps += engine.weights.coverageRatio90; signals.push("COVERAGE_RATIO_90_PLUS"); }
  else if (input.coverageRatioBps >= 7_000) { scoreBps += engine.weights.coverageRatio70; signals.push("COVERAGE_RATIO_70_PLUS"); }
  else if (input.coverageRatioBps >= 4_000) { scoreBps += engine.weights.coverageRatio40; signals.push("COVERAGE_RATIO_40_PLUS"); }
  if (input.evidenceCount === 0) { scoreBps += engine.weights.noEvidence; signals.push("NO_EVIDENCE_REFERENCES"); }
  else if (input.evidenceCount === 1) { scoreBps += engine.weights.oneEvidence; signals.push("SINGLE_EVIDENCE_REFERENCE"); }
  if (input.priorPolicyClaimCount >= 2) { scoreBps += engine.weights.twoPriorClaims; signals.push("MULTIPLE_PRIOR_POLICY_CLAIMS"); }
  else if (input.priorPolicyClaimCount === 1) { scoreBps += engine.weights.onePriorClaim; signals.push("PRIOR_POLICY_CLAIM"); }
  scoreBps = Math.min(10_000, scoreBps);
  const riskLevel = scoreBps >= engine.thresholds.high ? "HIGH" : scoreBps >= engine.thresholds.medium ? "MEDIUM" : "LOW";
  return { engineId: engine.engineId, engineVersion: engine.engineVersion, modelHash: hashJson(engine), inputHash: hashJson(input), scoreBps, riskLevel, signalsJson: JSON.stringify(signals) };
}

export const fraudEngineDefinition = engine;
