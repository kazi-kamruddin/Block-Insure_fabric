"use client";

import { useState } from "react";
import type { MedicalEpisode, MedicalPreparation, MedicalQuote } from "@/lib/fabric/medical";
import type { Claim, Policy } from "@/lib/fabric/types";
import type { WorkflowCommand } from "@/lib/workflows/commands";
import type { PreparedWorkflow } from "@/components/guided-workflow-form";

type Intake = { episodes: MedicalEpisode[]; policies?: Policy[]; claims?: Claim[] };
const money = (minor: number) => "BDT " + (minor / 100).toFixed(2);

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
    <h2>{insurer ? "Episode association queue" : "Your medical episodes"}</h2>
    <button type="button" className="secondary button" disabled={busy} onClick={() => run(async () => {
      setIntake(await json<Intake>("/api/medical/intake")); resetDraft();
    })}>Refresh episodes</button>
    {intake && insurer && <ul>{intake.episodes.map(row => <li key={row.id}>
      <p>{row.hospitalId} · {row.service} · {row.serviceDate || "Service date to confirm"} · {row.associationStatus}</p>
      <small>Patient reference fingerprint: {row.patientReferenceHash}</small>
      <button type="button" className="secondary button" onClick={() => onAssociation({ revision: Date.now(), command: {
        operation: "verifyMedicalAssociation", episodeId: row.id, revision: row.revision, beneficiaryId: row.beneficiaryId,
      } })}>{row.associationStatus === "VERIFIED" ? "Review association" : "Resolve association"}</button>
    </li>)}</ul>}
    {intake && !insurer && <div className="guidedForm">
      <label>Medical policy<select disabled={busy} value={policyId} onChange={event => { setPolicyId(event.target.value); resetDraft(); }}>
        <option value="">Choose a policy</option>
        {intake.policies?.map(policy => <option key={policy.id} value={policy.id}>{policy.id} · {policy.status} · paid through {policy.paidThroughDate || "no paid days"}</option>)}
      </select></label>
      <label>Verified episode<select disabled={busy} value={episodeId} onChange={event => { setEpisodeId(event.target.value); resetDraft(); }}>
        <option value="">Choose an episode</option>
        {intake.episodes.map(row => <option key={row.id} value={row.id}>{row.hospitalId} · {row.service} · {row.serviceDate || "date unresolved"}</option>)}
      </select></label>
      {!intake.episodes.length && <p>No verified episodes are available yet. The insurer can check an outstanding association.</p>}
      {episode && <div className="wideField">
        <p>Revision {episode.revision} · {episode.service} · {money(episode.billMinor)} · {episode.admissionDate} to {episode.dischargeDate}</p>
        {!episode.serviceDate && <p>Ask the insurer to confirm the documented service date before filing.</p>}
        {existing && <p>Claim {existing.id}, version {existing.version} · {existing.status}</p>}
        {(!existing || correction) && <button className="secondary button" disabled={busy || (!existing && !policyId) || !episode.serviceDate} onClick={() => run(prepare)}>{correction ? "Review corrected reimbursement" : "Prepare claim and calculate reimbursement"}</button>}
      </div>}
      {draft && <div className="wideField">
        <h3>Insurer reimbursement statement</h3>
        <p>Billed {money(draft.quote.billedMinor)} · Eligible {money(draft.quote.eligibleMinor)} · Deductible {money(draft.quote.deductibleMinor)} · Insurer share {money(draft.quote.insurerShareMinor)} · Remaining cover {money(draft.quote.remainingCoverMinor)}.</p>
        <p><strong>Payable {money(draft.quote.payableMinor)}</strong></p>
        <p>Filing deadline {draft.quote.filingDeadline} (Asia/Dhaka). Preparation does not extend it.</p>
        {!correction && draft.deadlineSoon && <p role="alert">The filing deadline is within two days. Submit before it closes.</p>}
        {draft.receipt && <p>Preparation receipt {draft.receipt.id} recorded {draft.receipt.preparedAt}.</p>}
        <button className="primary button" disabled={busy || (!correction && draft.quote.payableMinor <= 0)} onClick={() => run(submit)}>{correction ? "Reconfirm this correction" : "Accept statement and submit claim"}</button>
      </div>}
    </div>}
    <p role="status">{status}</p>
  </article>;
}
