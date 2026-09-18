import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import { findDemoAccount } from "@/lib/auth/accounts";
import type { Session } from "@/lib/auth/session-token";
import { assessClaimFraud } from "@/lib/fraud/assess-claim";
import type { WorkflowCommand } from "./commands";

export async function executeWorkflowCommand(command: WorkflowCommand, session: Session) {
  switch (command.operation) {
    case "createPartnerAgreement":
      return ledger.createPartnerAgreement(command);
    case "setPartnerAgreementStatus":
      return ledger.setPartnerAgreementStatus(command.id, command.status);
    case "createPolicyPackage":
      return ledger.createPolicyPackage(command);
    case "configurePolicyPackagePartners":
      return ledger.configurePolicyPackagePartners(command.id, command.hospitalIdsJson, command.bankIdsJson);
    case "publishPolicyPackage":
      return ledger.publishPolicyPackage(command.id);
    case "retirePolicyPackage":
      return ledger.retirePolicyPackage(command.id);
    case "createBenefitPlan":
      return ledger.createBenefitPlan(command);
    case "publishBenefitPlan":
      return ledger.publishBenefitPlan(command.id);
    case "retireBenefitPlan":
      return ledger.retireBenefitPlan(command.id);
    case "issuePolicy":
      return ledger.issuePolicy(command);
    case "acquirePolicy":
      return ledger.acquirePolicy(command);
    case "advancePolicyLifecycle":
      return ledger.advancePolicyLifecycle(command.id, command.asOfDate);
    case "cancelPolicy":
      return ledger.cancelPolicy(command.id, command.reasonHash, "policyholder");
    case "cancelPolicyAsInsurer":
      return ledger.cancelPolicy(command.id, command.reasonHash, "insurerAdmin");
    case "renewPolicy":
      return ledger.renewPolicy(command.newId, command.existingId, command.newEndDate);
    case "openBankAccount":
      return ledger.openBankAccount(command);
    case "adjustBankAccountBalance":
      return ledger.adjustBankAccountBalance(command);
    case "requestBankMandate":
      return ledger.requestBankMandate(command);
    case "reviewBankMandate":
      return ledger.reviewBankMandate(command.id, command.outcome, command.decisionHash);
    case "cancelBankMandate":
      return ledger.cancelBankMandate(command.id);
    case "expireBankMandate":
      return ledger.expireBankMandate(command.id, command.asOfDate);
    case "recordPremiumAdjustment":
      return ledger.recordPremiumAdjustment(command);
    case "queuePremiumCollection":
      return ledger.queuePremiumCollection(command.id, command.mandateId, command.dueDate);
    case "processPremiumCollection":
      return ledger.processPremiumCollection(command);
    case "setBeneficiaries":
      return ledger.setBeneficiaries(command.policyId, command.allocationsJson);
    case "submitBenefitRequest":
      return ledger.submitBenefitRequest(command);
    case "decideBenefitRequest":
      return ledger.decideBenefitRequest(command.id, command.outcome, command.decisionHash);
    case "markBenefitPaymentReady":
      return ledger.markBenefitPaymentReady(command.id, command.fundingReferenceHash);
    case "confirmBenefitPayment":
      return ledger.confirmBenefitPayment(command.id, command.bankReferenceHash);
    case "createHospitalInvoice":
      return ledger.createHospitalInvoice(command, findDemoAccount(session.accountId)?.fabricUserName);
    case "updateHospitalInvoice":
      return ledger.updateHospitalInvoice(command, findDemoAccount(session.accountId)?.fabricUserName);
    case "submitClaim":
      return ledger.submitClaim(command);
    case "crossCheckClaimInvoice":
      return ledger.crossCheckClaimInvoice(command.claimId, command.verificationId);
    case "openClaimReview":
      return ledger.openClaimReview(command);
    case "publishOracleRegistrySnapshot":
      return ledger.publishOracleRegistrySnapshot(command);
    case "requestOracleVerification":
      return ledger.requestOracleVerification(command);
    case "finalizeOracleTimeout":
      return ledger.finalizeOracleTimeout(command.requestId);
    case "routeOracleFailureToReview":
      return ledger.routeOracleFailureToReview(command);
    case "submitClaimAppeal":
      return ledger.submitClaimAppeal(command);
    case "grantEvidenceAccess":
      return ledger.grantEvidenceAccess(command);
    case "revokeEvidenceAccess":
      return ledger.revokeEvidenceAccess(command.grantId);
    case "openAppealReview":
      return ledger.openAppealReview(command);
    case "finalizeExpiredReview":
      return ledger.finalizeExpiredReview(command.reviewId);
    case "assessClaimFraud": {
      const assessment = await assessClaimFraud(command.claimId);
      return ledger.recordFraudAssessment({ id: command.assessmentId, claimId: command.claimId, ...assessment });
    }
    case "recordAuditorDecision":
      return ledger.recordAuditorDecision(command, findDemoAccount(session.accountId)?.fabricUserName);
    case "authorizeSettlement":
      return ledger.authorizeSettlement(command.settlementId, command.claimId);
    case "confirmSettlement":
      return ledger.confirmSettlement(command.settlementId, command.bankReferenceHash);
  }
}
