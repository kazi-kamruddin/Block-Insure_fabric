"use client";

import { useState, type FormEvent } from "react";
import { sha256Hex } from "@/lib/evidence/browser-crypto";
import { canonicalProtocolInput } from "@/lib/fabric/canonical-protocol";

type Period = {
  id: string; status: string; startsAt: string; endsAt: string; graceEndsAt?: string; rateBps: number; panelLoad?: number;
  shares?: Array<{ msp: string; revealed: boolean }>;
};

export function MedicalAuditPeriod({ organization, canCreate }: { organization: string; canCreate: boolean }) {
  const [id, setId] = useState("");
  const [period, setPeriod] = useState<Period>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [heldClaim, setHeldClaim] = useState("");
  const endpoint = "/api/medical/audit-period";
  const storageKey = `block-insure:audit-share:${organization}:${id.trim()}`;
  async function read() {
    const response = await fetch(endpoint + "?" + new URLSearchParams({ id: id.trim() }), { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message);
    setPeriod(body.period);
  }
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try { await operation(); } catch (error) { setStatus(error instanceof Error ? error.message : "The action could not be confirmed."); }
    finally { setBusy(false); }
  }
  async function write(action: string, fields: Record<string, string | number> = {}) {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id: id.trim(), ...fields }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message);
    setStatus("Action confirmed.");
    await read();
  }
  async function resolveHeld() {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resolve", id: heldClaim.trim() }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message);
    setStatus("Audit selection resolved. Open the claim to see whether it was sampled for the panel.");
  }
  async function commit() {
    let share = localStorage.getItem(storageKey);
    if (!share) {
      share = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(storageKey, share);
    }
    const commitment = await sha256Hex(new TextEncoder().encode(canonicalProtocolInput("fabric-medical-audit-share-v2", id.trim(), organization, share)));
    await write("commit", { value: commitment });
  }
  async function reveal() {
    const share = localStorage.getItem(storageKey);
    if (!share) throw new Error("This browser has no saved share for the period.");
    await write("reveal", { value: share });
    localStorage.removeItem(storageKey);
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => write("create", { start: new Date(String(data.get("start"))).toISOString(), end: new Date(String(data.get("end"))).toISOString(),
      rateBps: Number(data.get("rate")), graceSeconds: Number(data.get("grace")) * 60 }));
  }
  const mine = period?.shares?.find(share => share.msp === organization);
  return <details className="workCard">
    <summary>Medical audit sampling</summary>
    <label>Audit period ID<input value={id} onChange={event => { setId(event.target.value); setPeriod(undefined); }} /></label>
    <button type="button" className="secondary button" disabled={busy || !id.trim()} onClick={() => run(read)}>Read period</button>
    {canCreate && <form className="medicalSubpanel" onSubmit={create}>
      <label>Start (local time)<input type="datetime-local" name="start" required /></label>
      <label>End (local time)<input type="datetime-local" name="end" required /></label>
      <label>Sample rate in basis points<input type="number" name="rate" min={1} max={10000} required /></label>
      <label>Reveal grace in minutes<input type="number" name="grace" min={1} max={10080} required /></label>
      <button className="primary button" disabled={busy || !id.trim()}>Propose period</button>
    </form>}
    {canCreate && <div className="medicalSubpanel">
      <p>After the reveal deadline, resolve each held claim. A sampled or defaulted claim goes to panel preparation; the rest continue to settlement.</p>
      <label>Held claim ID<input value={heldClaim} onChange={event => setHeldClaim(event.target.value)} /></label>
      <button type="button" className="secondary button" disabled={busy || !heldClaim.trim()} onClick={() => run(resolveHeld)}>Resolve audit selection</button>
    </div>}
    {period && <>
      <p>{period.status} · {period.rateBps / 100}% sample · Ends {period.endsAt}</p>
      <p>Reveal deadline {period.graceEndsAt} · Defaulted panel referrals {period.panelLoad ?? 0}</p>
      <p>{period.shares?.length ?? 0} of 3 commitments. {period.shares?.filter(row => row.revealed).length ?? 0} of 3 reveals.</p>
      <p>Reveal your share from the same browser. If any party misses the deadline, all eligible claims go to the panel.</p>
      {period.status === "PROPOSED" && !mine && <button type="button" className="primary button" disabled={busy} onClick={() => run(commit)}>Commit seed share</button>}
      {period.status === "PROPOSED" && period.shares?.length === 3 && <button type="button" className="secondary button" disabled={busy} onClick={() => run(() => write("open"))}>Open period and freeze claim versions</button>}
      {period.status === "OPEN" && mine && !mine.revealed && <button type="button" className="primary button" disabled={busy} onClick={() => run(reveal)}>Reveal seed share</button>}
      {["OPEN", "PROPOSED"].includes(period.status) && <button type="button" className="secondary button" disabled={busy} onClick={() => run(() => write("finalize"))}>Finalize audit period</button>}
    </>}
    <p role="status">{status}</p>
  </details>;
}
