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

export type EventProjection = {
  schemaVersion: 1;
  updatedAt: string;
  checkpoint: { blockNumber: string; transactionId: string } | null;
  events: IndexedFabricEvent[];
  countsByName: Record<string, number>;
  notifications: OperationalNotification[];
};

export const emptyEventProjection = (): EventProjection => ({
  schemaVersion: 1,
  updatedAt: "",
  checkpoint: null,
  events: [],
  countsByName: {},
  notifications: [],
});

const text = (payload: Record<string, unknown>, key: string) => typeof payload[key] === "string" ? payload[key] : "";

function notificationTargets(event: IndexedFabricEvent) {
  const p = event.payload;
  switch (event.eventName) {
    case "ClaimSubmitted": return [{ role: "insurerAdmin", subject: "", title: "Claim submitted", asset: text(p, "id") }];
    case "ClaimHospitalVerified": return [{ role: "insurerAdmin", subject: "", title: "Hospital verification recorded", asset: text(p, "claimId") }];
    case "OracleRegistrySnapshotPublished": return [{ role: "insurerAdmin", subject: "", title: "Oracle registry snapshot published", asset: text(p, "id") }];
    case "OracleVerificationRequested": return [{ role: "insurerAdmin", subject: "", title: "Oracle verification requested", asset: text(p, "id") }];
    case "OracleCommitmentSubmitted": return [{ role: "insurerAdmin", subject: "", title: "Oracle commitment received", asset: text(p, "requestId") }];
    case "OracleResultRevealed": return [{ role: "insurerAdmin", subject: "", title: "Oracle result revealed", asset: text(p, "requestId") }];
    case "OracleRequestFinalized": return [{ role: "insurerAdmin", subject: "", title: `Oracle ${text(p, "finalizationCode").toLowerCase().replaceAll("_", " ")}`, asset: text(p, "id") }];
    case "ClaimReviewOpened": return Array.isArray(p.assignedAuditorIds)
      ? p.assignedAuditorIds.filter((value): value is string => typeof value === "string").map((subject) => ({ role: "auditor", subject, title: "Review assignment received", asset: text(p, "id") }))
      : [];
    case "AuditorDecisionRecorded": return [{ role: "insurerAdmin", subject: "", title: "Auditor vote recorded", asset: text(p, "claimId") }];
    case "ClaimAppealSubmitted": return [{ role: "insurerAdmin", subject: "", title: "Claim appeal submitted", asset: text(p, "claimId") }];
    case "SettlementAuthorized": return [{ role: "bankOfficer", subject: "", title: "Settlement ready for confirmation", asset: text(p, "id") }];
    case "PremiumCollectionQueued": return [{ role: "bankOfficer", subject: "", title: "Premium collection queued", asset: text(p, "id") }];
    case "BenefitRequested": return [{ role: "insurerAdmin", subject: "", title: "Benefit request submitted", asset: text(p, "id") }];
    case "BenefitPaymentReady": return [{ role: "bankOfficer", subject: "", title: "Benefit payment ready", asset: text(p, "id") }];
    case "EvidenceAccessGranted": return [{ role: text(p, "granteeRole"), subject: text(p, "granteeSubject"), title: "Evidence access granted", asset: text(p, "id") }];
    case "EvidenceAccessRevoked": return [{ role: text(p, "granteeRole"), subject: text(p, "granteeSubject"), title: "Evidence access revoked", asset: text(p, "id") }];
    default: return [];
  }
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
  return {
    schemaVersion: 1,
    updatedAt,
    checkpoint: { blockNumber: event.blockNumber, transactionId: event.transactionId },
    events: [...current.events, event].slice(-5_000),
    countsByName: { ...current.countsByName, [event.eventName]: (current.countsByName[event.eventName] ?? 0) + 1 },
    notifications: [...current.notifications, ...notifications].slice(-2_000),
  };
}

export function notificationsFor(projection: EventProjection, role: string, subject = "") {
  return projection.notifications.filter((item) => item.recipientRole === role &&
    (!item.recipientSubject || item.recipientSubject === "*" || item.recipientSubject === subject));
}
