import { describe, expect, it } from "vitest";
import { buildMedicalTimeline } from "./medical-timeline";
import type { Claim, ClaimReview, EvidenceAccessGrant, EvidenceReference } from "./types";
import type { MedicalClarification } from "./medical-review";

const before = "2026-11-19T12:00:00Z";
const now = Date.parse("2026-11-20T12:00:00Z");
const upcoming = "2026-11-22T12:00:00Z";
const review = { id: "review", assignedAuditorIds: ["auditor1"], prepareBy: upcoming } as ClaimReview;

const preparing: Parameters<typeof buildMedicalTimeline>[0] = {
  claim: { status: "MEDICAL_REVIEW_PREPARING", version: 1, claimantId: "holder" } as Claim,
  review, clarification: null, appeal: null, oracle: null, certificate: null, settlement: null,
  documents: [], grants: [], checks: [], readAt: now,
};

describe("medical timeline next action", () => {
  it("routes an expired clarification to the Insurer", () => {
    const clarification = { status: "PENDING", deadline: before } as MedicalClarification;
    expect(buildMedicalTimeline({ ...preparing, clarification }).nextAction).toBe("Insurer closes the expired clarification.");
  });

  it("routes an expired voting round to finalization", () => {
    const expired = { ...review, deadline: before };
    const claim = { ...preparing.claim, status: "UNDER_REVIEW" } as const;
    expect(buildMedicalTimeline({ ...preparing, claim, review: expired }).nextAction).toBe("Insurer finalizes the expired review.");
  });

  it("asks the claimant to renew a grant that cannot cover the voting window", () => {
    const document = { id: "document", submittedBy: "holder", claimVersion: 1 } as EvidenceReference;
    const grant = { id: "grant", medicalReviewId: "review", evidenceId: "document", granteeSubject: "auditor1",
      status: "ACTIVE", accessCount: 1, maxAccesses: 3, expiresAt: "2026-11-20T18:00:00Z" } as EvidenceAccessGrant;
    const checks = [{ reviewId: "review", evidenceId: "document", grantId: "grant", auditorId: "auditor1", checkedAt: before }];
    const input = { ...preparing, documents: [document], grants: [grant], checks };
    expect(buildMedicalTimeline(input).nextAction).toBe("Policyholder grants evidence access to the assigned auditors.");
    expect(buildMedicalTimeline({ ...input, grants: [{ ...grant, expiresAt: upcoming }] }).nextAction)
      .toBe("Insurer opens voting once evidence is ready.");
  });
});
