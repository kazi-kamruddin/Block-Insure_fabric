"use client";

import { useState } from "react";
import type { OracleRegistrySnapshot } from "@/lib/fabric/types";

export function MedicalRegistryControls({ role }: { role: "insurerAdmin" | "hospitalOfficer" }) {
  // The dev-lite demo has one medical partner hospital (Dhaka Central Medical Hospital).
  const [hospitalId, setHospitalId] = useState("hospital-demo");
  const [snapshots, setSnapshots] = useState<OracleRegistrySnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showHistory, setShowHistory] = useState(false);
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
      setMessage(body ? "Registry action confirmed." : "Registry refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registry unavailable");
    } finally {
      setBusy(false);
    }
  }
  return <article className="workCard workCardWide" id="medical-registry">
    <h2>Medical registry approvals</h2>
    {role === "insurerAdmin" && <>
      <button type="button" className="secondary button" disabled={busy} onClick={() => void run({ action: "activate" })}>Activate approval certificates</button>
      <form onSubmit={event => { event.preventDefault(); void run({ action: "propose", hospitalId }); }}>
        <label>Hospital ID<input required value={hospitalId} onChange={event => setHospitalId(event.target.value)} /></label>
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
      {role === "hospitalOfficer" && snapshot.status === "PROPOSED" &&
        <button type="button" className="primary button" disabled={busy} onClick={() => void run({ action: "attest", id: snapshot.id, rootHash: snapshot.rootHash })}>Attest this snapshot</button>}
    </li>)}</ul>
  </article>;
}
