import type { Contract } from "@hyperledger/fabric-gateway";
import type { Claim, ClaimHistoryRecord, MedicalApprovalCertificate, OracleRequest, OracleResult } from "@/lib/fabric/types";

type DossierLedgerEvidence = {
  oracleReveals: { resultId: string; requestId: string; oracleId: string; txId: string; salt: string }[];
  certificateWrite: {
    transactionId: string; issuedAt: string; blockNumber: number; blockHash: string; approvalTimeLabel: string;
  } | null;
  auditSampling: { requestId: string; period: unknown; selection: unknown }[];
  payoutBreakdown: {
    inputs: Record<string, string | number>; values: Record<string, number>;
    statementHash: string; statementVersion: number; breakdownHash: string;
  } | null;
};

export function readDossierLedgerEvidence(connection: {
  contract: Contract; qscc: Contract; channel: string; chaincode: string;
}, inputs: {
  claim: Claim; history: ClaimHistoryRecord[]; oracleRequests: OracleRequest[]; oracleResults: OracleResult[];
  approvalCertificate: MedicalApprovalCertificate | null;
}): Promise<DossierLedgerEvidence>;
