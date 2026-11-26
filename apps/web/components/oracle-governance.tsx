"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { oracleGovernanceActions, type GovernanceAction, type GovernanceRole, type GovernanceView } from "@/lib/fabric/oracle-governance";

const endpoint = "/api/medical/oracle-governance";

export function OracleGovernance({ role, fallback }: { role: GovernanceRole; fallback?: ReactNode }) {
  const [data, setData] = useState<GovernanceView>();
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<GovernanceAction>(role === "hospitalOfficer" ? "AnchorSourceFeed" : role === "auditor" ? "ApproveSourceIssuer" : "ProposeSourceIssuer");
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal }).then(async response => {
      if (response.ok) setData(await response.json() as GovernanceView);
    }).catch(() => undefined);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  if (!data?.supported) return fallback ?? null;

  const allowed = Object.entries(oracleGovernanceActions).filter(([, entry]) => (entry.roles as GovernanceRole[]).includes(role));
  const selected = oracleGovernanceActions[action];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const args = selected.fields.map(({ name }) => String(values.get(name) ?? ""));
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, args }) });
      const body = await response.json();
      if (!response.ok) { setMessage(body.message ?? "Action could not be confirmed"); return; }
      setMessage("Ledger action confirmed.");
      const refreshed = await fetch(endpoint);
      if (refreshed.ok) setData(await refreshed.json() as GovernanceView);
    } catch { setMessage("Could not reach source governance."); }
    finally { setBusy(false); }
  }
  return <section className="workCard workCardWide">
    <h2>{role === "hospitalOfficer" ? "Anchor your own signed feed" : "Oracle source and release governance"}</h2>
    <h3>Issuer keys</h3>
    {data.issuers.length ? <ul>{data.issuers.map(issuer => <li key={`${issuer.issuerId}:${issuer.keyVersion}`}>
      {issuer.issuerId} · {issuer.kind} · key {issuer.keyVersion} · {issuer.status} · {issuer.approvedMsps?.join(", ")}
    </li>)}</ul> : <p>No issuer keys registered.</p>}
    <h3>Anchored feeds</h3>
    {data.feeds.length ? <ul>{data.feeds.map(feed => <li key={`${feed.issuerId}:${feed.feedVersion}`}>{feed.issuerId} · version {feed.feedVersion} · {feed.root}</li>)}</ul>
      : <p>No feeds anchored.</p>}
    {role !== "hospitalOfficer" && <>
      <h3>Oracle rosters</h3>
      {data.rosters.length ? <ul>{data.rosters.map(row => <li key={row.version}>{row.version} · {row.status} · {row.subjects?.map(subject => subject.subjectId).join(", ")}</li>)}</ul>
        : <p>No roster proposed.</p>}
      <h3>Model releases</h3>
      {data.releases.length ? <ul>{data.releases.map(row => {
        const eligibleAt = Date.parse(row.activationEligibleAt ?? "");
        const remainingSeconds = Number.isFinite(eligibleAt) && clock ? Math.max(0, Math.ceil((eligibleAt - clock) / 1000)) : null;
        return <li key={row.id}>{row.id} · {row.modelVersion} · {row.status}
          {row.status === "APPROVED" && remainingSeconds !== null && (remainingSeconds ? ` · Activation in ${remainingSeconds} s` : " · Activation window open")}
        </li>;
      })}</ul> : <p>No model release registered.</p>}
    </>}
    <form onSubmit={submit} className="workflowForm">
      <label>Governance action<select value={action} onChange={event => setAction(event.target.value as GovernanceAction)} disabled={busy}>
        {allowed.map(([name, entry]) => <option key={name} value={name}>{entry.label}</option>)}
      </select></label>
      <div key={action} className="medicalButtonGroup">{selected.fields.map(field => <label key={field.name}>{field.label}
        {"type" in field && field.type === "json" ? <textarea name={field.name} maxLength={4096} required /> :
          <input name={field.name} maxLength={4096} required={!("optional" in field && field.optional)}
            inputMode={"type" in field && field.type === "number" ? "numeric" : "text"} />}
      </label>)}</div>
      <button type="submit" disabled={busy} className="secondary button">{selected.label}</button>
    </form>
    <p role="status">{message}</p>
  </section>;
}
