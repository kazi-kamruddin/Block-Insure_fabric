import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { medicalDevLiteChannel } from "@/lib/fabric/medical-channel";
import { bindReasonDraft, readBoundReason, saveReasonDraft } from "@/lib/fabric/review-reason-store";
import { ledgerIdSchema as id } from "@/lib/fabric/validation";
import { isVoteVisible } from "@/lib/fabric/vote-visibility";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const scope = { reviewId: id, round: z.number().int().positive(), attemptId: id };
const command = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("draft"), ...scope,
    text: z.string().trim().min(1).max(2000).refine(value => Buffer.byteLength(value, "utf8") <= 2000),
    evidenceRefs: z.array(id).max(40),
  }),
  z.strictObject({ action: z.literal("bind"), ...scope, decisionId: id }),
]);
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const enabled = () => process.env.FABRIC_CHANNEL_NAME === medicalDevLiteChannel && process.env.FABRIC_MEDICAL_REVIEW_ENABLED === "true";
const denied = () => reply({ message: "Medical review reason access required" }, 403);

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return reply({ message: trust.reason }, 403);
  if (!enabled()) return reply({ message: "Review reason receipts are unavailable" }, 404);
  const session = await currentSession().catch(() => null);
  if (session?.role !== "auditor" || !session.subjectId) return denied();
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ message: "Invalid review reason fields" }, 400);
  const input = parsed.data;
  const review = await ledger.readClaimReview(input.reviewId).catch(() => null);
  if (!review?.medicalVersion || review.round !== input.round || !review.assignedAuditorIds.includes(session.subjectId)) return denied();
  const storageScope = { reviewId: review.id, auditorId: session.subjectId, round: review.round };
  try {
    if (input.action === "draft") {
      if (review.status !== "OPEN") return denied();
      const claim = await ledger.readClaim(review.claimId);
      if (claim.currentReviewId !== review.id || claim.version !== review.medicalVersion || !claim.episodeId ||
        input.evidenceRefs.some(ref => !claim.evidenceIds.includes(ref))) return denied();
      const evidenceRefs = [...new Set(input.evidenceRefs)].sort();
      if (!await saveReasonDraft(storageScope, input.attemptId, { text: input.text, evidenceRefs })) {
        return reply({ message: "This attempt already has a different draft" }, 409);
      }
      return reply({ saved: true });
    }
    const decision = await ledger.readAuditorDecision(input.decisionId);
    if (decision.claimId !== review.claimId || decision.reviewId !== review.id || decision.reviewRound !== review.round ||
      decision.auditorId !== session.subjectId ||
      !await bindReasonDraft(storageScope, input.attemptId, decision)) {
      return reply({ message: "The draft does not match this committed vote" }, 409);
    }
    return reply({ bound: true });
  } catch {
    return reply({ message: "Review reason was not confirmed" }, 409);
  }
}

export async function GET(request: Request) {
  if (!enabled()) return reply({ message: "Review reason receipts are unavailable" }, 404);
  const session = await currentSession().catch(() => null);
  if (!session || !["insurerAdmin", "policyholder", "auditor"].includes(session.role)) return denied();
  const parsed = id.safeParse(new URL(request.url).searchParams.get("reviewId"));
  if (!parsed.success) return reply({ message: "Invalid review ID" }, 400);
  const review = await ledger.readClaimReview(parsed.data).catch(() => null);
  if (!review?.medicalVersion || !isVoteVisible(review, session)) return denied();
  const claim = await ledger.readClaim(review.claimId).catch(() => null);
  if (!claim?.episodeId || (session.role === "policyholder" && claim.claimantId !== session.subjectId)) return denied();
  try {
    const decisions = await ledger.listAuditorDecisions();
    const receipts = await Promise.all(decisions.filter(decision =>
      decision.claimId === claim.id && decision.reviewId === review.id && decision.reviewRound === review.round &&
      review.assignedAuditorIds.includes(decision.auditorId)).map(readBoundReason));
    return reply({ receipts: receipts.filter(Boolean) });
  } catch {
    return reply({ message: "Review reasons are unavailable" }, 502);
  }
}
