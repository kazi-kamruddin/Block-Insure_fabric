"use client";

import type { FormEvent } from "react";
import type { MedicalReviewCommand, MedicalReviewView } from "@/lib/fabric/medical-review";
import { OracleExplanation } from "./oracle-explanation";

const factLabels: Record<string, string> = {
  invoiceIssued: "Hospital invoice", licenceActiveOnServiceDate: "Licence on service date",
  serviceAccredited: "Service accreditation", tariffBand: "Regulator tariff", receiptConsistent: "Receipt consistency",
};
const decisionLabels = { AUTO_APPROVE: "Automatic approval", PANEL_REVIEW: "Panel review", INTEGRITY_FAIL: "Evidence integrity issue · Panel review" };

export function MedicalOracleV2({ view, isClaimant, busy, onAction }: {
  view: MedicalReviewView; isClaimant: boolean; busy: boolean; onAction: (command: MedicalReviewCommand) => void;
}) {
  if (!view.oracleV2) return null;
  const request = view.oracle;
  let factVector: { facts: Record<string, { status: string; integrity?: string }>; tariffBand: string; receiptCheck: string; modelAdvice: string } | undefined;
  if (request?.factVectorJSON) {
    try { factVector = JSON.parse(request.factVectorJSON); } catch { /* Ledger details remain unavailable. */ }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    onAction({ action: "recordReceiptSummary", claimId: view.claim.id, summary: {
      evidenceId: String(fields.get("evidenceId")), invoiceNumber: String(fields.get("invoiceNumber")).trim(),
      amountMinor: Number(fields.get("amountMinor")), serviceDate: view.facts.serviceDate, hospitalId: view.claim.hospitalId,
      derivedFrom: String(fields.get("derivedFrom")).trim(),
    } });
  };
  const waitingForReceipt = !request && isClaimant && view.documents.length > 0 && view.facts.service === "DIAGNOSTIC" &&
    ["SUBMITTED", "APPEAL_SUBMITTED"].includes(view.claim.status);
  return <>
    {request && <section className="medicalSubpanel" aria-label="Oracle v2 evidence decision">
      <h3>Oracle evidence decision</h3>
      <p>{request.decision ? decisionLabels[request.decision] : request.finalizationCode || "Awaiting Oracle results"}</p>
      {factVector && <dl className="planFacts">
        {Object.entries(factVector.facts).map(([name, fact]) => <div key={name}><dt>{factLabels[name] ?? name}</dt>
          <dd>{fact.status.replaceAll("_", " ")}{fact.integrity ? ` · ${fact.integrity.replaceAll("_", " ")}` : ""}</dd></div>)}
        <div><dt>Tariff band</dt><dd>{factVector.tariffBand.replaceAll("_", " ")}</dd></div>
        <div><dt>Receipt comparison</dt><dd>{factVector.receiptCheck}</dd></div>
        <div><dt>Model advice</dt><dd>{factVector.modelAdvice}</dd></div>
      </dl>}
      {request.finalizedAt && <OracleExplanation requestId={request.id} />}
      {request.status === "PENDING" && (view.readAt ?? 0) > Date.parse(request.revealDeadline) &&
        <button type="button" className="secondary button" disabled={busy} onClick={() => onAction({ action: "oracleTimeout", requestId: request.id })}>Close timed-out Oracle request</button>}
    </section>}
    {waitingForReceipt && <section className="medicalSubpanel">
      <h3>Confirm receipt details</h3>
      <form onSubmit={submit} className="workflowForm">
        <label>Receipt evidence<select name="evidenceId" required>
          {view.documents.map(doc => <option value={doc.id} key={doc.id}>{doc.documentType} · {doc.id}</option>)}
        </select></label>
        <label>Invoice or receipt number<input name="invoiceNumber" maxLength={64} required /></label>
        <label>Bill amount in poisha<input type="number" name="amountMinor" min="1" step="1" required /></label>
        <label>Hospital source record ID<input name="derivedFrom" maxLength={128} required /></label>
        <button type="submit" className="secondary button" disabled={busy}>Save private receipt summary</button>
      </form>
    </section>}
  </>;
}
