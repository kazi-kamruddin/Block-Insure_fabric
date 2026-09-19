import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import { scoreFraudInput, type FraudAssessmentInput, type FraudAssessmentResult } from "./engine";

export async function assessClaimFraud(claimId: string): Promise<FraudAssessmentResult> {
  const [claim, claims] = await Promise.all([ledger.readClaim(claimId), ledger.listClaims()]);
  const policy = await ledger.readPolicy(claim.policyId);
  const priorClaims = claims.filter((item) =>
    item.policyId === claim.policyId && item.id !== claim.id && item.createdAt < claim.createdAt,
  ).length;
  const ratioBps = Math.min(10_000, Math.floor((claim.amountMinor * 10_000) / policy.coverageLimitMinor));
  const input: FraudAssessmentInput = {
    schemaVersion: 1,
    claimId: claim.id,
    policyId: claim.policyId,
    amountMinor: claim.amountMinor,
    coverageLimitMinor: policy.coverageLimitMinor,
    coverageRatioBps: ratioBps,
    evidenceCount: claim.evidenceIds.length,
    priorPolicyClaimCount: priorClaims,
  };

  return scoreFraudInput(input);
}
