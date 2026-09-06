import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import type { WorkflowCommand } from "./commands";

export function executeWorkflowCommand(command: WorkflowCommand) {
  switch (command.operation) {
    case "createPolicyPackage":
      return ledger.createPolicyPackage(command);
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
    case "registerBankAccountReference":
      return ledger.registerBankAccountReference(command);
    case "requestBankMandate":
      return ledger.requestBankMandate(command);
    case "reviewBankMandate":
      return ledger.reviewBankMandate(command.id, command.outcome, command.decisionHash);
    case "cancelBankMandate":
      return ledger.cancelBankMandate(command.id);
    case "expireBankMandate":
      return ledger.expireBankMandate(command.id, command.asOfDate);
    case "recordPremiumPayment":
      return ledger.recordPremiumPayment(command);
    case "recordPremiumAdjustment":
      return ledger.recordPremiumAdjustment(command);
    case "queuePremiumCollection":
      return ledger.queuePremiumCollection(command.id, command.mandateId, command.dueDate);
    case "completePremiumCollection":
      return ledger.completePremiumCollection(command.collectionId, command.paymentId, command.periodEndDate, command.externalReferenceHash);
    case "failPremiumCollection":
      return ledger.failPremiumCollection(command.collectionId, command.failureHash);
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
    case "submitClaim":
      return ledger.submitClaim(command);
    case "verifyClaim":
      return ledger.verifyClaim(command);
    case "startClaimReview":
      return ledger.startClaimReview(command.claimId);
    case "recordAuditorDecision":
      return ledger.recordAuditorDecision(command);
    case "authorizeSettlement":
      return ledger.authorizeSettlement(command.settlementId, command.claimId);
    case "confirmSettlement":
      return ledger.confirmSettlement(command.settlementId, command.bankReferenceHash);
  }
}
