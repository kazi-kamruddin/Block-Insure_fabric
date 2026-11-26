"use client";

import { useEffect, useState } from "react";
import type { OracleRegistrySnapshot } from "@/lib/fabric/types";
import { verifyRegistryManifest, type RegistryManifest } from "@/lib/oracle/registry-manifest";
import { formatBdt } from "@/lib/money";

type CheckedManifest = {
  manifest: RegistryManifest;
  root: string;
  canAttest: boolean;
  proposedRoot: string;
  comparisonUnavailable: boolean;
};

export function MedicalRegistryControls({ role }: { role: "insurerAdmin" | "hospitalOfficer" }) {
  // The dev-lite demo has one medical partner hospital (Dhaka Central Medical Hospital).
  const [hospitalId, setHospitalId] = useState("hospital-demo");
  const [snapshots, setSnapshots] = useState<OracleRegistrySnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [checked, setChecked] = useState<Record<string, CheckedManifest>>({});
  const [sourceCheck, setSourceCheck] = useState<{ hospitalId: string; incompleteCount: number | null }>();
  const [sourceRefresh, setSourceRefresh] = useState(0);

  useEffect(() => {
    const selected = hospitalId.trim();
    if (role !== "insurerAdmin" || !/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(selected)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/medical/registry?" + new URLSearchParams({ checkSources: selected }), {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Source check unavailable");
        const { incompleteCount } = await response.json();
        if (!controller.signal.aborted) setSourceCheck({ hospitalId: selected, incompleteCount });
      } catch {
        if (!controller.signal.aborted) setSourceCheck({ hospitalId: selected, incompleteCount: null });
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [hospitalId, role, sourceRefresh]);
  // Proposals awaiting attestation first, then the newest snapshot; older ones on request.
  const version = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
  const ordered = [...snapshots].sort((left, right) => Number(right.status === "PROPOSED") - Number(left.status === "PROPOSED")
    || version(right.id) - version(left.id) || right.id.localeCompare(left.id));
  const pending = ordered.filter(snapshot => snapshot.status === "PROPOSED").length;
  const visible = showHistory ? ordered : ordered.slice(0, pending + 1);
  async function run(body?: Record<string, string>) {
    setBusy(true);
    setMessage("");
    try {
      if (body) {
        const response = await fetch("/api/medical/registry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
      }
      const response = await fetch("/api/medical/registry");
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setSnapshots(result.snapshots);
      setChecked({});
      if (role === "insurerAdmin") setSourceRefresh(value => value + 1);
      setMessage(body ? "Registry action confirmed." : "Registry refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registry unavailable");
    } finally {
      setBusy(false);
    }
  }
  async function reviewContents(snapshot: OracleRegistrySnapshot) {
    setBusy(true);
    setMessage("");
    setChecked(previous => {
      const next = { ...previous };
      delete next[snapshot.id];
      return next;
    });
    try {
      const response = await fetch("/api/medical/registry?" + new URLSearchParams({ manifest: snapshot.id }), { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      const manifest: RegistryManifest = body.manifest;
      const verification = await verifyRegistryManifest(manifest, snapshot.rootHash);
      setChecked(previous => ({ ...previous, [snapshot.id]: {
        manifest, comparisonUnavailable: body.comparisonUnavailable,
        proposedRoot: snapshot.rootHash, ...verification,
      } }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registry contents unavailable");
    } finally {
      setBusy(false);
    }
  }

  function manifestView(snapshot: OracleRegistrySnapshot) {
    const outcome = checked[snapshot.id];
    const diff = outcome?.manifest.diff;
    const incomplete = outcome?.manifest.snapshot.modelContext?.incompleteInvoiceIds ?? [];
    return <>
      <button type="button" className="secondary button" disabled={busy} onClick={() => void reviewContents(snapshot)}>Check proposed records</button>
      {outcome && <div className="medicalSubpanel">
        <p role="status">{outcome.canAttest ? "Recomputed root matches the proposal." : "Registry contents do not match the proposal root."}</p>
        {outcome.manifest.previousId && <p>Compared with {outcome.manifest.previousId}.</p>}
        {outcome.comparisonUnavailable && <p className="evidenceWarning">The previous attested manifest is unavailable for comparison.</p>}
        {diff && <dl>
          <dt>Added</dt><dd>{diff.added.join(", ") || "None"}</dd>
          <dt>Removed</dt><dd>{diff.removed.join(", ") || "None"}</dd>
          <dt>Changed or corrected</dt><dd>{diff.changed.length ? <ul>{diff.changed.map(row =>
            <li key={row.after}>{row.before === row.after ? row.after : `${row.before} → ${row.after}`}</li>)}</ul> : "None"}</dd>
          <dt>Incomplete</dt><dd className={incomplete.length ? "evidenceWarning" : undefined}>{incomplete.join(", ") || "None"}</dd>
        </dl>}
        <details><summary>Review {outcome.manifest.snapshot.records.length} submitted records</summary>
          <ul>{outcome.manifest.snapshot.records.map(record => <li key={record.invoiceId}>
            <strong>{record.invoiceId}</strong>
            <p>{record.status} · {record.validFrom} to {record.validThrough} · {formatBdt(record.maximumAmountMinor)}</p>
          </li>)}</ul>
        </details>
      </div>}
      <button type="button" className="primary button"
        disabled={busy || !outcome?.canAttest || outcome.proposedRoot !== snapshot.rootHash}
        onClick={() => { if (outcome?.canAttest) void run({ action: "attest", id: snapshot.id, rootHash: outcome.root }); }}>
        Attest this snapshot
      </button>
    </>;
  }
  return <article className="workCard workCardWide" id="medical-registry">
    <h2>Medical registry approvals</h2>
    {role === "insurerAdmin" && <>
      <button type="button" className="secondary button" disabled={busy} onClick={() => void run({ action: "activate" })}>Activate approval certificates</button>
      <form onSubmit={event => { event.preventDefault(); void run({ action: "propose", hospitalId }); }}>
        <label>Hospital ID<input required value={hospitalId} onChange={event => setHospitalId(event.target.value)} /></label>
        {sourceCheck?.hospitalId === hospitalId.trim() && (sourceCheck.incompleteCount === null
          ? <p className="evidenceWarning" role="status">Source completeness could not be checked.</p>
          : sourceCheck.incompleteCount > 0
            ? <p className="evidenceWarning" role="status">{sourceCheck.incompleteCount} incomplete medical sources at this hospital. Affected claims can go to auditor review.</p>
            : null)}
        <button type="submit" className="primary button" disabled={busy}>Propose registry snapshot</button>
      </form>
    </>}
    <button type="button" className="secondary button" disabled={busy} onClick={() => void run()}>Refresh registry proposals</button>
    <p role="status">{message}</p>
    {ordered.length > visible.length || showHistory ? <button type="button" className="secondary button" onClick={() => setShowHistory(value => !value)}>
      {showHistory ? "Hide older snapshots" : `Show ${ordered.length - visible.length} older snapshots`}</button> : null}
    <ul>{visible.map(snapshot => <li key={snapshot.id}>
      <strong>{snapshot.id} · {snapshot.hospitalId} · {snapshot.status}</strong>
      <p>Rules {snapshot.rulesVersion} · {snapshot.recordCount} records</p>
      <p><code>{snapshot.rootHash}</code></p>
      {role === "hospitalOfficer" && snapshot.status === "PROPOSED" && manifestView(snapshot)}
    </li>)}</ul>
  </article>;
}
