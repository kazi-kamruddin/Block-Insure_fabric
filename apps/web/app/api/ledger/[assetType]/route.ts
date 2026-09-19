import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { findDemoAccount } from "@/lib/auth/accounts";
import { ledger } from "@/lib/fabric/ledger";

const assetTypeSchema = z.enum(["partner-agreement", "hospital-invoice", "package", "policy", "claim", "evidence", "evidence-batch", "evidence-grant", "verification", "decision", "review", "appeal", "fraud-assessment", "settlement", "access", "account", "bank-transfer", "mandate", "premium-payment", "premium-adjustment", "collection", "benefit-plan", "beneficiaries", "benefit-request", "liability", "oracle-snapshot", "oracle-request", "oracle-commitment", "oracle-result"]);
type RouteContext = { params: Promise<{ assetType: string }> };

export const runtime = "nodejs";

const bankAssetTypes = new Set(["partner-agreement", "account", "bank-transfer", "mandate", "premium-payment", "premium-adjustment", "collection", "liability", "settlement"]);

export async function GET(_request: Request, context: RouteContext) {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });

  const assetType = assetTypeSchema.safeParse((await context.params).assetType);
  if (!assetType.success) return NextResponse.json({ message: "Invalid asset collection" }, { status: 400 });
  if (session.role === "hospitalOfficer" && !["partner-agreement", "hospital-invoice", "package"].includes(assetType.data)) {
    return NextResponse.json({ message: "The independent Hospital portal exposes only its agreement, invoices, and public package network" }, { status: 403 });
  }
  if (session.role === "bankOfficer" && !bankAssetTypes.has(assetType.data)) {
    return NextResponse.json({ message: "The independent Bank portal exposes only contracted banking, payment, and settlement records" }, { status: 403 });
  }

  try {
    const visibleClaimIds = async () => {
      if (session.role !== "policyholder" && session.role !== "hospitalOfficer") return null;
      const claims = await ledger.listClaims();
      return new Set(claims.filter((claim) => session.role === "policyholder"
        ? claim.claimantId === session.subjectId
        : claim.hospitalId === session.subjectId).map((claim) => claim.id));
    };
    let result: unknown[];
    switch (assetType.data) {
      case "partner-agreement": {
        const agreements = await ledger.listPartnerAgreements();
        result = session.role === "hospitalOfficer"
          ? agreements.filter((item) => item.partnerType === "HOSPITAL" && item.partnerId === session.subjectId)
          : session.role === "bankOfficer"
            ? agreements.filter((item) => item.partnerType === "BANK" && item.partnerId === session.subjectId)
          : agreements;
        break;
      }
      case "hospital-invoice": {
        if (session.role !== "hospitalOfficer" && session.role !== "insurerAdmin") {
          return NextResponse.json({ message: "Hospital invoices are restricted to their owner and the contracted insurer" }, { status: 403 });
        }
        const invoices = await ledger.listHospitalInvoices();
        result = session.role === "hospitalOfficer" ? invoices.filter((item) => item.hospitalId === session.subjectId) : invoices;
        break;
      }
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
          : session.role === "hospitalOfficer"
            ? claims.filter((claim) => claim.hospitalId === session.subjectId)
            : claims;
        break;
      }
      case "oracle-snapshot":
        result = await ledger.listOracleRegistrySnapshots();
        break;
      case "oracle-request": {
        const requests = await ledger.listOracleRequests();
        const claimIds = await visibleClaimIds();
        result = claimIds ? requests.filter((item) => claimIds.has(item.claimId)) : requests;
        break;
      }
      case "oracle-commitment": {
        const commitments = await ledger.listOracleCommitments();
        const claimIds = await visibleClaimIds();
        result = claimIds ? commitments.filter((item) => claimIds.has(item.claimId)) : commitments;
        break;
      }
      case "oracle-result": {
        const results = await ledger.listOracleResults();
        const claimIds = await visibleClaimIds();
        result = claimIds ? results.filter((item) => claimIds.has(item.claimId)) : results;
        break;
      }
      case "evidence": {
        const evidence = await ledger.listEvidenceReferences();
        const claimIds = await visibleClaimIds();
        result = claimIds ? evidence.filter((item) => claimIds.has(item.claimId)) : evidence;
        break;
      }
      case "evidence-batch": {
        const batches = await ledger.listEvidenceMerkleBatches();
        if (session.role !== "policyholder") {
          result = batches;
          break;
        }
        const ownedClaimIds = await visibleClaimIds();
        const visibleEvidenceIds = new Set((await ledger.listEvidenceReferences())
          .filter((item) => ownedClaimIds?.has(item.claimId))
          .map((item) => item.id));
        result = batches
          .filter((batch) => batch.evidenceIds.some((id) => visibleEvidenceIds.has(id)))
          .map((batch) => ({ ...batch, evidenceIds: batch.evidenceIds.filter((id) => visibleEvidenceIds.has(id)) }));
        break;
      }
      case "evidence-grant": {
        const grants = await ledger.listEvidenceAccessGrants();
        const account = findDemoAccount(session.accountId);
        if (session.role === "insurerAdmin") result = grants;
        else if (session.role === "policyholder") result = grants.filter((item) => item.ownerId === session.subjectId);
        else if (!account) result = [];
        else result = grants.filter((item) => item.granteeMsp === account.organization && item.granteeRole === session.role && (item.granteeSubject === "*" || item.granteeSubject === session.subjectId));
        break;
      }
      case "verification": {
        const verifications = await ledger.listHospitalVerifications();
        if (session.role === "hospitalOfficer") {
          result = verifications.filter((item) => item.hospitalIdentity === session.subjectId);
          break;
        }
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
        const claimIds = await visibleClaimIds();
        result = claimIds ? decisions.filter((item) => claimIds.has(item.claimId)) : decisions;
        break;
      }
      case "review": {
        const reviews = await ledger.listClaimReviews();
        if (session.role === "auditor") {
          result = reviews.filter((item) => item.assignedAuditorIds.includes(session.subjectId ?? ""));
          break;
        }
        const claimIds = await visibleClaimIds();
        result = claimIds ? reviews.filter((item) => claimIds.has(item.claimId)) : reviews;
        break;
      }
      case "appeal": {
        const appeals = await ledger.listClaimAppeals();
        if (session.role === "policyholder") result = appeals.filter((item) => item.claimantId === session.subjectId);
        else if (session.role === "hospitalOfficer") {
          const assignedClaimIds = new Set((await ledger.listClaims()).filter((claim) => claim.hospitalId === session.subjectId).map((claim) => claim.id));
          result = appeals.filter((item) => assignedClaimIds.has(item.claimId));
        } else result = appeals;
        break;
      }
      case "fraud-assessment": {
        const assessments = await ledger.listFraudAssessments();
        const claimIds = await visibleClaimIds();
        result = claimIds ? assessments.filter((item) => claimIds.has(item.claimId)) : assessments;
        break;
      }
      case "settlement": {
        const settlements = await ledger.listSettlements();
        const claimIds = await visibleClaimIds();
        result = claimIds ? settlements.filter((settlement) => claimIds.has(settlement.claimId)) : settlements;
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
      case "bank-transfer": {
        const transfers = await ledger.listBankTransfers();
        if (session.role !== "policyholder") { result = transfers; break; }
        const ownedPolicyIds = new Set((await ledger.listPolicies()).filter((item) => item.policyholderId === session.subjectId).map((item) => item.id));
        result = transfers.filter((item) => ownedPolicyIds.has(item.policyId));
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
