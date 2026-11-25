import type { Session } from "@/lib/auth/session-token";
import type { AuditorDecision, ClaimReview } from "@/lib/fabric/types";

type Viewer = Pick<Session, "role" | "subjectId">;
type Review = Pick<ClaimReview, "id" | "status" | "assignedAuditorIds">;
type ReviewState = { status: string; assignedAuditorIds?: readonly string[] };

const closedStatuses = new Set(["APPROVED", "REJECTED", "TIMED_OUT", "ACCESS_FAILED", "SUPERSEDED"]);

export function isVoteVisible(review: ReviewState | null | undefined, viewer: Viewer) {
  if (!review || !closedStatuses.has(review.status)) return false;
  if (viewer.role !== "auditor") return true;
  return Boolean(viewer.subjectId && review.assignedAuditorIds?.includes(viewer.subjectId));
}

export function redactVoteTallies<T extends ReviewState>(review: T, viewer: Viewer): T {
  if (isVoteVisible(review, viewer)) return review;
  return { ...review, votesCast: 0, approvals: 0, rejections: 0 };
}

export function canSeeDecision(decision: AuditorDecision, review: Review | undefined, viewer: Viewer) {
  return review?.id === decision.reviewId && isVoteVisible(review, viewer);
}

export function visibleDecisions(decisions: AuditorDecision[], reviews: Review[], viewer: Viewer) {
  const byId = new Map(reviews.map(review => [review.id, review]));
  return decisions.filter(decision => canSeeDecision(decision, byId.get(decision.reviewId), viewer));
}
