export type IndexedFabricEvent = {
  id: string;
  blockNumber: string;
  transactionId: string;
  eventName: string;
  payload: Record<string, unknown>;
};

export type OperationalNotification = {
  id: string;
  eventId: string;
  recipientRole: string;
  recipientSubject: string;
  title: string;
  message: string;
  assetId: string;
  blockNumber: string;
};

export type BankCommunication = {
  id: string;
  eventId: string;
  recipientSubject: string;
  policyId: string;
  template: "bank-transaction-status" | "bank-mandate-status" | "bank-benefit-payment";
  title: string;
  assetId: string;
  amountMinor: number;
  currency: string;
  status: "PENDING" | "DELIVERED" | "DEMO" | "FAILED";
  adapter: "" | "demo" | "email-gateway";
  recipient: string;
  messageId: string;
  error: string;
  createdAt: string;
  deliveredAt: string;
  variables: Record<string, string | number | boolean>;
};

export type EventProjection = {
  schemaVersion: 2;
  updatedAt: string;
  checkpoint: { blockNumber: string; transactionId: string } | null;
  events: IndexedFabricEvent[];
  countsByName: Record<string, number>;
  notifications: OperationalNotification[];
  communications: BankCommunication[];
};

export const emptyEventProjection = (): EventProjection => ({
  schemaVersion: 2,
  updatedAt: "",
  checkpoint: null,
  events: [],
  countsByName: {},
  notifications: [],
  communications: [],
});

const text = (payload: Record<string, unknown>, key: string) => typeof payload[key] === "string" ? payload[key] : "";

function notificationTargets(event: IndexedFabricEvent) {
  const p = event.payload;
  switch (event.eventName) {
    case "HospitalInvoiceCreated": return [{ role: "insurerAdmin", subject: "", title: "Contracted Hospital invoice added", asset: text(p, "id") }];
    case "HospitalInvoiceUpdated": return [{ role: "insurerAdmin", subject: "", title: "Contracted Hospital invoice updated", asset: text(p, "id") }];
    case "PartnerAgreementStatusChanged": return [{ role: "insurerAdmin", subject: "", title: "Partner agreement status changed", asset: text(p, "id") }];
    case "ClaimSubmitted": return [{ role: "insurerAdmin", subject: "", title: "Claim submitted", asset: text(p, "id") }];
    case "ClaimHospitalVerified": return [
      { role: "insurerAdmin", subject: "", title: "Hospital invoice cross-check recorded", asset: text(p, "claimId") },
      { role: "policyholder", subject: "", title: "Hospital invoice cross-check recorded", asset: text(p, "claimId") },
    ];
    case "OracleRegistrySnapshotPublished": return [{ role: "insurerAdmin", subject: "", title: "Oracle registry snapshot published", asset: text(p, "id") }];
    case "OracleVerificationRequested": return [{ role: "insurerAdmin", subject: "", title: "Oracle verification requested", asset: text(p, "id") }];
    case "OracleCommitmentSubmitted": return [{ role: "insurerAdmin", subject: "", title: "Oracle commitment received", asset: text(p, "requestId") }];
    case "OracleResultRevealed": return [{ role: "insurerAdmin", subject: "", title: "Oracle result revealed", asset: text(p, "requestId") }];
    case "OracleRequestFinalized": return [{ role: "insurerAdmin", subject: "", title: `Oracle ${text(p, "finalizationCode").toLowerCase().replaceAll("_", " ")}`, asset: text(p, "id") }];
    case "ClaimReviewOpened": return Array.isArray(p.assignedAuditorIds)
      ? p.assignedAuditorIds.filter((value): value is string => typeof value === "string").map((subject) => ({ role: "auditor", subject, title: "Review assignment received", asset: text(p, "id") }))
      : [];
    case "AuditorDecisionRecorded": return [{ role: "insurerAdmin", subject: "", title: "Auditor vote recorded", asset: text(p, "claimId") }];
    case "ClaimAppealSubmitted": return [
      { role: "insurerAdmin", subject: "", title: "Claim appeal submitted", asset: text(p, "claimId") },
      { role: "policyholder", subject: text(p, "claimantId"), title: "Appeal submitted for corrected-invoice verification", asset: text(p, "claimId") },
    ];
    case "SettlementAuthorized": return [{ role: "bankOfficer", subject: "", title: "Settlement ready for confirmation", asset: text(p, "id") }];
    case "PremiumCollectionQueued": return [{ role: "bankOfficer", subject: "", title: "Premium collection queued", asset: text(p, "id") }];
    case "BankTransferProcessed": return [
      { role: "bankOfficer", subject: "", title: `Bank transfer ${text(p, "status").toLowerCase()}`, asset: text(p, "id") },
      ...(text(p, "policyId") ? [{ role: "policyholder", subject: "", title: `${text(p, "method") === "CLAIM_PAYOUT" ? "Claim payout" : "Premium transfer"} ${text(p, "status").toLowerCase()}`, asset: text(p, "policyId") }] : []),
    ];
    case "BankMandateReviewed": return [
      { role: "bankOfficer", subject: "", title: `EFT mandate ${text(p, "status").toLowerCase()}`, asset: text(p, "id") },
      { role: "policyholder", subject: text(p, "ownerId"), title: `EFT mandate ${text(p, "status").toLowerCase()}`, asset: text(p, "id") },
    ];
    case "PremiumCollectionProcessed": return [{ role: "insurerAdmin", subject: "", title: `Premium collection ${text(p, "status").toLowerCase()}`, asset: text(p, "id") }];
    case "BenefitRequested": return [{ role: "insurerAdmin", subject: "", title: "Benefit request submitted", asset: text(p, "id") }];
    case "BenefitPaymentReady": return [{ role: "bankOfficer", subject: "", title: "Benefit payment ready", asset: text(p, "id") }];
    case "BenefitPaymentConfirmed": return [
      { role: "bankOfficer", subject: "", title: "Benefit payment confirmed", asset: text(p, "id") },
      { role: "policyholder", subject: text(p, "requesterId"), title: "Benefit payment confirmed", asset: text(p, "id") },
    ];
    case "SettlementPaymentFailed": return [{ role: "insurerAdmin", subject: "", title: "Claim payout failed at the Bank", asset: text(p, "claimId") }];
    case "SettlementConfirmed": return [{ role: "insurerAdmin", subject: "", title: "Claim payout confirmed by the Bank", asset: text(p, "claimId") }];
    case "EvidenceAccessGranted": return [{ role: text(p, "granteeRole"), subject: text(p, "granteeSubject"), title: "Evidence access granted", asset: text(p, "id") }];
    case "EvidenceAccessRevoked": return [{ role: text(p, "granteeRole"), subject: text(p, "granteeSubject"), title: "Evidence access revoked", asset: text(p, "id") }];
    default: return [];
  }
}

function communicationFor(event: IndexedFabricEvent, createdAt: string): BankCommunication | null {
  const p = event.payload;
  if (event.eventName === "BankTransferProcessed" && text(p, "policyId")) {
    const method = text(p, "method");
    const status = text(p, "status");
    return {
      id: `${event.id}:email`, eventId: event.id, recipientSubject: "", policyId: text(p, "policyId"),
      template: "bank-transaction-status", title: `${method === "CLAIM_PAYOUT" ? "Claim payout" : "Bank transaction"} ${status.toLowerCase()}`,
      assetId: text(p, "id"), amountMinor: Number(p.amountMinor ?? 0), currency: text(p, "currency") || "BDT",
      status: "PENDING", adapter: "", recipient: "", messageId: "", error: "", createdAt, deliveredAt: "",
      variables: { transferId: text(p, "id"), policyId: text(p, "policyId"), method, status, failureCode: text(p, "failureCode"), amountMinor: Number(p.amountMinor ?? 0), currency: text(p, "currency") || "BDT" },
    };
  }
  if (event.eventName === "BankMandateReviewed" && text(p, "ownerId")) {
    return {
      id: `${event.id}:email`, eventId: event.id, recipientSubject: text(p, "ownerId"), policyId: text(p, "policyId"),
      template: "bank-mandate-status", title: `EFT mandate ${text(p, "status").toLowerCase()}`,
      assetId: text(p, "id"), amountMinor: Number(p.amountMinor ?? 0), currency: "BDT",
      status: "PENDING", adapter: "", recipient: "", messageId: "", error: "", createdAt, deliveredAt: "",
      variables: { mandateId: text(p, "id"), policyId: text(p, "policyId"), status: text(p, "status"), amountMinor: Number(p.amountMinor ?? 0), currency: "BDT" },
    };
  }
  if (event.eventName === "BenefitPaymentConfirmed" && text(p, "requesterId")) {
    return {
      id: `${event.id}:email`, eventId: event.id, recipientSubject: text(p, "requesterId"), policyId: text(p, "policyId"),
      template: "bank-benefit-payment", title: "Benefit payment confirmed",
      assetId: text(p, "id"), amountMinor: Number(p.amountMinor ?? 0), currency: "BDT",
      status: "PENDING", adapter: "", recipient: "", messageId: "", error: "", createdAt, deliveredAt: "",
      variables: { benefitRequestId: text(p, "id"), policyId: text(p, "policyId"), status: text(p, "status"), amountMinor: Number(p.amountMinor ?? 0), currency: "BDT" },
    };
  }
  return null;
}

export function applyFabricEvent(current: EventProjection, event: IndexedFabricEvent, updatedAt: string): EventProjection {
  if (current.events.some((item) => item.id === event.id)) return current;
  const notifications = notificationTargets(event).map((target, index) => ({
    id: `${event.id}:${index}`,
    eventId: event.id,
    recipientRole: target.role,
    recipientSubject: target.subject,
    title: target.title,
    message: `${target.title} at Fabric block ${event.blockNumber}.`,
    assetId: target.asset,
    blockNumber: event.blockNumber,
  }));
  const communication = communicationFor(event, updatedAt);
  return {
    schemaVersion: 2,
    updatedAt,
    checkpoint: { blockNumber: event.blockNumber, transactionId: event.transactionId },
    events: [...current.events, event].slice(-5_000),
    countsByName: { ...current.countsByName, [event.eventName]: (current.countsByName[event.eventName] ?? 0) + 1 },
    notifications: [...current.notifications, ...notifications].slice(-2_000),
    communications: [...(current.communications ?? []), ...(communication ? [communication] : [])].slice(-2_000),
  };
}

export function notificationsFor(projection: EventProjection, role: string, subject = "") {
  return projection.notifications.filter((item) => item.recipientRole === role &&
    (!item.recipientSubject || item.recipientSubject === "*" || item.recipientSubject === subject));
}

export function communicationsFor(projection: EventProjection) {
  return [...(projection.communications ?? [])].reverse();
}
