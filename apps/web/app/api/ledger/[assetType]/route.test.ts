import { expect, it, vi } from "vitest";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import type { Claim, ClaimReview } from "@/lib/fabric/types";
import { GET as list } from "./route";
import { GET as read } from "./[id]/route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-session", () => ({ currentSession: vi.fn() }));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: {
  listClaims: vi.fn(), listClaimReviews: vi.fn(), readClaim: vi.fn(), readClaimReview: vi.fn(), readAuditorDecision: vi.fn(),
} }));
const request = new Request("http://localhost:3219/api/ledger/claim");
const get = (assetType: string, id: string) => read(request, { params: Promise.resolve({ assetType, id }) });

it("limits both claim collection and claim details to the auditor's current assigned review and version", async () => {
  vi.mocked(currentSession).mockResolvedValue({ role: "auditor", accountId: "auditor", subjectId: "auditor1", issuedAt: 0, expiresAt: 1 });
  const claims = [
    { id: "assigned", currentReviewId: "assigned-review", episodeId: "episode-1", version: 2 },
    { id: "other", currentReviewId: "other-review", episodeId: "episode-2", version: 2 },
    { id: "outdated", currentReviewId: "outdated-review", episodeId: "episode-3", version: 2 },
  ] as Claim[];
  vi.mocked(ledger.listClaims).mockResolvedValue(claims);
  vi.mocked(ledger.listClaimReviews).mockResolvedValue([
    { id: "assigned-review", claimId: "assigned", assignedAuditorIds: ["auditor1"], medicalVersion: 2 },
    { id: "other-review", claimId: "other", assignedAuditorIds: ["auditor2"], medicalVersion: 2 },
    { id: "outdated-review", claimId: "outdated", assignedAuditorIds: ["auditor1"], medicalVersion: 1 },
  ] as ClaimReview[]);
  vi.mocked(ledger.readClaim).mockImplementation(async id => claims.find(claim => claim.id === id)!);
  const collection = await list(request, { params: Promise.resolve({ assetType: "claim" }) });
  expect(await collection.json()).toEqual({ result: [claims[0]] });
  expect((await get("claim", "assigned")).status).toBe(200);
  expect((await get("claim", "other")).status).toBe(403);
  expect((await get("claim", "outdated")).status).toBe(403);
});

it("refuses a vote lookup while open or when its review cannot be read", async () => {
  vi.mocked(currentSession).mockResolvedValue({ role: "insurerAdmin", accountId: "insurer-admin", issuedAt: 0, expiresAt: 1 });
  vi.mocked(ledger.readAuditorDecision).mockResolvedValue({
    assetType: "auditorDecision", schemaVersion: 15, id: "decision-1", reviewId: "review-1",
    claimId: "claim-1", reviewRound: 1, auditorId: "auditor1", auditorIdentity: "auditor1",
    outcome: "REJECT", reasonHash: "a".repeat(64), createdAt: "2026-11-25T00:00:00Z",
  });
  vi.mocked(ledger.readClaimReview).mockRejectedValueOnce(new Error("review unavailable"));
  expect((await get("decision", "decision-1")).status).toBe(403);
  vi.mocked(ledger.readClaimReview).mockResolvedValueOnce({ id: "review-1", status: "OPEN" } as ClaimReview);
  expect((await get("decision", "decision-1")).status).toBe(403);
  vi.mocked(ledger.readClaimReview).mockResolvedValueOnce({ id: "review-1", status: "REJECTED" } as ClaimReview);
  const closed = await get("decision", "decision-1");
  expect(closed.status).toBe(200);
  expect(await closed.json()).toMatchObject({ result: { outcome: "REJECT" } });
});
