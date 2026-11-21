import type { Session } from "@/lib/auth/session-token";
import type { AuditorDecision, ClaimReview } from "@/lib/fabric/types";

type Viewer = Pick<Session, "role" | "subjectId">;

/**
 * Individual auditor votes stay sealed in browser responses while their
 * review round is still OPEN. The insurer operator keeps the live tally and
 * each auditor sees only their own vote. Closed, superseded or expired rounds
 * are unaffected. This is a Gateway disclosure boundary only: channel members
 * with direct peer access can still read the public decision records (F01).
 */
export function canSeeDecision(decision: AuditorDecision, review: Pick<ClaimReview, "id" | "status"> | undefined, viewer: Viewer) {
  if (!review || review.id !== decision.reviewId || review.status !== "OPEN") return true;
  if (viewer.role === "insurerAdmin") return true;
  return viewer.role === "auditor" && Boolean(viewer.subjectId) && decision.auditorId === viewer.subjectId;
}

export function visibleDecisions(decisions: AuditorDecision[], reviews: Pick<ClaimReview, "id" | "status">[], viewer: Viewer) {
  const byId = new Map(reviews.map(review => [review.id, review]));
  return decisions.filter(decision => canSeeDecision(decision, byId.get(decision.reviewId), viewer));
}
