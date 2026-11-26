import { NextResponse } from "next/server";
import { withPeerReasons } from "@/lib/fabric/peer-reasons";
import { currentSession } from "@/lib/auth/current-session";
import type { Session } from "@/lib/auth/session-token";
import { findDemoAccount } from "@/lib/auth/accounts";
import { loadFabricConfig } from "@/lib/fabric/config";
import { ledger } from "@/lib/fabric/ledger";
import { ledgerIdSchema } from "@/lib/fabric/validation";
import { medicalReviewCommand, type MedicalReviewCommand } from "@/lib/fabric/medical-review";
import { isMedicalChannel, medicalDevLiteChannel } from "@/lib/fabric/medical-channel";
import { buildMedicalTimeline, hasFinalMedicalApproval } from "@/lib/fabric/medical-timeline";
import { latestLedgerTimestamp } from "@/lib/fabric/ledger-time";
import { withFabricContract } from "@/lib/fabric/gateway";
import { issuedMedicalTerms, medicalHospitalName, medicalRevisionProof } from "@/lib/fabric/medical-review-disclosure";
import { checkMutationOrigin } from "@/lib/security/request-origin";
import { redactVoteTallies, visibleDecisions } from "@/lib/fabric/vote-visibility";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function enabled() {
  return process.env.FABRIC_MEDICAL_REVIEW_ENABLED === "true" && isMedicalChannel(loadFabricConfig().channelName);
}
type ReviewRole = "insurerAdmin" | "policyholder" | "auditor";
function reviewRole(role: Session["role"]): role is ReviewRole {
  return role === "insurerAdmin" || role === "policyholder" || role === "auditor";
}

async function readTimingState(claimId: string, showEscalation: boolean) {
  try {
    return await withFabricContract("insurerAdmin", async contract => {
      const decoder = new TextDecoder();
      const profile = JSON.parse(decoder.decode(await contract.evaluateTransaction("ReadMedicalTimingProfile"))).profile;
      if (profile !== "REAL" && profile !== "DEMO") return {};
      const deadline = showEscalation
        ? decoder.decode(await contract.evaluateTransaction("ReadMedicalClaimEscalationDeadline", claimId)) : "";
      return { activeTimingProfile: profile, escalationEligibleAt: deadline };
    });
  } catch {
    // Earlier definitions have no timing transactions. Their original windows still apply.
    return {};
  }
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
    const sealedAuditor = session.role === "auditor" && review?.ballotVersion === "panel-vote-v1";
    const [appeal, clarification, documents, grants, checks, decisions, facts, oracle, certificate, settlement, ledgerTime, revisionProof, issuedTerms, hospitalName, oracleV2, commitments, r2, timing] = await Promise.all([
      claim.currentAppealId ? ledger.readClaimAppeal(claim.currentAppealId) : null,
      claim.medicalClarificationId ? ledger.readMedicalClarification(session.role === "policyholder" ? session.role : "insurerAdmin", claim.medicalClarificationId) : null,
      Promise.all(claim.evidenceIds.map(id => ledger.readEvidenceReference(id))),
      review ? ledger.listEvidenceAccessGrants() : [],
      review ? ledger.listMedicalEvidenceChecks(review.id) : [],
      review ? ledger.listAuditorDecisions() : [],
      sealedAuditor ? (review.disclosureIssuedAt ? ledger.readMedicalReviewDisclosure(review.id, findDemoAccount(session.accountId)?.fabricUserName) : null)
        : ledger.readMedicalReviewFacts(claim.id),
      devLite && claim.currentOracleRequestId ? ledger.readOracleRequest(claim.currentOracleRequestId) : null,
      devLite && hasFinalMedicalApproval(claim) ? ledger.readMedicalApprovalCertificate(claim.id, claim.version) : null,
      devLite && claim.medicalSettlementId ? ledger.readSettlement(claim.medicalSettlementId) : null,
      devLite && session.role === "policyholder" && review?.status === "REJECTED" ? latestLedgerTimestamp().catch(() => null) : null,
      session.role === "auditor" && !sealedAuditor ? medicalRevisionProof(claim).catch(() => null) : null,
      issuedMedicalTerms(claim).catch(() => null),
      session.role === "auditor" ? medicalHospitalName(claim.hospitalId).catch(() => undefined) : undefined,
      devLite ? ledger.supportsMedicalOracleV2?.() : false,
      sealedAuditor ? ledger.listAuditorVoteCommitments(review.id) : [],
      devLite ? ledger.supportsMedicalR2?.() : false,
      devLite ? readTimingState(claim.id, session.role === "policyholder" && !review) : {},
    ]);
    const readAt = Date.now();
    const timeline = devLite ? buildMedicalTimeline({ claim,
      review: review?.medicalVersion === claim.version ? review : null,
      clarification, appeal, documents, grants, checks, readAt,
      oracle: oracle?.claimVersion === claim.version ? oracle : null,
      certificate, settlement: settlement?.approvalCertificateHash === certificate?.hash ? settlement : null,
    }) : undefined;
    return reply({ claim, review: review ? redactVoteTallies(review, session) : null, appeal, clarification, documents, facts, devLite, readAt, timeline, ledgerTime, revisionProof, issuedTerms, hospitalName, certificate,
      viewerSubjectId: session.role === "auditor" ? session.subjectId : undefined, r2, ...timing,
      sourcePublisher: devLite && process.env.FABRIC_MEDICAL_SOURCE_PUBLISHER === "true",
      viewerCommitment: commitments.find(record => record.auditorId === session.subjectId)?.commitment,
      oracleV2, oracle: oracle?.protocolVersion === "v2" && oracle.claimVersion === claim.version ? oracle : null,
      viewerHasVoted: session.role === "auditor" && decisions.some(decision => decision.reviewId === review?.id && decision.auditorId === session.subjectId),
      appealExplanation: appeal ? await ledger.readMedicalAppealExplanation(session.role === "policyholder" ? session.role : "insurerAdmin", appeal.id) : null,
      grants: grants.filter(grant => grant.medicalReviewId === review?.id && (session.role !== "auditor" || grant.granteeSubject === session.subjectId)),
      checks: checks.filter(check => session.role !== "auditor" || check.auditorId === session.subjectId),
      decisions: review ? visibleDecisions(decisions.filter(decision => decision.reviewId === review.id), [review], session) : [] });
  } catch {
    return reply({ message: "Medical case or current quote is unavailable" }, 409);
  }
}

const permissions = {
  prepare: "insurerAdmin", open: "insurerAdmin", recover: "insurerAdmin", expire: "insurerAdmin", ask: "insurerAdmin",
  share: "policyholder", appeal: "policyholder", escalate: "policyholder", confirm: "auditor", vote: "auditor",
  disclose: "insurerAdmin", acknowledge: "auditor", commitVote: "auditor", revealVote: "auditor", explainDuplicate: "policyholder",
} as const;

function allowed(action: MedicalReviewCommand, role: ReviewRole) {
  if (action.action === "oracleTimeout" || action.action === "expire") return true;
  if (action.action === "recordReceiptSummary") return role === "policyholder";
  if (action.action === "respond") return role === (action.response === "EXPIRED" ? "insurerAdmin" : "policyholder");
  if (action.action === "recordOCR") return role === "policyholder" || role === "auditor";
  if (action.action === "release") return role === "policyholder" || role === "insurerAdmin"; // Chaincode checks ownership and finality.
  if (action.action === "retire") return role === "policyholder" || role === "insurerAdmin";
  if (action.action === "replace") return true;
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
  if ((input.data.action === "escalate" || input.data.action === "release" || (input.data.action === "open" && session?.role === "auditor")) &&
      loadFabricConfig().channelName !== medicalDevLiteChannel) return reply({ message: "Action unavailable on this channel" }, 404);
  if (!session || !reviewRole(session.role) || !allowed(input.data, session.role)) return reply({ message: "This role cannot perform that action" }, 403);
  if ((input.data.action === "oracleTimeout" || input.data.action === "recordReceiptSummary" ||
      (input.data.action === "expire" && session.role !== "insurerAdmin")) && !await ledger.supportsMedicalOracleV2()) {
    return reply({ message: "Action unavailable on this deployment" }, 404);
  }
  try {
    const result = await ledger.medicalReviewAction(session.role, input.data, findDemoAccount(session.accountId)?.fabricUserName);
    if (input.data.action === "vote" || input.data.action === "revealVote") return reply({ result: { id: input.data.decisionId, reviewId: input.data.reviewId } });
    if (result && typeof result === "object" && "assetType" in result && result.assetType === "claimReview" && "status" in result && typeof result.status === "string") {
      return reply({ result: redactVoteTallies({ ...result, status: result.status }, session) });
    }
    return reply({ result });
  } catch (error) {
    withPeerReasons(error);
    const hasPrivateMessage = "message" in input.data && Boolean(input.data.message);
    return reply({ message: error instanceof Error && !hasPrivateMessage
      ? error.message.slice(0, 300) : "The action was not confirmed. Refresh the case before retrying." }, 409);
  }
}
