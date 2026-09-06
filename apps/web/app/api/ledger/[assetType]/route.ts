import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";

const assetTypeSchema = z.enum(["package", "policy", "claim", "evidence", "verification", "decision", "review", "appeal", "fraud-assessment", "settlement", "access", "account", "mandate", "premium-payment", "premium-adjustment", "collection", "benefit-plan", "beneficiaries", "benefit-request", "liability"]);
type RouteContext = { params: Promise<{ assetType: string }> };

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });

  const assetType = assetTypeSchema.safeParse((await context.params).assetType);
  if (!assetType.success) return NextResponse.json({ message: "Invalid asset collection" }, { status: 400 });

  try {
    let result: unknown[];
    switch (assetType.data) {
      case "package":
        result = await ledger.listPolicyPackages();
        break;
      case "policy": {
        const policies = await ledger.listPolicies();
        result = session.role === "policyholder"
          ? policies.filter((policy) => policy.policyholderId === session.subjectId)
          : policies;
        break;
      }
      case "claim": {
        const claims = await ledger.listClaims();
        result = session.role === "policyholder"
          ? claims.filter((claim) => claim.claimantId === session.subjectId)
          : claims;
        break;
      }
      case "evidence": {
        const evidence = await ledger.listEvidenceReferences();
        result = session.role === "policyholder"
          ? evidence.filter((item) => item.submittedBy === session.subjectId)
          : evidence;
        break;
      }
      case "verification": {
        const verifications = await ledger.listHospitalVerifications();
        if (session.role !== "policyholder") {
          result = verifications;
          break;
        }
        const ownedClaimIds = new Set(
          (await ledger.listClaims())
            .filter((claim) => claim.claimantId === session.subjectId)
            .map((claim) => claim.id),
        );
        result = verifications.filter((item) => ownedClaimIds.has(item.claimId));
        break;
      }
      case "decision": {
        const decisions = await ledger.listAuditorDecisions();
        if (session.role !== "policyholder") {
          result = decisions;
          break;
        }
        const ownedClaimIds = new Set(
          (await ledger.listClaims())
            .filter((claim) => claim.claimantId === session.subjectId)
            .map((claim) => claim.id),
        );
        result = decisions.filter((item) => ownedClaimIds.has(item.claimId));
        break;
      }
      case "review": {
        const reviews = await ledger.listClaimReviews();
        if (session.role === "auditor") {
          result = reviews.filter((item) => item.assignedAuditorIds.includes(session.subjectId ?? ""));
          break;
        }
        if (session.role !== "policyholder") { result = reviews; break; }
        const ownedClaimIds = new Set((await ledger.listClaims()).filter((claim) => claim.claimantId === session.subjectId).map((claim) => claim.id));
        result = reviews.filter((item) => ownedClaimIds.has(item.claimId));
        break;
      }
      case "appeal": {
        const appeals = await ledger.listClaimAppeals();
        result = session.role === "policyholder" ? appeals.filter((item) => item.claimantId === session.subjectId) : appeals;
        break;
      }
      case "fraud-assessment": {
        const assessments = await ledger.listFraudAssessments();
        if (session.role !== "policyholder") { result = assessments; break; }
        const ownedClaimIds = new Set((await ledger.listClaims()).filter((claim) => claim.claimantId === session.subjectId).map((claim) => claim.id));
        result = assessments.filter((item) => ownedClaimIds.has(item.claimId));
        break;
      }
      case "settlement": {
        const settlements = await ledger.listSettlements();
        if (session.role !== "policyholder") {
          result = settlements;
          break;
        }
        const ownedClaimIds = new Set(
          (await ledger.listClaims())
            .filter((claim) => claim.claimantId === session.subjectId)
            .map((claim) => claim.id),
        );
        result = settlements.filter((settlement) => ownedClaimIds.has(settlement.claimId));
        break;
      }
      case "access":
        if (session.role !== "insurerAdmin" && session.role !== "auditor") {
          return NextResponse.json({ message: "This account cannot inspect evidence access logs" }, { status: 403 });
        }
        result = await ledger.listEvidenceAccessRecords();
        break;
      case "account": {
        const accounts = await ledger.listBankAccountReferences();
        result = session.role === "policyholder" ? accounts.filter((item) => item.ownerId === session.subjectId) : accounts;
        break;
      }
      case "mandate": {
        const mandates = await ledger.listBankMandates();
        result = session.role === "policyholder" ? mandates.filter((item) => item.ownerId === session.subjectId) : mandates;
        break;
      }
      case "premium-payment": {
        const payments = await ledger.listPremiumPayments();
        if (session.role !== "policyholder") { result = payments; break; }
        const ownedPolicyIds = new Set((await ledger.listPolicies()).filter((item) => item.policyholderId === session.subjectId).map((item) => item.id));
        result = payments.filter((item) => ownedPolicyIds.has(item.policyId));
        break;
      }
      case "premium-adjustment": {
        const adjustments = await ledger.listPremiumAdjustments();
        if (session.role !== "policyholder") { result = adjustments; break; }
        const ownedPolicyIds = new Set((await ledger.listPolicies()).filter((item) => item.policyholderId === session.subjectId).map((item) => item.id));
        result = adjustments.filter((item) => ownedPolicyIds.has(item.policyId));
        break;
      }
      case "collection": {
        const collections = await ledger.listPremiumCollections();
        if (session.role !== "policyholder") { result = collections; break; }
        const ownedPolicyIds = new Set((await ledger.listPolicies()).filter((item) => item.policyholderId === session.subjectId).map((item) => item.id));
        result = collections.filter((item) => ownedPolicyIds.has(item.policyId));
        break;
      }
      case "benefit-plan":
        result = await ledger.listBenefitPlans();
        break;
      case "beneficiaries": {
        const designations = await ledger.listBeneficiaryDesignations();
        result = session.role === "policyholder" ? designations.filter((item) => item.ownerId === session.subjectId) : designations;
        break;
      }
      case "benefit-request": {
        const benefits = await ledger.listBenefitRequests();
        result = session.role === "policyholder" ? benefits.filter((item) => item.requesterId === session.subjectId) : benefits;
        break;
      }
      case "liability": {
        const liabilities = await ledger.listLiabilities();
        if (session.role !== "policyholder") { result = liabilities; break; }
        const ownedPolicyIds = new Set((await ledger.listPolicies()).filter((item) => item.policyholderId === session.subjectId).map((item) => item.id));
        result = liabilities.filter((item) => ownedPolicyIds.has(item.policyId));
        break;
      }
    }
    return NextResponse.json({ result });
  } catch (error) {
    console.error("Ledger collection query failed", error);
    return NextResponse.json({ message: "Ledger collection query failed" }, { status: 502 });
  }
}
