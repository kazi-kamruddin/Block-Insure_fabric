import type { ReactNode } from "react";

export type StatusTone = "approved" | "pending" | "rejected" | "oracle" | "neutral";

const APPROVED_STATES = new Set([
  "SETTLED",
  "CONFIRMED",
  "APPROVED",
  "FINALIZED",
  "PUBLISHED",
  "ACTIVE",
  "VALID",
  "DELIVERED",
  "SUCCESS",
  "HEALTHY",
  "CONNECTED",
  "READY",
  "VERIFIED",
  "COMPLETED",
  "PAID",
  "OVERTURNED",
  "EXACT_CONSENSUS",
  "LOW",
]);

const PENDING_STATES = new Set([
  "PENDING",
  "PENDING_PAYMENT",
  "PENDING_RECONCILIATION",
  "PENDING_REVIEW",
  "REVIEW",
  "OPEN",
  "PROCESSING",
  "SUBMITTED",
  "APPEAL_SUBMITTED",
  "UNDER_REVIEW",
  "PREPARING",
  "MEDICAL_REVIEW_PREPARING",
  "MEDICAL_REVIEW_REQUIRED",
  "MEDICAL_AUDIT_PENDING",
  "MODEL_HELD",
  "DUE",
  "RETRY",
  "FUNDING_REQUIRED",
  "PAYMENT_READY",
  "AUTHORIZED",
  "SETTLEMENT_AUTHORIZED",
  "FALLBACK_REQUIRED",
  "DEGRADED",
  "WARNING",
  "GRACE",
  "DRAFT",
  "UPHELD",
  "MEDIUM",
  "INCONCLUSIVE",
  // Chaincode status for "the Oracles did not auto-approve". The agreed Oracle
  // decision (panel review or integrity issue) routes the claim onwards, so it
  // is not a terminal failure. The ledger value is kept for compatibility.
  "ORACLE_FAILED",
]);

const REJECTED_STATES = new Set([
  "REJECTED",
  "INVALID",
  "BOUNCED",
  "RETIRED",
  "VOID",
  "VOIDED",
  "CONFLICT",
  "TIMEOUT",
  "TIMED_OUT",
  "FAILED",
  "PAYMENT_FAILED",
  "ACCESS_FAILED",
  "PROCEDURAL_FAILURE",
  "UNHEALTHY",
  "DISCONNECTED",
  "UNREADY",
  "LAPSED",
  "CANCELLED",
  "EXPIRED",
  "REVOKED",
  "EXHAUSTED",
  "SUSPENDED",
  "ENDED",
  "BLACKLISTED",
  "NO_PAYABLE_AMOUNT",
  "DISABLED",
  "HIGH",
  "NOT_SUBMITTED",
]);

const ORACLE_STATES = new Set([
  "ORACLE",
  "ORACLE_PENDING",
  "HOSPITAL_VERIFIED",
  "COMMITTED",
  "REVEALED",
  "AGREEMENT",
  "CONSENSUS",
  "SOURCE_BOUND",
  "DISMISSED",
  "SUBSTANTIATED",
]);

export function resolveStatusTone(status: string, explicitTone?: StatusTone): StatusTone {
  if (explicitTone) return explicitTone;
  const key = status.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (APPROVED_STATES.has(key)) return "approved";
  if (REJECTED_STATES.has(key)) return "rejected";
  if (ORACLE_STATES.has(key)) return "oracle";
  if (PENDING_STATES.has(key)) return "pending";
  return "neutral";
}

function StatusGlyph({ tone }: { tone: StatusTone }): ReactNode {
  if (tone === "approved") {
    return (
      <svg aria-hidden="true" className="statusGlyph" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 6.2 5 8.6 9.6 3.5" />
      </svg>
    );
  }
  if (tone === "rejected") {
    return (
      <svg aria-hidden="true" className="statusGlyph" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.2 3.2 8.8 8.8M8.8 3.2 3.2 8.8" />
      </svg>
    );
  }
  if (tone === "oracle") {
    return (
      <svg aria-hidden="true" className="statusGlyph" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="6,1.5 10.5,6 6,10.5 1.5,6" />
      </svg>
    );
  }
  if (tone === "pending") {
    return (
      <svg aria-hidden="true" className="statusGlyph" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="6" cy="6" r="4.3" />
        <path d="M6 3.7v2.4l1.6 1" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="statusGlyph" viewBox="0 0 12 12" fill="currentColor">
      <circle cx="6" cy="6" r="2.5" />
    </svg>
  );
}

export function StatusBadge({
  status,
  label,
  tone,
  className = "",
}: {
  status: string;
  label?: string;
  tone?: StatusTone;
  className?: string;
}) {
  const resolvedTone = resolveStatusTone(status, tone);
  const statusSlug = status.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const labels: Record<string, string> = {
    exact_consensus: "Oracle quorum agreed",
    negative_result: "Oracle quorum referred for review",
    conflict: "Oracle results differed",
    timeout: "Oracle verification timed out",
    escalated_timeout: "Claim escalated after Oracle timeout",
    model_held: "Model on hold",
    medical_audit_pending: "Held for random audit sampling",
    oracle_failed: "Oracle did not auto-approve",
  };
  const display = label ?? labels[statusSlug] ?? status.replaceAll("_", " ");
  return (
    <span className={`status status-${resolvedTone} status-${statusSlug} ${className}`.trim()}>
      <StatusGlyph tone={resolvedTone} />
      <span>{display}</span>
    </span>
  );
}
