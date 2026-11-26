import { EndorseError } from "@hyperledger/fabric-gateway";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { MedicalTimeline } from "@/components/medical-timeline";
import { StatusBadge } from "@/components/status-badge";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import type { Claim, OracleRequest } from "@/lib/fabric/types";
import { GET, POST } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/fabric/ledger-time", () => ({ latestLedgerTimestamp: vi.fn(async () => null) }));
vi.mock("@/lib/fabric/gateway", () => ({
  withFabricContract: vi.fn(async (_role, evaluate) => evaluate({
    evaluateTransaction: async (name: string) => Buffer.from(name === "ReadMedicalTimingProfile"
      ? JSON.stringify({ profile: "DEMO" }) : "2026-11-25T09:04:00Z"),
  })),
}));
vi.mock("@/lib/auth/current-session", () => ({
  currentSession: vi.fn(async () => ({ role: "insurerAdmin", accountId: "insurer-admin" })),
}));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: {
  medicalReviewAction: vi.fn(), readClaim: vi.fn(), readOracleRequest: vi.fn(), readMedicalReviewFacts: vi.fn(),
} }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("shows a held model returned by the ledger in the claim timeline and status badge", async () => {
  vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-dev-lite-190");
  vi.stubEnv("FABRIC_MEDICAL_REVIEW_ENABLED", "true");
  vi.stubEnv("FABRIC_MEDICAL_SOURCE_PUBLISHER", "true");
  vi.mocked(currentSession).mockResolvedValue({ role: "insurerAdmin", accountId: "insurer-admin", issuedAt: 0, expiresAt: 1 });
  const claim: Claim = {
    assetType: "claim", schemaVersion: 15, hospitalId: "hospital-test", policyId: "policy-test",
    id: "claim-test", episodeId: "episode-test", version: 1, status: "MEDICAL_REVIEW_REQUIRED",
    claimantId: "holder", currentOracleRequestId: "request-test", evidenceIds: [],
    createdAt: "2026-11-25T09:00:00Z", updatedAt: "2026-11-25T09:02:00Z",
    amountMinor: 10_000, incidentDate: "2026-11-23", descriptionHash: "d".repeat(64),
    hospitalVerificationId: "verify-test", auditorDecisionId: "", currentReviewId: "", currentAppealId: "",
    oracleOutcome: "", oracleResultHash: "", reviewRound: 0, appealCount: 0,
  };
  const oracle: OracleRequest = {
    assetType: "oracleRequest", schemaVersion: 15, id: "request-test", claimId: claim.id, claimVersion: 1,
    hospitalVerificationId: claim.hospitalVerificationId, appealId: "", appealCommitmentHash: "",
    queryHash: "q".repeat(64), registrySnapshotId: "snapshot-test", registryVersion: 1, registryRootHash: "c".repeat(64),
    rulesVersion: "rules-v1", rulesHash: "b".repeat(64), modelVersion: "model-v1", modelHash: "a".repeat(64),
    assignedOracleIds: ["oracle1", "oracle2", "oracle3"], requiredConfirmations: 2, expectedResponses: 3,
    commitmentCount: 0, revealCount: 0, status: "FAILED", finalizationCode: "MODEL_HELD", verifiedResult: false,
    resultHash: "", requestedAt: "2026-11-25T09:00:00Z", commitDeadline: "2026-11-25T09:01:00Z",
    revealDeadline: "2026-11-25T09:02:00Z",
    finalizedAt: "2026-11-25T09:02:00Z",
  };
  vi.mocked(ledger.readClaim).mockResolvedValue(claim);
  vi.mocked(ledger.readOracleRequest).mockResolvedValue(oracle);
  const response = await GET(new Request("http://127.0.0.1:3219/api/medical/review?claim=claim-test"));
  expect(response.status).toBe(200);
  const { timeline, activeTimingProfile, sourcePublisher } = await response.json();
  expect(activeTimingProfile).toBe("DEMO");
  expect(sourcePublisher).toBe(true);
  expect(renderToStaticMarkup(createElement(MedicalTimeline, { timeline }))).toContain("Model on hold");
  expect(renderToStaticMarkup(createElement(StatusBadge, { status: "MODEL_HELD" }))).toContain("Model on hold");

  vi.mocked(currentSession).mockResolvedValue({ role: "policyholder", accountId: "demo-holder", subjectId: claim.claimantId,
    issuedAt: 0, expiresAt: 1 });
  const holderView = await GET(new Request("http://127.0.0.1:3219/api/medical/review?claim=claim-test"));
  expect(await holderView.json()).toMatchObject({ escalationEligibleAt: "2026-11-25T09:04:00Z" });
});

it("shows the missing decryption acknowledgment without exposing peer details", async () => {
  vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-medical-reimbursement");
  vi.stubEnv("FABRIC_MEDICAL_REVIEW_ENABLED", "true");
  vi.mocked(ledger.medicalReviewAction).mockRejectedValue(new EndorseError({
    code: 10,
    transactionId: "synthetic-rejected-tx",
    cause: new Error("failed to endorse") as never,
    details: [{ address: "peer.internal", mspId: "InsurerMSP",
      message: "chaincode response 500, auditor4 must confirm decryption of med-clarification-test" }],
  }));
  const response = await POST(new Request("http://127.0.0.1:3210/api/medical/review", {
    method: "POST",
    body: JSON.stringify({ action: "open", reviewId: "review-test", deadline: "2026-11-19T23:00:00.000Z" }),
  }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ message: "auditor4 must confirm decryption of med-clarification-test" });
});

it("routes reservation release only on the development channel and for claimant or insurer roles", async () => {
  const { currentSession } = await import("@/lib/auth/current-session");
  const release = () => POST(new Request("http://127.0.0.1:3210/api/medical/review", {
    method: "POST", body: JSON.stringify({ action: "release", claimId: "claim-test" }),
  }));
  vi.stubEnv("FABRIC_MEDICAL_REVIEW_ENABLED", "true");
  vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-medical-reimbursement");
  vi.mocked(currentSession).mockResolvedValue({ role: "policyholder", accountId: "policyholder", subjectId: "policyholder1", issuedAt: 0, expiresAt: 1 });
  expect((await release()).status).toBe(404);

  vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-dev-lite-190");
  vi.mocked(currentSession).mockResolvedValue({ role: "auditor", accountId: "auditor", subjectId: "auditor1", issuedAt: 0, expiresAt: 1 });
  expect((await release()).status).toBe(403);
  expect(ledger.medicalReviewAction).not.toHaveBeenCalled();

  vi.mocked(currentSession).mockResolvedValue({ role: "policyholder", accountId: "policyholder", subjectId: "policyholder1", issuedAt: 0, expiresAt: 1 });
  vi.mocked(ledger.medicalReviewAction).mockResolvedValue({ id: "claim-test" } as never);
  expect((await release()).status).toBe(200);
  expect(ledger.medicalReviewAction).toHaveBeenCalledWith("policyholder", { action: "release", claimId: "claim-test" }, undefined);
});
