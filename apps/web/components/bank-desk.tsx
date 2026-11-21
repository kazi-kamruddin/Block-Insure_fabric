"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import type { BankAccountLinkRequest, BankMandate, PremiumCollection } from "@/lib/fabric/types";
import { formatBdt } from "@/lib/banking/premium-schedule";
import { postWorkflow, randomToken, readJson, shortId, textHash } from "@/lib/banking/client";
import { bdtToMinor, nonNegativeBdtToMinor } from "@/lib/workflows/forms";

type AccountDisplay = { id: string; ownerId: string; accountLabel: string; maskedAccount: string; balanceMinor: number } | null;
type DeskView = {
  links: BankAccountLinkRequest[];
  mandates: (BankMandate & { account: AccountDisplay })[];
  collections: (PremiumCollection & { account: AccountDisplay })[];
};

async function fetchDesk() {
  return readJson<DeskView>(await fetch("/api/banking/bank-desk", { cache: "no-store" }));
}

export function BankDesk() {
  const [view, setView] = useState<DeskView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [funding, setFunding] = useState<Record<string, string>>({});

  const load = async () => setView(await fetchDesk());
  useEffect(() => {
    let active = true;
    fetchDesk().then((next) => { if (active) setView(next); })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "The Bank work queue is unavailable"); });
    return () => { active = false; };
  }, []);

  async function act(label: string, task: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await task();
      await load();
      setMessage(label);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action failed");
    } finally {
      setBusy(false);
    }
  }

  const decision = (kind: string, id: string, outcome: string) => textHash(`${kind}:${id}:${outcome}:${new Date().toISOString()}`);

  return <article className="workCard workCardWide" id="bank-desk" aria-label="Bank work queue">
    <span className="kicker">Bank operations</span>
    <h2>Bank work queue</h2>
    <p className="cardNote">Verify customer accounts, approve EFT mandates and collect due premiums. The Bank sees accounts and amounts, never medical facts.</p>
    {message && <p className="evidenceWarning" role="status">{message}</p>}

    <h3>Account link requests</h3>
    {view?.links.length === 0 && <p>No pending link requests.</p>}
    {view?.links.map((link) => <div className="queueItem" key={link.id}>
      <div><div className="queueTitle"><strong>{link.ownerId} · {link.accountLabel} · {link.maskedAccount}</strong><StatusBadge status={link.status} /></div>
        <p>{link.bankId} · {link.id}</p>
        <label>Verified balance (BDT)<input inputMode="decimal" value={balances[link.id] ?? "25000.00"} onChange={(event) => setBalances({ ...balances, [link.id]: event.target.value })} /></label>
      </div>
      <div className="evidenceActions">
        <button type="button" className="primary button" disabled={busy} onClick={() => void act(`Account ${link.maskedAccount} linked for ${link.ownerId}.`, async () => postWorkflow({
          operation: "reviewBankAccountLink", id: link.id, outcome: "APPROVE", accountReferenceId: shortId("account"),
          // The demo Bank has no core system, so a random vault token stands in for the real account number.
          accountTokenHash: await textHash(randomToken("vault")),
          openingBalanceMinor: nonNegativeBdtToMinor(balances[link.id] ?? "25000.00"),
          decisionHash: await decision("bank-link", link.id, "APPROVE"),
        }))}>Verify and link</button>
        <button type="button" className="secondary button" disabled={busy} onClick={() => void act("Link request rejected.", async () => postWorkflow({
          operation: "reviewBankAccountLink", id: link.id, outcome: "REJECT", accountReferenceId: "", accountTokenHash: "", openingBalanceMinor: 0,
          decisionHash: await decision("bank-link", link.id, "REJECT"),
        }))}>Reject</button>
      </div>
    </div>)}

    <h3>EFT mandates to review</h3>
    {view?.mandates.length === 0 && <p>No pending mandates.</p>}
    {view?.mandates.map((mandate) => <div className="queueItem" key={mandate.id}>
      <div><div className="queueTitle"><strong>{mandate.ownerId} · {formatBdt(mandate.amountMinor)} every {mandate.intervalDays} days</strong><StatusBadge status={mandate.status} /></div>
        <p>From {mandate.account ? `${mandate.account.accountLabel} ${mandate.account.maskedAccount} (${formatBdt(mandate.account.balanceMinor)})` : mandate.accountReferenceId} · first debit {mandate.nextDebitDate} · until {mandate.expiryDate}</p></div>
      <div className="evidenceActions">
        <button type="button" className="primary button" disabled={busy} onClick={() => void act("Mandate approved.", async () => postWorkflow({
          operation: "reviewBankMandate", id: mandate.id, outcome: "APPROVE", decisionHash: await decision("mandate", mandate.id, "APPROVE") }))}>Approve mandate</button>
        <button type="button" className="secondary button" disabled={busy} onClick={() => void act("Mandate rejected.", async () => postWorkflow({
          operation: "reviewBankMandate", id: mandate.id, outcome: "REJECT", decisionHash: await decision("mandate", mandate.id, "REJECT") }))}>Reject</button>
      </div>
    </div>)}

    <h3>Premium collections</h3>
    {view?.collections.length === 0 && <p>No collection is due. The Insurer schedules collections on their due date.</p>}
    {view?.collections.map((collection) => <div className="queueItem" key={collection.id}>
      <div><div className="queueTitle"><strong>{formatBdt(collection.amountMinor)} due {collection.dueDate}</strong><StatusBadge status={collection.status} /></div>
        <p>{collection.account ? `${collection.account.ownerId} · ${collection.account.accountLabel} ${collection.account.maskedAccount} · balance ${formatBdt(collection.account.balanceMinor)}` : collection.mandateId} · attempts {collection.attemptCount}{collection.failureCode ? ` · ${collection.failureCode.replaceAll("_", " ").toLowerCase()}` : ""}</p>
        {collection.status === "BOUNCED" && <p>The Insurer decides whether to retry. The customer can also deposit money first.</p>}
      </div>
      <div className="evidenceActions">
        {collection.status !== "BOUNCED" && <button type="button" className="primary button" disabled={busy}
          onClick={() => void act("Collection processed. The outcome depends on the account balance.", async () => readJson(await fetch("/api/banking/bank-desk", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "processCollection", collectionId: collection.id }),
          })))}>Collect premium</button>}
        {collection.account && <>
          <label>Deposit (BDT)<input inputMode="decimal" value={funding[collection.id] ?? (collection.amountMinor / 100).toFixed(2)} onChange={(event) => setFunding({ ...funding, [collection.id]: event.target.value })} /></label>
          <button type="button" className="secondary button" disabled={busy} onClick={() => void act("Deposit recorded.", async () => {
            const reference = randomToken("deposit");
            return postWorkflow({ operation: "adjustBankAccountBalance", transferId: shortId("deposit"), accountId: collection.account!.id,
              direction: "CREDIT", amountMinor: bdtToMinor(funding[collection.id] ?? (collection.amountMinor / 100).toFixed(2)), externalReferenceHash: await textHash(reference) });
          })}>Record customer deposit</button>
        </>}
      </div>
    </div>)}
    <div className="evidenceActions"><button type="button" className="secondary button" disabled={busy} onClick={() => void act("Refreshed from the ledger.", async () => undefined)}>Refresh</button></div>
  </article>;
}
