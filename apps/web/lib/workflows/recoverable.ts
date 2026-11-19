// Only commands whose response is their final ledger transaction's JSON result.
// Other workflows keep their existing authorization and reconciliation paths.
export const recoverableTransactions: Record<string, string> = {
  submitClaim: "SubmitInvoiceClaim",
  submitClaimAppeal: "SubmitClaimAppeal",
  openClaimReview: "OpenClaimReview",
  routeOracleFailureToReview: "RouteOracleFailureToReview",
  recordAuditorDecision: "RecordAuditorDecision",
  authorizeSettlement: "AuthorizeSettlement",
  confirmSettlement: "ConfirmSettlement",
  adjustBankAccountBalance: "AdjustBankAccountBalance",
  processPremiumCollection: "ProcessPremiumCollection",
  startClaimProcessing: "RequestOracleVerification",
  finalizeExpiredReview: "FinalizeExpiredReview",
  finalizeOracleTimeout: "FinalizeOracleTimeout",
};
