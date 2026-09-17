import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { findDemoAccount } from "@/lib/auth/accounts";
import { ledger } from "@/lib/fabric/ledger";

const routeSchema = z.object({
  assetType: z.enum(["partner-agreement", "hospital-invoice", "package", "policy", "claim", "evidence", "evidence-grant", "verification", "decision", "review", "appeal", "fraud-assessment", "settlement", "claim-history", "account", "mandate", "premium-payment", "premium-adjustment", "collection", "benefit-plan", "beneficiaries", "benefit-request", "liability", "oracle-snapshot", "oracle-request", "oracle-commitment", "oracle-result", "oracle-history"]),
  id: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/),
});

type RouteContext = { params: Promise<{ assetType: string; id: string }> };

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });

  const parsed = routeSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ message: "Invalid asset query" }, { status: 400 });
  if (session.role === "hospitalOfficer" && !["partner-agreement", "hospital-invoice", "package"].includes(parsed.data.assetType)) {
    return NextResponse.json({ message: "The independent Hospital portal exposes only its agreement, invoices, and public package network" }, { status: 403 });
  }

  try {
    const { assetType, id } = parsed.data;
    const hospitalOwnsClaim = async (claimId: string) => session.role !== "hospitalOfficer"
      || (await ledger.readClaim(claimId)).hospitalId === session.subjectId;
    let result: unknown;
    switch (assetType) {
      case "partner-agreement": {
        const agreement = await ledger.readPartnerAgreement(id);
        if (session.role === "hospitalOfficer" && (agreement.partnerType !== "HOSPITAL" || agreement.partnerId !== session.subjectId)) {
          return NextResponse.json({ message: "Agreement belongs to another partner" }, { status: 403 });
        }
        result = agreement;
        break;
      }
      case "hospital-invoice": {
        if (session.role !== "hospitalOfficer" && session.role !== "insurerAdmin") {
          return NextResponse.json({ message: "Hospital invoices are restricted to their owner and the contracted insurer" }, { status: 403 });
        }
        const invoice = await ledger.readHospitalInvoice(id);
        if (session.role === "hospitalOfficer" && invoice.hospitalId !== session.subjectId) {
          return NextResponse.json({ message: "Invoice belongs to another Hospital" }, { status: 403 });
        }
        result = invoice;
        break;
      }
      case "package":
        result = await ledger.readPolicyPackage(id);
        break;
      case "policy": {
        const policy = await ledger.readPolicy(id);
        result = policy;
        if (session.role === "policyholder" && policy.policyholderId !== session.subjectId) {
          return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        }
        break;
      }
      case "claim": {
        const claim = await ledger.readClaim(id);
        result = claim;
        if (session.role === "policyholder" && claim.claimantId !== session.subjectId) {
          return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        }
        if (session.role === "hospitalOfficer" && claim.hospitalId !== session.subjectId) {
          return NextResponse.json({ message: "Claim is assigned to another hospital" }, { status: 403 });
        }
        break;
      }
      case "oracle-snapshot":
        result = await ledger.readOracleRegistrySnapshot(id);
        break;
      case "oracle-request": {
        const item = await ledger.readOracleRequest(id);
        if (session.role === "policyholder" && (await ledger.readClaim(item.claimId)).claimantId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        if (!(await hospitalOwnsClaim(item.claimId))) return NextResponse.json({ message: "Claim is assigned to another hospital" }, { status: 403 });
        result = item;
        break;
      }
      case "oracle-commitment": {
        const item = await ledger.readOracleCommitment(id);
        if (session.role === "policyholder" && (await ledger.readClaim(item.claimId)).claimantId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        if (!(await hospitalOwnsClaim(item.claimId))) return NextResponse.json({ message: "Claim is assigned to another hospital" }, { status: 403 });
        result = item;
        break;
      }
      case "oracle-result": {
        const item = await ledger.readOracleResult(id);
        if (session.role === "policyholder" && (await ledger.readClaim(item.claimId)).claimantId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        if (!(await hospitalOwnsClaim(item.claimId))) return NextResponse.json({ message: "Claim is assigned to another hospital" }, { status: 403 });
        result = item;
        break;
      }
      case "oracle-history": {
        const item = await ledger.readOracleRequest(id);
        if (session.role === "policyholder" && (await ledger.readClaim(item.claimId)).claimantId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        if (!(await hospitalOwnsClaim(item.claimId))) return NextResponse.json({ message: "Claim is assigned to another hospital" }, { status: 403 });
        result = await ledger.oracleRequestHistory(id);
        break;
      }
      case "evidence": {
        const evidence = await ledger.readEvidenceReference(id);
        result = evidence;
        if (!(await hospitalOwnsClaim(evidence.claimId))) return NextResponse.json({ message: "Claim is assigned to another hospital" }, { status: 403 });
        if (session.role === "policyholder") {
          const claim = await ledger.readClaim(evidence.claimId);
          if (claim.claimantId !== session.subjectId) {
            return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
          }
        }
        break;
      }
      case "evidence-grant": {
        const grant = await ledger.readEvidenceAccessGrant(id);
        const account = findDemoAccount(session.accountId);
        const visible = session.role === "insurerAdmin" ||
          (session.role === "policyholder" && grant.ownerId === session.subjectId) ||
          Boolean(account && grant.granteeMsp === account.organization && grant.granteeRole === session.role && (grant.granteeSubject === "*" || grant.granteeSubject === session.subjectId));
        if (!visible) return NextResponse.json({ message: "Grant is not visible to this account" }, { status: 403 });
        result = grant;
        break;
      }
      case "verification": {
        const verification = await ledger.readHospitalVerification(id);
        result = verification;
        if (session.role === "hospitalOfficer" && verification.hospitalIdentity !== session.subjectId) {
          return NextResponse.json({ message: "Verification belongs to another hospital" }, { status: 403 });
        }
        if (session.role === "policyholder") {
          const claim = await ledger.readClaim(verification.claimId);
          if (claim.claimantId !== session.subjectId) {
            return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
          }
        }
        break;
      }
      case "decision": {
        const decision = await ledger.readAuditorDecision(id);
        result = decision;
        if (!(await hospitalOwnsClaim(decision.claimId))) return NextResponse.json({ message: "Claim is assigned to another hospital" }, { status: 403 });
        if (session.role === "policyholder") {
          const claim = await ledger.readClaim(decision.claimId);
          if (claim.claimantId !== session.subjectId) {
            return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
          }
        }
        break;
      }
      case "review": {
        const review = await ledger.readClaimReview(id);
        if (session.role === "auditor" && !review.assignedAuditorIds.includes(session.subjectId ?? "")) return NextResponse.json({ message: "Review is not assigned to this auditor" }, { status: 403 });
        if (session.role === "policyholder" && (await ledger.readClaim(review.claimId)).claimantId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        if (!(await hospitalOwnsClaim(review.claimId))) return NextResponse.json({ message: "Claim is assigned to another hospital" }, { status: 403 });
        result = review;
        break;
      }
      case "appeal": {
        const appeal = await ledger.readClaimAppeal(id);
        if (session.role === "policyholder" && appeal.claimantId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        if (session.role === "hospitalOfficer" && (await ledger.readClaim(appeal.claimId)).hospitalId !== session.subjectId) return NextResponse.json({ message: "Appeal is assigned to another hospital" }, { status: 403 });
        result = appeal;
        break;
      }
      case "fraud-assessment": {
        const assessment = await ledger.readFraudAssessment(id);
        if (session.role === "policyholder" && (await ledger.readClaim(assessment.claimId)).claimantId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        if (!(await hospitalOwnsClaim(assessment.claimId))) return NextResponse.json({ message: "Claim is assigned to another hospital" }, { status: 403 });
        result = assessment;
        break;
      }
      case "settlement": {
        const settlement = await ledger.readSettlement(id);
        result = settlement;
        if (!(await hospitalOwnsClaim(settlement.claimId))) return NextResponse.json({ message: "Claim is assigned to another hospital" }, { status: 403 });
        if (session.role === "policyholder") {
          const claim = await ledger.readClaim(settlement.claimId);
          if (claim.claimantId !== session.subjectId) {
            return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
          }
        }
        break;
      }
      case "claim-history": {
        if (!(await hospitalOwnsClaim(id))) return NextResponse.json({ message: "Claim is assigned to another hospital" }, { status: 403 });
        if (session.role === "policyholder") {
          const claim = await ledger.readClaim(id);
          if (claim.claimantId !== session.subjectId) {
            return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
          }
        }
        result = await ledger.claimHistory(id);
        break;
      }
      case "account": {
        const account = await ledger.readBankAccountReference(id);
        if (session.role === "policyholder" && account.ownerId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        result = account;
        break;
      }
      case "mandate": {
        const mandate = await ledger.readBankMandate(id);
        if (session.role === "policyholder" && mandate.ownerId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        result = mandate;
        break;
      }
      case "premium-payment": {
        const payment = await ledger.readPremiumPayment(id);
        if (session.role === "policyholder" && (await ledger.readPolicy(payment.policyId)).policyholderId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        result = payment;
        break;
      }
      case "premium-adjustment": {
        const adjustment = await ledger.readPremiumAdjustment(id);
        if (session.role === "policyholder" && (await ledger.readPolicy(adjustment.policyId)).policyholderId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        result = adjustment;
        break;
      }
      case "collection": {
        const collection = await ledger.readPremiumCollection(id);
        if (session.role === "policyholder" && (await ledger.readPolicy(collection.policyId)).policyholderId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        result = collection;
        break;
      }
      case "benefit-plan":
        result = await ledger.readBenefitPlan(id);
        break;
      case "beneficiaries": {
        const designation = await ledger.readBeneficiaryDesignation(id);
        if (session.role === "policyholder" && designation.ownerId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        result = designation;
        break;
      }
      case "benefit-request": {
        const benefit = await ledger.readBenefitRequest(id);
        if (session.role === "policyholder" && benefit.requesterId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        result = benefit;
        break;
      }
      case "liability": {
        const liability = await ledger.readLiability(id);
        if (session.role === "policyholder" && (await ledger.readPolicy(liability.policyId)).policyholderId !== session.subjectId) return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        result = liability;
        break;
      }
    }

    return NextResponse.json({ result });
  } catch (error) {
    console.error("Ledger query failed", error);
    return NextResponse.json(
      { message: "Ledger asset was not found or is unavailable" },
      { status: 404 },
    );
  }
}
