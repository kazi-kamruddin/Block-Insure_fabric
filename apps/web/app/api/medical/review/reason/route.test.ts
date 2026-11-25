import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import type { ClaimReview } from "@/lib/fabric/types";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/current-session", () => ({ currentSession: vi.fn() }));
vi.mock("@/lib/fabric/ledger", () => ({ ledger: {
  readClaimReview: vi.fn(), readClaim: vi.fn(), readAuditorDecision: vi.fn(), listAuditorDecisions: vi.fn(),
} }));
vi.mock("server-only", () => ({}));

const url = "http://127.0.0.1:3219/api/medical/review/reason";
const text = "The charges agree with the episode evidence.";
const reasonCode = "TERMS_AND_EVIDENCE_SUPPORT";
const textHash = createHash("sha256").update(text).digest("hex");
const decision = {
  id: "decision-test", claimId: "claim-test", reviewId: "review-test", reviewRound: 1, auditorId: "auditor1",
  reasonCode, reasonHash: createHash("sha256").update(`medical-reason-v1|${reasonCode.length}:${reasonCode}|64:${textHash}`).digest("hex"),
};
const review = { id: "review-test", claimId: "claim-test", round: 1, medicalVersion: 1,
  assignedAuditorIds: ["auditor1", "auditor2", "auditor3", "auditor4"] };
const draft = { action: "draft", reviewId: review.id, round: review.round, attemptId: "attempt-test", text, evidenceRefs: ["evidence-test"] };
const bind = { action: "bind", reviewId: review.id, round: review.round, attemptId: draft.attemptId, decisionId: decision.id };
let directory: string;

function setRole(role: "auditor" | "policyholder" | "insurerAdmin", subjectId: string) {
  vi.mocked(currentSession).mockResolvedValue({ role, subjectId, accountId: subjectId, issuedAt: 0, expiresAt: 1 });
}

function setStatus(status: ClaimReview["status"]) {
  vi.mocked(ledger.readClaimReview).mockResolvedValue({ ...review, status } as ClaimReview);
}

const post = (body: object, origin = "http://127.0.0.1:3219") => POST(new Request(url, {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
}));
const get = () => GET(new Request(url + "?reviewId=review-test"));

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "fabric-review-reason-"));
  vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-dev-lite-190");
  vi.stubEnv("FABRIC_MEDICAL_REVIEW_ENABLED", "true");
  vi.stubEnv("MEDICAL_REVIEW_REASON_ROOT", directory);
  vi.stubEnv("FABRIC_MEDICAL_REVIEW_REASON_KEY", "b".repeat(64));
  setRole("auditor", "auditor1");
  setStatus("OPEN");
  vi.mocked(ledger.readClaim).mockResolvedValue({ id: "claim-test", version: 1, currentReviewId: "review-test",
    episodeId: "episode-test", claimantId: "BI-OWNER", evidenceIds: ["evidence-test"] } as never);
  vi.mocked(ledger.readAuditorDecision).mockResolvedValue(decision as never);
  vi.mocked(ledger.listAuditorDecisions).mockResolvedValue([decision] as never);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  if (path.dirname(directory) === tmpdir() && path.basename(directory).startsWith("fabric-review-reason-")) {
    await rm(directory, { recursive: true, force: true });
  }
});

it("denies cross-site writes and unassigned auditors before storing drafts", async () => {
  expect((await post(draft, "https://example.invalid")).status).toBe(403);
  setRole("auditor", "auditor5");
  expect((await post(draft)).status).toBe(403);
  expect(await readdir(directory)).toEqual([]);
});

it("binds encrypted text once and discloses it only after closure to eligible viewers", async () => {
  expect((await post(draft)).status).toBe(200);
  expect((await post(draft)).status).toBe(200);
  expect(await readFile(path.join(directory, review.id, "auditor1", "attempt-test.enc"), "utf8")).not.toContain(text);
  expect((await post(bind)).status).toBe(200);
  expect((await post(bind)).status).toBe(200);
  expect(await readdir(path.join(directory, review.id, "auditor1", "bound"))).toEqual(["decision-test.enc"]);
  for (const [role, subject] of [["policyholder", "BI-OWNER"], ["insurerAdmin", "operator"], ["auditor", "auditor2"]] as const) {
    setRole(role, subject);
    expect((await get()).status).toBe(403);
  }
  setStatus("APPROVED");
  setRole("policyholder", "BI-OTHER");
  expect((await get()).status).toBe(403);
  for (const [role, subject] of [["policyholder", "BI-OWNER"], ["insurerAdmin", "operator"], ["auditor", "auditor2"]] as const) {
    setRole(role, subject);
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ receipts: [{ decisionId: decision.id, auditorId: "auditor1", text,
      evidenceRefs: ["evidence-test"], matchesLedgerHash: true }] });
  }
});

it("preserves an unbound draft on hash mismatch and flags corrupted bound ciphertext", async () => {
  expect((await post(draft)).status).toBe(200);
  vi.mocked(ledger.readAuditorDecision).mockResolvedValueOnce({ ...decision, reasonHash: "0".repeat(64) } as never);
  expect((await post(bind)).status).toBe(409);
  setStatus("APPROVED");
  expect(await (await get()).json()).toEqual({ receipts: [] });
  expect((await post(bind)).status).toBe(200);
  const file = path.join(directory, review.id, "auditor1", "bound", "decision-test.enc");
  const bytes = await readFile(file);
  bytes[bytes.length - 4] ^= 1;
  await writeFile(file, bytes);
  expect(await (await get()).json()).toEqual({ receipts: [{ decisionId: decision.id, auditorId: "auditor1",
    text: null, evidenceRefs: [], matchesLedgerHash: false }] });
});
