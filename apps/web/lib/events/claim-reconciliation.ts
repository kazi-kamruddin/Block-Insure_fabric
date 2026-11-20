import type { IndexedFabricEvent } from "./projection";

export type ClaimProjectionRow = {
  id: string;
  status?: string;
  version?: number;
  amountMinor?: number;
  certificateHash?: string;
};

const fields = ["status", "version", "amountMinor", "certificateHash"] as const;

export function projectedClaims(events: IndexedFabricEvent[]): ClaimProjectionRow[] {
  const rows = new Map<string, ClaimProjectionRow>();
  for (const { eventName, payload } of events) {
    if (eventName === "ClaimSubmitted" && typeof payload.id === "string" && typeof payload.version === "number" &&
        typeof payload.status === "string" && typeof payload.amountMinor === "number") {
      rows.set(payload.id, { id: payload.id, version: payload.version, status: payload.status, amountMinor: payload.amountMinor });
    } else if (eventName === "OracleVerificationRequested" && typeof payload.claimId === "string" && typeof payload.claimVersion === "number") {
      rows.set(payload.claimId, { ...rows.get(payload.claimId), id: payload.claimId, version: payload.claimVersion, status: "ORACLE_PENDING" });
    } else if (["SettlementAuthorized", "SettlementPaymentFailed", "SettlementConfirmed"].includes(eventName) && typeof payload.claimId === "string") {
      rows.set(payload.claimId, { ...rows.get(payload.claimId), id: payload.claimId,
        status: eventName === "SettlementConfirmed" ? "SETTLED" : "SETTLEMENT_AUTHORIZED",
        amountMinor: typeof payload.amountMinor === "number" ? payload.amountMinor : undefined,
        certificateHash: typeof payload.approvalCertificateHash === "string" ? payload.approvalCertificateHash : undefined });
    }
  }
  return [...rows.values()];
}

export function reconcileClaimProjection(projected: ClaimProjectionRow[], ledger: ClaimProjectionRow[]) {
  const cached = new Map(projected.map(row => [row.id, row]));
  const canonical = new Map(ledger.map(row => [row.id, row]));
  return [...new Set([...cached.keys(), ...canonical.keys()])].sort().flatMap(id => {
    const row = cached.get(id);
    const authority = canonical.get(id);
    if (!row || !authority) return [{ id, issues: [row ? "missing-ledger-claim" : "missing-projection-row"] }];
    const issues = fields.flatMap(field => row[field] !== authority[field]
      ? [row[field] === undefined ? `unobserved-${field}` : `different-${field}`] : []);
    return issues.length ? [{ id, issues }] : [];
  });
}
