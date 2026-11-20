const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;

export function parseSigningRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).length !== 3 ||
      typeof input.settlementId !== "string" || !idPattern.test(input.settlementId) ||
      typeof input.transferId !== "string" || !idPattern.test(input.transferId) ||
      typeof input.bankReferenceHash !== "string" || !hashPattern.test(input.bankReferenceHash)) {
    throw new Error("Expected a settlement ID, transfer ID, and lowercase SHA-256 bank reference hash.");
  }
  return { settlementId: input.settlementId, transferId: input.transferId, bankReferenceHash: input.bankReferenceHash };
}

export async function readConfirmation(evaluate, request) {
  const settlement = await evaluate("ReadSettlement", request.settlementId);
  if (settlement.id !== request.settlementId || !["AUTHORIZED", "PAYMENT_FAILED"].includes(settlement.status) ||
      !Number.isSafeInteger(settlement.amountMinor) || settlement.amountMinor <= 0 ||
      !hashPattern.test(settlement.approvalCertificateHash)) {
    throw new Error("An open medical settlement with a certificate and valid amount is required.");
  }
  const claim = await evaluate("ReadClaim", settlement.claimId);
  if (claim.id !== settlement.claimId || claim.medicalSettlementId !== settlement.id ||
      claim.status !== "SETTLEMENT_AUTHORIZED" || !Number.isSafeInteger(claim.version) || claim.version < 1 ||
      claim.amountMinor !== settlement.amountMinor) {
    throw new Error("Current claim does not match the settlement.");
  }
  const certificate = await evaluate("ReadMedicalApprovalCertificate", claim.id, String(claim.version));
  if (certificate.claimId !== claim.id || certificate.claimVersion !== claim.version ||
      certificate.amountMinor !== settlement.amountMinor || certificate.currency !== settlement.currency ||
      certificate.hash !== settlement.approvalCertificateHash) {
    throw new Error("Current approval certificate does not match the settlement.");
  }
  return {
    settlementId: settlement.id, claimId: claim.id, claimVersion: claim.version,
    amountMinor: settlement.amountMinor, currency: settlement.currency, certificateHash: certificate.hash,
    sourceAccountId: settlement.sourceAccountId, destinationAccountId: settlement.destinationAccountId,
    settlementStatus: settlement.status, transferId: request.transferId, bankReferenceHash: request.bankReferenceHash,
  };
}

export async function confirmWithApproval({ request, evaluate, approve, submit }) {
  const reviewed = await readConfirmation(evaluate, request);
  if (!await approve(reviewed)) throw new Error("Operator approval was declined.");
  const current = await readConfirmation(evaluate, request);
  if (JSON.stringify(current) !== JSON.stringify(reviewed)) {
    throw new Error("Settlement changed after display. Request a new approval.");
  }
  return submit(request, reviewed);
}
