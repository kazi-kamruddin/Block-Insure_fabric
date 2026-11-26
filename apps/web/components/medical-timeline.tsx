"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { OracleExplanation } from "@/components/oracle-explanation";
import type { MedicalTimeline as Timeline } from "@/lib/fabric/medical-timeline";
import { formatBdt } from "@/lib/money";

function Approval({ approval }: { approval: NonNullable<Timeline["approval"]> }) {
  return <div>
    <strong>Approval certificate</strong>
    <p>{approval.path === "PANEL" ? "Panel approval" : "Oracle approval"}</p>
    <code className="medicalTimelineId">{approval.hash}</code>
  </div>;
}

function Payout({ payout }: { payout: NonNullable<Timeline["payout"]> }) {
  return <div>
    <strong>Bank payout</strong> <StatusBadge status={payout.status} />
    <p>{formatBdt(payout.amountMinor)} · <code className="medicalTimelineId">{payout.id}</code></p>
    {payout.failureCode && <p>Payment failure code <code>{payout.failureCode}</code></p>}
    {payout.status === "CONFIRMED" && <p>Transfer <code className="medicalTimelineId">{payout.transferId}</code>{payout.confirmedAt && <> · <time dateTime={payout.confirmedAt}>{payout.confirmedAt}</time></>}</p>}
  </div>;
}

export function MedicalTimeline({ timeline }: { timeline: Timeline }) {
  return <section className="quorumCard medicalTimeline" aria-label="Medical claim timeline">
    <h3>Medical claim timeline</h3>
    <p><strong>Next action</strong> · {timeline.nextAction}</p>
    {timeline.referrals.length > 0 && <div>
      <strong>Reasons for panel review</strong>
      <ul>{timeline.referrals.map(reason => <li key={reason}>{reason}</li>)}</ul>
    </div>}
    {timeline.oracle && <div>
      <strong>Pinned Oracle inputs</strong>
      {timeline.oracle.finalizationCode && <> <StatusBadge status={timeline.oracle.finalizationCode} /></>}
      <p>Registry <code className="medicalTimelineId">{timeline.oracle.snapshotId}</code></p>
      <p>Model <code className="medicalTimelineId">{timeline.oracle.modelVersion}</code></p>
      <code className="medicalTimelineId">{timeline.oracle.modelHash}</code>
      {timeline.oracle.modelVersion === "fabric-xgb-synthetic-v1" &&
        ["EXACT_CONSENSUS", "NEGATIVE_RESULT"].includes(timeline.oracle.finalizationCode) &&
        <OracleExplanation key={timeline.oracle.requestId} requestId={timeline.oracle.requestId} />}
    </div>}
    {timeline.approval && <Approval approval={timeline.approval} />}
    {timeline.payout && <Payout payout={timeline.payout} />}
    {timeline.milestones.length > 0 && <details>
      <summary>Ledger milestones</summary>
      <ol>{timeline.milestones.map(({ label, at }) => <li key={label}>{label} · <time dateTime={at}>{at}</time></li>)}</ol>
    </details>}
  </section>;
}

type BankView = {
  claimId: string; claimVersion: number;
  approval: NonNullable<Timeline["approval"]>; payout: NonNullable<Timeline["payout"]>;
};

export function MedicalSettlementTimeline() {
  const [id, setId] = useState("");
  const [view, setView] = useState<BankView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    setView(undefined);
    try {
      const response = await fetch("/api/medical/settlement?" + new URLSearchParams({ settlement: id.trim() }), { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setView(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the medical settlement.");
    } finally {
      setBusy(false);
    }
  }

  return <article className="workCard workCardWide" aria-label="Medical settlement timeline">
    <h2>Medical settlement timeline</h2>
    <form className="auditExport" onSubmit={event => { event.preventDefault(); void load(); }}>
      <label>Medical settlement ID<input value={id} disabled={busy} spellCheck={false} autoComplete="off"
        onChange={event => { setId(event.target.value); setView(undefined); setError(""); }} /></label>
      <button className="primary button" disabled={busy || !id.trim()} aria-busy={busy}>Load medical settlement</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {view && <section className="quorumCard medicalTimeline" aria-label="Medical settlement result">
      <p>Claim version {view.claimVersion} · <code className="medicalTimelineId">{view.claimId}</code></p>
      <p><strong>Next action</strong> · {view.payout.status === "CONFIRMED" ? "Payout complete."
        : view.payout.status === "PAYMENT_FAILED" ? "Bank resolves the payment failure and retries confirmation." : "Bank confirms the payout."}</p>
      <Approval approval={view.approval} />
      <Payout payout={view.payout} />
    </section>}
  </article>;
}
