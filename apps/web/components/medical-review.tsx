"use client";

import { useState } from "react";
import { sha256Hex } from "@/lib/evidence/browser-crypto";
import { medicalReasonLabels, type MedicalReviewCommand, type MedicalReviewView } from "@/lib/fabric/medical-review";
import type { MedicalQuote } from "@/lib/fabric/medical";

const later = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const id = (prefix: string) => prefix + "-" + crypto.randomUUID();
const textHash = (text: string) => sha256Hex(new TextEncoder().encode(text));
const fileHash = async (file: File | null) => file ? sha256Hex(new Uint8Array(await file.arrayBuffer())) : "";
type ReasonCode = keyof typeof medicalReasonLabels;

export function MedicalReview({ role, onEvidence }: {
  role: "insurerAdmin" | "policyholder" | "auditor";
  onEvidence: (evidenceId: string, grantId: string) => void;
}) {
  const [claimId, setClaimId] = useState("");
  const [view, setView] = useState<MedicalReviewView>();
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"ANSWER" | "UNAVAILABLE" | "MATERIAL">("ANSWER");
  const [reason, setReason] = useState<ReasonCode>("TERMS_AND_EVIDENCE_SUPPORT");
  const [decisionId, setDecisionId] = useState("");
  const [revision, setRevision] = useState("");
  const [quote, setQuote] = useState<MedicalQuote>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const review = view?.review;
  const clarification = view?.clarification;
  const preparing = review?.status === "PREPARING";

  async function load() {
    const response = await fetch("/api/medical/review?" + new URLSearchParams({ claim: claimId.trim() }), { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) { setView(undefined); throw new Error(body.message); }
    setView(body);
  }

  async function work(callback: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try { await callback(); } catch (error) { setStatus(error instanceof Error ? error.message : "Refresh the case and try again."); }
    finally { setBusy(false); }
  }

  async function send(command: MedicalReviewCommand) {
    const response = await fetch("/api/medical/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message);
    setMessage(""); setFile(null); setQuote(undefined); setRevision(""); setDecisionId("");
    await load();
    setStatus("Action confirmed.");
  }

  async function loadQuote() {
    const response = await fetch("/api/medical/review?" + new URLSearchParams({ claim: claimId.trim(), revision }), { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message);
    setQuote(body.quote);
  }

  return <article className="workCard" id="medical-review">
    <h2>Medical review and appeal</h2>
    <label>Medical claim ID<input value={claimId} disabled={busy} onChange={event => { setClaimId(event.target.value); setView(undefined); setQuote(undefined); setMessage(""); setFile(null); }} /></label>
    <button type="button" onClick={() => work(load)} disabled={busy || !claimId.trim()}>Load medical case</button>
    {view && <>
      <p>Claim version {view.claim.version} · {view.claim.status}</p>
      <p>Recorded service {view.facts.service} on {view.facts.serviceDate} · episode revision {view.claim.episodeRevision}</p>
      <p>Billed BDT {(view.facts.quote.billedMinor / 100).toFixed(2)} · Eligible BDT {(view.facts.quote.eligibleMinor / 100).toFixed(2)} · Payable BDT {(view.facts.quote.payableMinor / 100).toFixed(2)}</p>
      {view.appeal && <p>Appeal {view.appeal.status} · Disputed decision {view.appeal.disputedDecisionId}</p>}
      {view.appealExplanation && <p>Appeal explanation: {view.appealExplanation}</p>}
      {review && <>
        <p>Assigned reviewers: {review.assignedAuditorIds.join(", ")}. Three approvals or two rejections decide the round.</p>
        <p>{review.status} · {preparing ? "Prepare by " + review.prepareBy : review.deadline ? "Voting deadline " + review.deadline : "Voting has not opened"}</p>
        {view.documents.length > 0 ? <ul>{view.documents.map(doc => <li key={doc.id}>
          {doc.documentType} · {doc.id}
          {preparing && role !== "auditor" && <span> · {view.checks.filter(check => check.evidenceId === doc.id).length} of 4 reviewers confirmed decryption</span>}
          {role === "auditor" && view.grants.filter(grant => grant.evidenceId === doc.id && grant.status === "ACTIVE").map(grant =>
            <button key={grant.id} type="button" onClick={() => onEvidence(doc.id, grant.id)}>Open granted evidence</button>)}
        </li>)}</ul> : <p>No attachments. Review the structured episode and issued terms.</p>}
        {view.decisions.length > 0 && <ul>{view.decisions.map(decision => <li key={decision.id}>
          {decision.outcome} · {medicalReasonLabels[decision.reasonCode as ReasonCode] ?? "Reason recorded"} · {decision.id}
        </li>)}</ul>}
      </>}
      {clarification && <div>
        <p>Clarification ({clarification.status}): {clarification.question}</p>
        <p>Response due {clarification.deadline}</p>
        {clarification.answer && <p>Response: {clarification.answer}</p>}
      </div>}
      {role === "insurerAdmin" && <>
        {!review && ["ORACLE_FAILED", "MEDICAL_REVIEW_REQUIRED"].includes(view.claim.status) &&
          <button disabled={busy} onClick={() => work(() => send({ action: "prepare", claimId: view.claim.id, reviewId: id("review"), prepareBy: later(48) }))}>Prepare four-auditor review</button>}
        {preparing && review && <>
          {!clarification && <div>
            <label>Clarification question and requested evidence<textarea value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} /></label>
            <button disabled={busy || !message.trim()} onClick={() => work(() => send({ action: "ask", reviewId: review.id, id: id("question"),
              deadline: new Date(Math.min(Date.parse(review.prepareBy!), Date.now() + 24 * 3_600_000)).toISOString(), message }))}>Send clarification</button>
          </div>}
          {clarification?.status === "PENDING" && <button disabled={busy} onClick={() => work(() => send({ action: "respond", id: clarification.id, response: "EXPIRED", message: "", evidenceHash: "" }))}>Close expired clarification</button>}
          <button disabled={busy || clarification?.status === "PENDING"} onClick={() => work(() => send({ action: "open", reviewId: review.id, deadline: later(24) }))}>Open voting for 24 hours</button>
        </>}
        {review && (preparing || review.status === "OPEN") &&
          <button disabled={busy} onClick={() => work(() => send({ action: "expire", reviewId: review.id }))}>Finalize expired review</button>}
        {review && ["ACCESS_FAILED", "TIMED_OUT"].includes(review.status) && !view.claim.medicalRecoveryUsed &&
          <button disabled={busy} onClick={() => work(() => send({ action: "recover", reviewId: review.id, newId: id("review"), prepareBy: later(48) }))}>Use one procedural recovery</button>}
      </>}
      {role === "policyholder" && <>
        {preparing && clarification?.status === "PENDING" && <div>
          <label>Response type<select value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
            <option value="ANSWER">Answer without new material</option><option value="MATERIAL">New material or evidence</option><option value="UNAVAILABLE">Requested material unavailable</option>
          </select></label>
          <label>Clarification response<textarea value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} /></label>
          {mode === "MATERIAL" && <label>New clarification document<input type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>}
          <button disabled={busy || !message.trim()} onClick={() => work(async () => send({ action: "respond", id: clarification.id,
            response: mode, message, evidenceHash: mode === "MATERIAL" ? await fileHash(file) : "" }))}>Send response</button>
        </div>}
        {preparing && review && view.documents.length > 0 &&
          <button disabled={busy} onClick={() => work(() => send({ action: "share", reviewId: review.id, expiresAt: later(96) }))}>Grant listed evidence to these four reviewers</button>}
        {review?.status === "REJECTED" && !view.claim.appealCount && <div>
          <label>Disputed rejection<select value={decisionId} onChange={event => setDecisionId(event.target.value)}>
            <option value="">Choose a reason</option>
            {view.decisions.filter(decision => decision.outcome === "REJECT").map(decision =>
              <option key={decision.id} value={decision.id}>{medicalReasonLabels[decision.reasonCode as ReasonCode] ?? decision.id}</option>)}
          </select></label>
          <label>What changed?<textarea value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} /></label>
          <label>New appeal document<input type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
          <label>Corrected episode revision (optional)<input type="number" min="1" value={revision} onChange={event => { setRevision(event.target.value); setQuote(undefined); }} /></label>
          {revision && <button disabled={busy} onClick={() => work(loadQuote)}>Calculate corrected reimbursement</button>}
          {quote && <p>Corrected payable amount BDT {(quote.payableMinor / 100).toFixed(2)}. Filing this appeal accepts this revised calculation.</p>}
          <button disabled={busy || !decisionId || !message.trim() || (revision ? !quote : !file)} onClick={() => work(async () => send({
            action: "appeal", id: id("appeal"), claimId: view.claim.id, decisionId, message, evidenceHash: await fileHash(file),
            revision: Number(revision || 0), acceptedStatementHash: quote?.statementHash ?? "",
          }))}>File medical appeal</button>
        </div>}
        {view.claim.medicalSupplementHash && view.claim.status === "SUBMITTED" && <p>Upload the committed file below as CLARIFICATION_DOCUMENT before re-verification.</p>}
        {view.appeal?.evidenceHash && view.claim.status === "APPEAL_SUBMITTED" && <p>Upload the committed file below as APPEAL_DOCUMENT before re-verification.</p>}
        {view.claim.medicalSupplementHash && view.claim.status === "APPEAL_SUBMITTED" && <p>Also upload the committed CLARIFICATION_DOCUMENT for the new response.</p>}
      </>}
      {role === "auditor" && review?.status === "OPEN" && <div>
        <label>Decision reason<select value={reason} onChange={event => setReason(event.target.value as ReasonCode)}>
          {(Object.keys(medicalReasonLabels) as ReasonCode[]).map(code => <option key={code} value={code}>{medicalReasonLabels[code]}</option>)}
        </select></label>
        <label>Reason reference<textarea maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} /></label>
        <button disabled={busy || !message.trim()} onClick={() => work(async () => send({ action: "vote", reviewId: review.id, decisionId: id("decision"),
          outcome: reason === "TERMS_AND_EVIDENCE_SUPPORT" ? "APPROVE" : "REJECT", reasonCode: reason, reasonHash: await textHash(message.trim()) }))}>Record reasoned vote</button>
      </div>}
    </>}
    <p role="status">{status}</p>
  </article>;
}
