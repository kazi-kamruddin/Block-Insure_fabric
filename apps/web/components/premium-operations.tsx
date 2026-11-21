"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import type { Policy, PremiumCollection } from "@/lib/fabric/types";
import { dhakaToday, formatBdt, premiumStanding } from "@/lib/banking/premium-schedule";
import { postWorkflow, readJson, textHash } from "@/lib/banking/client";

const maxAttempts = 3;

async function fetchRecords() {
  const [collections, policies] = await Promise.all([
    readJson<{ result: PremiumCollection[] }>(await fetch("/api/ledger/collection", { cache: "no-store" })),
    readJson<{ result: Policy[] }>(await fetch("/api/ledger/policy", { cache: "no-store" })),
  ]);
  return { collections: collections.result, policies: policies.result };
}

export function PremiumOperations() {
  const [collections, setCollections] = useState<PremiumCollection[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const today = dhakaToday();

  function show(records: Awaited<ReturnType<typeof fetchRecords>>) {
    setCollections(records.collections);
    setPolicies(records.policies);
  }
  const load = async () => show(await fetchRecords());
  useEffect(() => {
    let active = true;
    fetchRecords().then((records) => { if (active) show(records); })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "Premium records are unavailable"); });
    return () => { active = false; };
  }, []);

  async function act(label: (result: unknown) => string, task: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const result = await task();
      await load();
      setMessage(label(result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action failed");
    } finally {
      setBusy(false);
    }
  }

  const open = collections.filter((item) => item.status !== "COMPLETED" && item.status !== "SUPERSEDED").sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  const overdue = policies.filter((policy) => ["ACTIVE", "GRACE"].includes(policy.status) && policy.nextPremiumDueDate && policy.nextPremiumDueDate <= today);
  // Medical policies whose grace period has ended can only return through reinstatement.
  const reinstatable = policies.filter((policy) => policy.medicalRulesVersion && today <= policy.endDate &&
    ["ACTIVE", "GRACE", "LAPSED"].includes(policy.status) && !premiumStanding(policy, today).canPay)
    .sort((left, right) => (left.nextPremiumDueDate ?? "").localeCompare(right.nextPremiumDueDate ?? ""));

  return <article className="workCard workCardWide" id="premium-operations" aria-label="Premium operations">
    <span className="kicker">Premium operations</span>
    <h2>Premium collections and policy status</h2>
    <p className="cardNote">Ledger business date {today} (Asia/Dhaka). The chaincode refuses any later date, so premiums cannot be collected early and policies cannot be lapsed ahead of time.</p>
    {message && <p className="evidenceWarning" role="status">{message}</p>}
    <div className="evidenceActions">
      <button type="button" className="primary button" disabled={busy} onClick={() => void act(
        (result) => `${Array.isArray(result) ? result.length : 0} collection(s) scheduled for mandates due by ${today}.`,
        () => postWorkflow({ operation: "schedulePremiumCollections", asOfDate: today }))}>Schedule due EFT collections</button>
      <button type="button" className="secondary button" disabled={busy} onClick={() => void act(() => "Refreshed from the ledger.", async () => undefined)}>Refresh</button>
    </div>

    <h3>Open collections</h3>
    {open.length === 0 && <p>Every scheduled collection is complete.</p>}
    {open.map((collection) => <div className="queueItem" key={collection.id}>
      <div><div className="queueTitle"><strong>{collection.policyId} · {formatBdt(collection.amountMinor)} due {collection.dueDate}</strong><StatusBadge status={collection.status} /></div>
        <p>{collection.id} · attempts {collection.attemptCount}/{maxAttempts}{collection.failureCode ? ` · ${collection.failureCode.replaceAll("_", " ").toLowerCase()}` : ""}</p></div>
      {collection.status === "BOUNCED" && <button type="button" className="secondary button" disabled={busy || collection.attemptCount >= maxAttempts}
        onClick={() => void act(() => "Retry queued. The Bank collects it on its next run.", () => postWorkflow({ operation: "retryPremiumCollection", collectionId: collection.id }))}>
        {collection.attemptCount >= maxAttempts ? "No retries left" : "Retry collection"}</button>}
    </div>)}

    <h3>Policies past their due date</h3>
    {overdue.length === 0 && <p>No active policy is past its premium due date.</p>}
    {overdue.map((policy) => <div className="queueItem" key={policy.id}>
      <div><div className="queueTitle"><strong>{policy.id} · due {policy.nextPremiumDueDate}</strong><StatusBadge status={policy.status} /></div>
        <p>{policy.policyholderId} · paid through {policy.paidThroughDate || "—"} · {policy.gracePeriodDays ?? 15}-day grace period</p></div>
      <button type="button" className="secondary button" disabled={busy} onClick={() => void act(
        (result) => `Policy is now ${(result as Policy | undefined)?.status ?? "unchanged"}.`,
        () => postWorkflow({ operation: "advancePolicyLifecycle", id: policy.id, asOfDate: today }))}>Check grace and lapse</button>
    </div>)}

    <h3>Lapsed medical policies</h3>
    <p className="cardNote">Reinstatement starts a new installment today. The customer must pay it today; the lapse gap stays uncovered and waiting periods restart.</p>
    {reinstatable.length === 0 && <p>No medical policy is waiting for reinstatement.</p>}
    {reinstatable.map((policy) => <div className="queueItem" key={policy.id}>
      <div><div className="queueTitle"><strong>{policy.id} · paid through {policy.paidThroughDate || "—"}</strong><StatusBadge status={policy.status} /></div>
        <p>{policy.policyholderId} · {formatBdt(policy.premiumMinor)} per installment{policy.reinstatedDate ? ` · last reinstated ${policy.reinstatedDate}` : ""}</p></div>
      <button type="button" className="secondary button" disabled={busy} onClick={() => void act(
        () => "Reinstatement offered for today. The customer can now pay today's installment.",
        async () => postWorkflow({ operation: "reinstatePolicy", id: policy.id, reasonHash: await textHash(`reinstate ${policy.id} ${today}`) }))}>Reinstate from today</button>
    </div>)}
  </article>;
}
