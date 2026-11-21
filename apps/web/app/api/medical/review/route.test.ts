import { EndorseError } from "@hyperledger/fabric-gateway";
import { afterEach, expect, it, vi } from "vitest";
import { ledger } from "@/lib/fabric/ledger";
import { POST } from "./route";

vi.mock("@/lib/auth/current-session", () => ({
  currentSession: vi.fn(async () => ({ role: "insurerAdmin", accountId: "insurer-admin" })),
}));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: { medicalReviewAction: vi.fn() } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
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
