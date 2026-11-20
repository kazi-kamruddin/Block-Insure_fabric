"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { sha256Hex } from "@/lib/evidence/browser-crypto";
import { medicalReasonLabels, type MedicalReviewCommand, type MedicalReviewView } from "@/lib/fabric/medical-review";
import type { MedicalQuote } from "@/lib/fabric/medical";
import { researchFindings } from "@/lib/fabric/research-finding";

const later = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const id = (prefix: string) => prefix + "-" + crypto.randomUUID();
const textHash = (text: string) => sha256Hex(new TextEncoder().encode(text));
const fileHash = async (file: File | null) => file ? sha256Hex(new Uint8Array(await file.arrayBuffer())) : "";
type ReasonCode = keyof typeof medicalReasonLabels;

export function MedicalReview({ role, onEvidence, investigationEnabled = false }: {
  role: "insurerAdmin" | "policyholder" | "auditor";
  investigationEnabled?: boolean;
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
  const [finding, setFinding] = useState<keyof typeof researchFindings>("INCONCLUSIVE");
  const [findingBasis, setFindingBasis] = useState("");
  const review = view?.review;
  const clarification = view?.clarification;
  const preparing = review?.status === "PREPARING";
  const approveVotes = view?.decisions.filter(decision => decision.outcome === "APPROVE").length ?? 0;
  const rejectVotes = view?.decisions.filter(decision => decision.outcome === "REJECT").length ?? 0;

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

  async function saveFinding() {
    if (!view || !findingBasis.trim()) return;
    const response = await fetch("/api/medical/investigation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimId: view.claim.id, version: view.claim.version, outcome: finding, basisHash: await textHash(findingBasis.trim()) }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message);
    setFindingBasis("");
    setStatus("Research finding recorded for this claim version.");
  }

  async function loadQuote() {
    const response = await fetch("/api/medical/review?" + new URLSearchParams({ claim: claimId.trim(), revision }), { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message);
    setQuote(body.quote);
  }

  return <article className="workCard workCardWide" id="medical-review">
    <span className="kicker">Governed adjudication</span>
    <h2>Medical review and appeal</h2>
    <p className="authorityDistinction">
      <strong>Decision boundary:</strong> Automated Oracle checks and offline benchmarks inform processing only. Final governed outcomes come solely from three approval votes or two rejection votes across the four assigned AuditorMSP certificates.
    </p>
    <div className="auditExport">
      <label>Medical claim ID<input value={claimId} disabled={busy} spellCheck={false} autoComplete="off" onChange={event => {
        setClaimId(event.target.value); setView(undefined); setQuote(undefined); setMessage(""); setFile(null);
        setFindingBasis(""); setFinding("INCONCLUSIVE");
      }} /></label>
      <button type="button" className="primary button" onClick={() => work(load)} disabled={busy || !claimId.trim()} aria-busy={busy}>Load medical case</button>
    </div>
    {view && <div className="medicalSubpanel">
      <div className="reviewSummaryRow">
        <strong>Claim version {view.claim.version} · {view.claim.status}</strong>
        <StatusBadge status={view.claim.status} />
      </div>
      <p>Recorded service {view.facts.service} on {view.facts.serviceDate} · episode revision {view.claim.episodeRevision}</p>
      {view.claim.medicalDuplicateReview && <p>Panel review required. A separate episode has similar service dates and billing facts.</p>}
      {view.claim.medicalEscalatedAt && <p>Escalated to the appointed auditors.</p>}
      {view.devLite && role === "policyholder" && !review && !view.claim.medicalEscalatedAt &&
        ["SUBMITTED", "APPEAL_SUBMITTED", "ORACLE_PENDING"].includes(view.claim.status) &&
        <button type="button" className="secondary button" disabled={busy} onClick={() => work(() => send({ action: "escalate", claimId: view.claim.id }))}>
          Escalate after processing deadline
        </button>}
      {role === "auditor" && preparing && review && view.claim.medicalEscalatedAt &&
        <button type="button" className="primary button" disabled={busy} onClick={() => work(() => send({ action: "open", reviewId: review.id, deadline: later(24) }))}>Open escalated voting</button>}
      <p>Billed BDT {(view.facts.quote.billedMinor / 100).toFixed(2)} · Eligible BDT {(view.facts.quote.eligibleMinor / 100).toFixed(2)} · Payable BDT {(view.facts.quote.payableMinor / 100).toFixed(2)}</p>
      {view.appeal && <p>Appeal {view.appeal.status} · Disputed decision {view.appeal.disputedDecisionId}</p>}
      {view.appealExplanation && <p>Appeal explanation: {view.appealExplanation}</p>}
      {review && <div className="quorumCard">
        <div className="reviewSummaryRow">
          <span>Assigned reviewers: {review.assignedAuditorIds.join(", ")}. Three approvals or two rejections decide the round.</span>
          <StatusBadge status={review.status} />
        </div>
        <p className="cardNote">{review.status} · {preparing ? "Prepare by " + review.prepareBy : review.deadline ? "Voting deadline " + review.deadline : "Voting has not opened"}</p>
        <div className="quorumMeters">
          <div className="quorumMeterRow">
            <div className="quorumMeterRowHeader"><span>Approvals</span><span>{approveVotes} / 3</span></div>
            <div className="quorumTrack" aria-hidden="true">
              <div className="quorumFill quorumFill-approved" style={{ width: `${Math.min(100, Math.round((approveVotes / 3) * 100))}%` }} />
            </div>
          </div>
          <div className="quorumMeterRow">
            <div className="quorumMeterRowHeader"><span>Rejections</span><span>{rejectVotes} / 2</span></div>
            <div className="quorumTrack" aria-hidden="true">
              <div className="quorumFill quorumFill-rejected" style={{ width: `${Math.min(100, Math.round((rejectVotes / 2) * 100))}%` }} />
            </div>
          </div>
        </div>
        {view.documents.length > 0 ? <ul style={{ marginTop: 14 }}>{view.documents.map(doc => <li key={doc.id}>
          {doc.documentType} · <code>{doc.id}</code>
          {preparing && role !== "auditor" && <span> · {view.checks.filter(check => check.evidenceId === doc.id).length} of 4 reviewers confirmed decryption</span>}
          {role === "auditor" && view.grants.filter(grant => grant.evidenceId === doc.id && grant.status === "ACTIVE").map(grant =>
            <button key={grant.id} type="button" className="secondary button" style={{ marginLeft: 10 }} onClick={() => onEvidence(doc.id, grant.id)}>Open granted evidence</button>)}
        </li>)}</ul> : <p className="cardNote" style={{ marginTop: 12 }}>No attachments. Review the structured episode and issued terms.</p>}
        {view.decisions.length > 0 && <ul>{view.decisions.map(decision => <li key={decision.id}>
          <StatusBadge status={decision.outcome} /> · {medicalReasonLabels[decision.reasonCode as ReasonCode] ?? "Reason recorded"} · <code>{decision.id}</code>
        </li>)}</ul>}
      </div>}
      {clarification && <div className="medicalSubpanel">
        <div className="reviewSummaryRow">
          <strong>Clarification</strong>
          <StatusBadge status={clarification.status} />
        </div>
        <p>Clarification ({clarification.status}): {clarification.question}</p>
        <p className="cardNote">Response due {clarification.deadline}</p>
        {clarification.answer && <p>Response: {clarification.answer}</p>}
      </div>}
      {role === "insurerAdmin" && <>
        {investigationEnabled && ["SETTLED", "REJECTED"].includes(view.claim.status) && <section className="medicalSubpanel" key={view.claim.id}>
          <h3>Research finding</h3>
          <label>Investigation outcome<select value={finding} onChange={event => setFinding(event.target.value as keyof typeof researchFindings)}>
            {Object.entries(researchFindings).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select></label>
          <label>Independent investigation reference<input value={findingBasis} maxLength={200} onChange={event => setFindingBasis(event.target.value)} /></label>
          <div className="medicalButtonGroup">
            <button type="button" className="primary button" disabled={busy || !findingBasis.trim()} onClick={() => work(saveFinding)}>Record research finding</button>
          </div>
        </section>}
        {!review && ["ORACLE_FAILED", "MEDICAL_REVIEW_REQUIRED"].includes(view.claim.status) &&
          <div className="medicalButtonGroup"><button type="button" className="primary button" disabled={busy} onClick={() => work(() => send({ action: "prepare", claimId: view.claim.id, reviewId: id("review"), prepareBy: later(48) }))}>Prepare four-auditor review</button></div>}
        {preparing && review && <>
          {!clarification && <div className="medicalSubpanel">
            <label>Clarification question and requested evidence<textarea value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} /></label>
            <div className="medicalButtonGroup">
              <button type="button" className="primary button" disabled={busy || !message.trim()} onClick={() => work(() => send({ action: "ask", reviewId: review.id, id: id("question"),
                deadline: new Date(Math.min(Date.parse(review.prepareBy!), Date.now() + 24 * 3_600_000)).toISOString(), message }))}>Send clarification</button>
            </div>
          </div>}
          <div className="medicalButtonGroup">
            {clarification?.status === "PENDING" && <button type="button" className="secondary button" disabled={busy} onClick={() => work(() => send({ action: "respond", id: clarification.id, response: "EXPIRED", message: "", evidenceHash: "" }))}>Close expired clarification</button>}
            <button type="button" className="primary button" disabled={busy || clarification?.status === "PENDING"} onClick={() => work(() => send({ action: "open", reviewId: review.id, deadline: later(24) }))}>Open voting for 24 hours</button>
          </div>
        </>}
        <div className="medicalButtonGroup">
          {review && (preparing || review.status === "OPEN") &&
            <button type="button" className="secondary button" disabled={busy} onClick={() => work(() => send({ action: "expire", reviewId: review.id }))}>Finalize expired review</button>}
          {review && ["ACCESS_FAILED", "TIMED_OUT"].includes(review.status) && !view.claim.medicalRecoveryUsed &&
            <button type="button" className="secondary button" disabled={busy} onClick={() => work(() => send({ action: "recover", reviewId: review.id, newId: id("review"), prepareBy: later(48) }))}>Use one procedural recovery</button>}
        </div>
      </>}
      {role === "policyholder" && <>
        {preparing && clarification?.status === "PENDING" && <div className="medicalSubpanel">
          <label>Response type<select value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
            <option value="ANSWER">Answer without new material</option><option value="MATERIAL">New material or evidence</option><option value="UNAVAILABLE">Requested material unavailable</option>
          </select></label>
          <label>Clarification response<textarea value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} /></label>
          {mode === "MATERIAL" && <label>New clarification document<input type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>}
          <div className="medicalButtonGroup">
            <button type="button" className="primary button" disabled={busy || !message.trim()} onClick={() => work(async () => send({ action: "respond", id: clarification.id,
              response: mode, message, evidenceHash: mode === "MATERIAL" ? await fileHash(file) : "" }))}>Send response</button>
          </div>
        </div>}
        {preparing && review && view.documents.length > 0 &&
          <div className="medicalButtonGroup"><button type="button" className="primary button" disabled={busy} onClick={() => work(() => send({ action: "share", reviewId: review.id, expiresAt: later(96) }))}>Grant listed evidence to these four reviewers</button></div>}
        {review?.status === "REJECTED" && !view.claim.appealCount && <div className="medicalSubpanel">
          <label>Disputed rejection<select value={decisionId} onChange={event => setDecisionId(event.target.value)}>
            <option value="">Choose a reason</option>
            {view.decisions.filter(decision => decision.outcome === "REJECT").map(decision =>
              <option key={decision.id} value={decision.id}>{medicalReasonLabels[decision.reasonCode as ReasonCode] ?? decision.id}</option>)}
          </select></label>
          <label>What changed?<textarea value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} /></label>
          <label>New appeal document<input type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
          <label>Corrected episode revision (optional)<input type="number" min="1" value={revision} onChange={event => { setRevision(event.target.value); setQuote(undefined); }} /></label>
          <div className="medicalButtonGroup">
            {revision && <button type="button" className="secondary button" disabled={busy} onClick={() => work(loadQuote)}>Calculate corrected reimbursement</button>}
            {quote && <p>Corrected payable amount BDT {(quote.payableMinor / 100).toFixed(2)}. Filing this appeal accepts this revised calculation.</p>}
            <button type="button" className="primary button" disabled={busy || !decisionId || !message.trim() || (revision ? !quote : !file)} onClick={() => work(async () => send({
              action: "appeal", id: id("appeal"), claimId: view.claim.id, decisionId, message, evidenceHash: await fileHash(file),
              revision: Number(revision || 0), acceptedStatementHash: quote?.statementHash ?? "",
            }))}>File medical appeal</button>
          </div>
        </div>}
        {view.claim.medicalSupplementHash && view.claim.status === "SUBMITTED" && <p className="evidenceWarning">Upload the committed file below as CLARIFICATION_DOCUMENT before re-verification.</p>}
        {view.appeal?.evidenceHash && view.claim.status === "APPEAL_SUBMITTED" && <p className="evidenceWarning">Upload the committed file below as APPEAL_DOCUMENT before re-verification.</p>}
        {view.claim.medicalSupplementHash && view.claim.status === "APPEAL_SUBMITTED" && <p className="evidenceWarning">Also upload the committed CLARIFICATION_DOCUMENT for the new response.</p>}
      </>}
      {role === "auditor" && review?.status === "OPEN" && <div className="medicalSubpanel">
        <label>Decision reason<select value={reason} onChange={event => setReason(event.target.value as ReasonCode)}>
          {(Object.keys(medicalReasonLabels) as ReasonCode[]).map(code => <option key={code} value={code}>{medicalReasonLabels[code]}</option>)}
        </select></label>
        <label>Reason reference<textarea maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} /></label>
        <div className="medicalButtonGroup">
          <button type="button" className="primary button" disabled={busy || !message.trim()} onClick={() => work(async () => send({ action: "vote", reviewId: review.id, decisionId: id("decision"),
            outcome: reason === "TERMS_AND_EVIDENCE_SUPPORT" ? "APPROVE" : "REJECT", reasonCode: reason, reasonHash: await textHash(message.trim()) }))}>Record reasoned vote</button>
        </div>
      </div>}
    </div>}
    <p role="status">{status}</p>
  </article>;
}
