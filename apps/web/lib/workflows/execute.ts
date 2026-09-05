import "server-only";

import { ledger } from "@/lib/fabric/ledger";
import type { WorkflowCommand } from "./commands";

export function executeWorkflowCommand(command: WorkflowCommand) {
  switch (command.operation) {
    case "createPolicyPackage":
      return ledger.createPolicyPackage(command);
    case "publishPolicyPackage":
      return ledger.publishPolicyPackage(command.id);
    case "issuePolicy":
      return ledger.issuePolicy(command);
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
