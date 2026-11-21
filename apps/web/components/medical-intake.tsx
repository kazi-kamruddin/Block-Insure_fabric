"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import type { MedicalEpisode, MedicalPreparation, MedicalQuote } from "@/lib/fabric/medical";
import type { Claim, Policy } from "@/lib/fabric/types";
import type { WorkflowCommand } from "@/lib/workflows/commands";
import type { PreparedWorkflow } from "@/components/guided-workflow-form";
import { formatBdt } from "@/lib/money";

type Intake = { episodes: MedicalEpisode[]; policies?: Policy[]; claims?: Claim[] };
const money = formatBdt;

async function json<T>(url: string, command?: WorkflowCommand): Promise<T> {
  const response = await fetch(url, command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) } : { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "The ledger operation could not be completed.");
  return data as T;
}

export function MedicalIntake({ insurer, onAssociation }: { insurer: boolean; onAssociation: (prepared: PreparedWorkflow) => void }) {
  const [intake, setIntake] = useState<Intake | null>(null);
  const [episodeId, setEpisodeId] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [draft, setDraft] = useState<{ quote: MedicalQuote; receipt: MedicalPreparation | null; deadlineSoon: boolean }>();
  const [draftId, setDraftId] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const episode = intake?.episodes.find(row => row.id === episodeId);
  const existing = intake?.claims?.find(claim => claim.episodeId === episodeId);
  const correction = Boolean(existing && episode && existing.status !== "SETTLED" &&
    (episode.revision > (existing.episodeRevision ?? 0) || episode.associationVersion !== existing.medicalAssociationVersion));

  function resetDraft() { setDraft(undefined); setDraftId(""); }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try { await action(); } catch (error) {
      setStatus(error instanceof Error ? error.message : "The action could not be completed.");
    } finally { setBusy(false); }
  }

  async function prepare() {
    if (!episode) return;
    const revision = episode.revision;
    const id = draftId || "medical-" + crypto.randomUUID();
    setDraftId(id);
    const query = new URLSearchParams({ revision: String(revision), ...(existing ? { claim: existing.id } : { policy: policyId, episode: episode.id }) });
    const { quote } = await json<{ quote: MedicalQuote }>("/api/medical/intake?" + query);
    const receipt = existing ? null : (await json<{ result: MedicalPreparation }>("/api/workflows", {
      operation: "prepareMedicalClaim", id, policyId, episodeId: episode.id, revision,
    })).result;
    const deadlineSoon = receipt !== null &&
      Date.parse(quote.filingDeadline + "T23:59:59+06:00") - Date.parse(receipt.preparedAt) < 2 * 86_400_000;
    setDraft({ quote, receipt, deadlineSoon });
  }

  async function submit() {
    if (!episode || !draft) return;
    const statementHash = draft.quote.statementHash;
    const command: WorkflowCommand = existing
      ? { operation: "acceptMedicalCorrection", id: existing.id, revision: episode.revision, statementHash }
      : { operation: "submitMedicalClaim", id: draft.receipt!.id, policyId, episodeId: episode.id, revision: episode.revision, statementHash };
    const { result } = await json<{ result: Claim }>("/api/workflows", command);
    setStatus("Claim " + result.id + ", version " + result.version + " submitted. " +
      (draft.quote.evidenceRequired ? "Upload the required invoice with this claim ID." : "You can attach supporting evidence if needed."));
    setIntake(current => current ? { ...current, claims: [...(current.claims ?? []).filter(claim => claim.id !== result.id), result] } : current);
    resetDraft();
  }

  return <article className="workCard guidedCard">
    <span className="kicker">Hospital episode coordination</span>
    <h2>{insurer ? "Episode association queue" : "Your medical episodes"}</h2>
    <div className="medicalButtonGroup">
      <button type="button" className="secondary button" disabled={busy} onClick={() => run(async () => {
        setIntake(await json<Intake>("/api/medical/intake")); resetDraft();
      })}>Refresh episodes</button>
    </div>
    {intake && insurer && <div className="queueList" style={{ marginTop: 14 }}>{intake.episodes.map(row => <div className="queueItem" key={row.id}>
      <div>
        <div className="queueTitle">
          <strong>{row.hospitalId} · {row.service} · {row.serviceDate || "Service date to confirm"}</strong>
          <StatusBadge status={row.associationStatus} />
        </div>
        <small className="monoWrap">Patient reference fingerprint: {row.patientReferenceHash}</small>
      </div>
      <button type="button" className="secondary button" onClick={() => onAssociation({ revision: Date.now(), command: {
        operation: "verifyMedicalAssociation", episodeId: row.id, revision: row.revision, beneficiaryId: row.beneficiaryId,
      } })}>{row.associationStatus === "VERIFIED" ? "Review association" : "Resolve association"}</button>
    </div>)}</div>}
    {intake && !insurer && <div className="guidedForm" style={{ marginTop: 14 }}>
      <label>Medical policy<select disabled={busy} value={policyId} onChange={event => { setPolicyId(event.target.value); resetDraft(); }}>
        <option value="">Choose a policy</option>
        {intake.policies?.map(policy => <option key={policy.id} value={policy.id}>{policy.id} · {policy.status} · paid through {policy.paidThroughDate || "no paid days"}</option>)}
      </select></label>
      <label>Verified episode<select disabled={busy} value={episodeId} onChange={event => { setEpisodeId(event.target.value); resetDraft(); }}>
        <option value="">Choose an episode</option>
        {intake.episodes.map(row => <option key={row.id} value={row.id}>{row.hospitalId} · {row.service} · {row.serviceDate || "date unresolved"}</option>)}
      </select></label>
      {!intake.episodes.length && <p className="wideField emptyState">No verified episodes are available yet. The insurer can check an outstanding association.</p>}
      {episode && <div className="wideField medicalSubpanel">
        <div className="reviewSummaryRow">
          <span>Revision {episode.revision} · {episode.service} · {money(episode.billMinor)} · {episode.admissionDate} to {episode.dischargeDate}</span>
          {existing && <StatusBadge status={existing.status} label={`Claim ${existing.id} · v${existing.version} · ${existing.status}`} />}
        </div>
        {!episode.serviceDate && <p className="evidenceWarning">Ask the insurer to confirm the documented service date before filing.</p>}
        {(!existing || correction) && <div className="medicalButtonGroup">
          <button type="button" className="secondary button" disabled={busy || (!existing && !policyId) || !episode.serviceDate} onClick={() => run(prepare)}>{correction ? "Review corrected reimbursement" : "Prepare claim and calculate reimbursement"}</button>
        </div>}
      </div>}
      {draft && <div className="wideField medicalSubpanel">
        <h3>Insurer reimbursement statement</h3>
        <p>Billed {money(draft.quote.billedMinor)} · Eligible {money(draft.quote.eligibleMinor)} · Deductible {money(draft.quote.deductibleMinor)} · Insurer share {money(draft.quote.insurerShareMinor)} · Remaining cover {money(draft.quote.remainingCoverMinor)}.</p>
        <p><strong>Payable {money(draft.quote.payableMinor)}</strong></p>
        <p className="cardNote">Filing deadline {draft.quote.filingDeadline} (Asia/Dhaka). Preparation does not extend it.</p>
        {!correction && draft.deadlineSoon && <p className="formError" role="alert">The filing deadline is within two days. Submit before it closes.</p>}
        {draft.receipt && <p>Preparation receipt <code>{draft.receipt.id}</code> recorded {draft.receipt.preparedAt}.</p>}
        <div className="medicalButtonGroup">
          <button type="button" className="primary button" disabled={busy || (!correction && draft.quote.payableMinor <= 0)} onClick={() => run(submit)}>{correction ? "Reconfirm this correction" : "Accept statement and submit claim"}</button>
        </div>
      </div>}
    </div>}
    <p role="status">{status}</p>
  </article>;
}
