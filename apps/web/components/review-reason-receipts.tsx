"use client";

import { useState } from "react";

export type ReasonAttempt = { reviewId: string; round: number; attemptId: string; decisionId: string };
type Draft = Pick<ReasonAttempt, "reviewId" | "round" | "attemptId"> & { text: string; evidenceRefs: string[] };
type ReasonReceipt = { decisionId: string; auditorId: string; text: string | null; evidenceRefs: string[]; matchesLedgerHash: boolean };

async function postReason(body: { action: "draft" } & Draft | { action: "bind" } & ReasonAttempt) {
  const response = await fetch("/api/medical/review/reason", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.json()).message);
}

export const saveReviewReason = (draft: Draft) => postReason({ action: "draft", ...draft });
export const bindReviewReason = (attempt: ReasonAttempt) => postReason({ action: "bind", ...attempt });

export function ReviewReasonReceipts({ reviewId }: { reviewId: string }) {
  const [receipts, setReceipts] = useState<ReasonReceipt[]>();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/medical/review/reason?" + new URLSearchParams({ reviewId }), { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setReceipts(result.receipts);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review reasons are unavailable.");
    } finally {
      setLoading(false);
    }
  }
  return <div className="medicalSubpanel">
    <button type="button" className="secondary button" disabled={loading} onClick={() => void load()}>Load auditor reasons</button>
    <p className="cardNote">The Gateway operator holds the reason encryption key.</p>
    <p role="status">{message}</p>
    {receipts?.length ? <ul>{receipts.map(receipt => <li key={receipt.decisionId}>
      <strong>{receipt.auditorId}</strong>
      <p>{receipt.text ?? "The stored reason could not be verified."}</p>
      <p>Matches ledger hash {receipt.matchesLedgerHash ? "yes" : "no"}</p>
      {receipt.evidenceRefs.length > 0 && <p>Referenced evidence {receipt.evidenceRefs.join(", ")}</p>}
    </li>)}</ul> : receipts && <p>No bound reasons are available for this round.</p>}
  </div>;
}
