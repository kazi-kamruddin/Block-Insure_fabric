import { NextResponse } from "next/server";
import { EndorseError } from "@hyperledger/fabric-gateway";
import { currentSession } from "@/lib/auth/current-session";
import type { Session } from "@/lib/auth/session-token";
import { findDemoAccount } from "@/lib/auth/accounts";
import { loadFabricConfig } from "@/lib/fabric/config";
import { ledger } from "@/lib/fabric/ledger";
import { ledgerIdSchema } from "@/lib/fabric/validation";
import { medicalReviewCommand, type MedicalReviewCommand } from "@/lib/fabric/medical-review";
import { isMedicalChannel, medicalDevLiteChannel } from "@/lib/fabric/medical-channel";
import { buildMedicalTimeline, hasFinalMedicalApproval } from "@/lib/fabric/medical-timeline";
import { checkMutationOrigin } from "@/lib/security/request-origin";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function enabled() {
  return process.env.FABRIC_MEDICAL_REVIEW_ENABLED === "true" && isMedicalChannel(loadFabricConfig().channelName);
}
type ReviewRole = "insurerAdmin" | "policyholder" | "auditor";
function reviewRole(role: Session["role"]): role is ReviewRole {
  return role === "insurerAdmin" || role === "policyholder" || role === "auditor";
}

export async function GET(request: Request) {
  if (!enabled()) return reply({ message: "Medical review is unavailable on this deployment" }, 404);
  const session = await currentSession().catch(() => null);
  if (!session || !reviewRole(session.role)) return reply({ message: "Medical case access required" }, 403);
  const query = new URL(request.url).searchParams;
  const parsed = ledgerIdSchema.safeParse(query.get("claim"));
  if (!parsed.success) return reply({ message: "Enter a valid claim ID" }, 400);
  try {
    const claim = await ledger.readClaim(parsed.data);
    const review = claim.currentReviewId ? await ledger.readClaimReview(claim.currentReviewId) : null;
    if (!claim.episodeId || (session.role === "policyholder" && claim.claimantId !== session.subjectId)
      || (session.role === "auditor" && (!review || review.medicalVersion !== claim.version || !review.assignedAuditorIds.includes(session.subjectId ?? "")))) {
      return reply({ message: "Medical case access required" }, 403);
    }
    if (query.has("revision")) {
      const revision = query.get("revision") ?? "";
      if (session.role !== "policyholder" || !/^[1-9][0-9]{0,8}$/.test(revision)) return reply({ message: "Invalid appeal revision" }, 400);
      return reply({ quote: await ledger.quoteMedicalAppeal(claim.id, revision) });
    }
    const devLite = loadFabricConfig().channelName === medicalDevLiteChannel;
    const [appeal, clarification, documents, grants, checks, decisions, facts, oracle, certificate, settlement] = await Promise.all([
      claim.currentAppealId ? ledger.readClaimAppeal(claim.currentAppealId) : null,
      claim.medicalClarificationId ? ledger.readMedicalClarification(session.role === "policyholder" ? session.role : "insurerAdmin", claim.medicalClarificationId) : null,
      Promise.all(claim.evidenceIds.map(id => ledger.readEvidenceReference(id))),
      review ? ledger.listEvidenceAccessGrants() : [],
      review ? ledger.listMedicalEvidenceChecks(review.id) : [],
      review && (session.role !== "auditor" || review.status !== "OPEN") ? ledger.listAuditorDecisions() : [],
      ledger.readMedicalReviewFacts(claim.id),
      devLite && claim.currentOracleRequestId ? ledger.readOracleRequest(claim.currentOracleRequestId) : null,
      devLite && hasFinalMedicalApproval(claim) ? ledger.readMedicalApprovalCertificate(claim.id, claim.version) : null,
      devLite && claim.medicalSettlementId ? ledger.readSettlement(claim.medicalSettlementId) : null,
    ]);
    const timeline = devLite ? buildMedicalTimeline({ claim,
      review: review?.medicalVersion === claim.version ? review : null,
      clarification, appeal, documents, grants, checks, readAt: Date.now(),
      oracle: oracle?.claimVersion === claim.version ? oracle : null,
      certificate, settlement: settlement?.approvalCertificateHash === certificate?.hash ? settlement : null,
    }) : undefined;
    return reply({ claim, review, appeal, clarification, documents, facts, devLite, timeline,
      appealExplanation: appeal ? await ledger.readMedicalAppealExplanation(session.role === "policyholder" ? session.role : "insurerAdmin", appeal.id) : null,
      grants: grants.filter(grant => grant.medicalReviewId === review?.id && (session.role !== "auditor" || grant.granteeSubject === session.subjectId)),
      checks: checks.filter(check => session.role !== "auditor" || check.auditorId === session.subjectId),
      decisions: decisions.filter(decision => decision.reviewId === review?.id) });
  } catch {
    return reply({ message: "Medical case or current quote is unavailable" }, 409);
  }
}

const permissions = {
  prepare: "insurerAdmin", open: "insurerAdmin", recover: "insurerAdmin", expire: "insurerAdmin", ask: "insurerAdmin",
  share: "policyholder", appeal: "policyholder", escalate: "policyholder", confirm: "auditor", vote: "auditor",
} as const;

function allowed(action: MedicalReviewCommand, role: ReviewRole) {
  if (action.action === "respond") return role === (action.response === "EXPIRED" ? "insurerAdmin" : "policyholder");
  if (action.action === "recordOCR") return role === "policyholder" || role === "auditor";
  if (action.action === "open" && role === "auditor") return true; // Chaincode checks escalation and assignment.
  return permissions[action.action] === role;
}

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return reply({ message: trust.reason }, 403);
  if (!enabled()) return reply({ message: "Medical review is unavailable on this deployment" }, 404);
  const session = await currentSession().catch(() => null);
  const input = medicalReviewCommand.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ message: "Check the medical workflow fields" }, 400);
  if ((input.data.action === "escalate" || (input.data.action === "open" && session?.role === "auditor")) &&
      loadFabricConfig().channelName !== medicalDevLiteChannel) return reply({ message: "Action unavailable on this channel" }, 404);
  if (!session || !reviewRole(session.role) || !allowed(input.data, session.role)) return reply({ message: "This role cannot perform that action" }, 403);
  try {
    return reply({ result: await ledger.medicalReviewAction(session.role, input.data, findDemoAccount(session.accountId)?.fabricUserName) });
  } catch (error) {
    if (input.data.action === "open" && error instanceof EndorseError) {
      const missing = error.details.map(detail =>
        /\bauditor[1-4] must confirm decryption of [A-Za-z0-9._-]+\b/.exec(detail.message)?.[0],
      ).find(Boolean);
      if (missing) return reply({ message: missing }, 409);
    }
    const hasPrivateMessage = "message" in input.data && Boolean(input.data.message);
    return reply({ message: error instanceof Error && !hasPrivateMessage
      ? error.message.slice(0, 300) : "The action was not confirmed. Refresh the case before retrying." }, 409);
  }
}
