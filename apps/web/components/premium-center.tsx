"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import type { BankAccountLinkRequest, BankAccountReference, BankMandate, PremiumCollection } from "@/lib/fabric/types";
import { formatBdt, maskAccountNumber } from "@/lib/banking/premium-schedule";
import { postWorkflow, readJson, shortId } from "@/lib/banking/client";

type CenterPolicy = {
  id: string; packageId: string; status: string; createdAt: string; startDate: string; endDate: string; premiumMinor: number;
  paidThroughDate: string; nextPremiumDueDate: string; bankIds: string[];
  nextInstallment: { start: string; end: string; amountMinor: number } | null;
  coverStartDate: string; reinstatedDate: string; standing: { canPay: boolean; note: string };
  insurerAccount: { id: string; bankId: string; accountLabel: string; maskedAccount: string } | null;
};
type CenterView = {
  banks: { id: string; name: string }[];
  accounts: Omit<BankAccountReference, "accountTokenHash">[];
  links: BankAccountLinkRequest[];
  policies: CenterPolicy[];
  mandates: BankMandate[];
  collections: PremiumCollection[];
};
export type PreparedPremiumPayment = {
  policyId: string; sourceAccountId: string; destinationAccountId: string; transferId: string; paymentId: string;
  periodStartDate: string; periodEndDate: string; amountBdt: string; externalReference: string;
};

async function fetchCenter() {
  return readJson<CenterView>(await fetch("/api/banking/premium-center", { cache: "no-store" }));
}

export function PremiumCenter({ onPreparePayment }: { onPreparePayment: (payment: PreparedPremiumPayment) => void }) {
  const [view, setView] = useState<CenterView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [link, setLink] = useState({ bankId: "", accountLabel: "", lastDigits: "" });
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  function show(next: CenterView) {
    setView(next);
    setLink((current) => current.bankId ? current : { ...current, bankId: next.banks[0]?.id ?? "" });
  }
  const load = async () => show(await fetchCenter());

  useEffect(() => {
    let active = true;
    fetchCenter().then((next) => { if (active) show(next); })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "Premium details are unavailable"); });
    const changed = () => {
      fetchCenter().then((next) => { if (active) { show(next); setMessage("Policies and balances updated from the ledger."); } }).catch(() => undefined);
    };
    window.addEventListener("block-insure:coverage-changed", changed);
    return () => { active = false; window.removeEventListener("block-insure:coverage-changed", changed); };
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

  const accountsFor = (policy: CenterPolicy) => (view?.accounts ?? []).filter((account) => account.status === "VERIFIED" && policy.bankIds.includes(account.bankId));
  const selectedAccount = (policy: CenterPolicy) => choice[policy.id] || accountsFor(policy)[0]?.id || "";
  // Demo ledgers accumulate many rehearsal records; show the newest first.
  const limit = showAll ? Number.POSITIVE_INFINITY : 4;
  const hidden = Math.max(0, (view?.accounts.length ?? 0) - 4) + Math.max(0, (view?.policies.length ?? 0) - 4);

  return <article className="workCard workCardWide" id="premium-center" aria-label="My bank and premiums">
    <h2>My bank and premiums</h2>
    <p className="cardNote">Pay each premium from a linked account with a one-time code, or let the Bank collect it automatically.</p>
    {message && <p className="evidenceWarning" role="status">{message}</p>}

    <h3>Linked bank accounts</h3>
    {view && view.accounts.length === 0 && <p>No linked account yet. Ask your Bank to link one below.</p>}
    {view?.accounts.slice(0, limit).map((account) => <div className="queueItem" key={account.id}>
      <div><div className="queueTitle"><strong>{account.accountLabel} · {account.maskedAccount}</strong><StatusBadge status={account.status} /></div>
        <p>{account.bankId} · balance {formatBdt(account.balanceMinor)} · {account.id}</p></div>
    </div>)}
    {view?.links.filter((item) => item.status !== "LINKED").slice(0, limit).map((item) => <div className="queueItem" key={item.id}>
      <div><div className="queueTitle"><strong>Link request · {item.accountLabel} · {item.maskedAccount}</strong><StatusBadge status={item.status} /></div><p>{item.bankId} · {item.id}</p></div>
      {item.status === "PENDING" && <button type="button" className="secondary button" disabled={busy}
        onClick={() => void act("Link request cancelled.", () => postWorkflow({ operation: "cancelBankAccountLink", id: item.id }))}>Cancel request</button>}
    </div>)}
    <form className="evidenceFields" onSubmit={(event) => {
      event.preventDefault();
      void act("Link request sent to the Bank. It appears here once the Bank approves it.", async () => postWorkflow({
        operation: "requestBankAccountLink", id: shortId("bank-link"), bankId: link.bankId,
        accountLabel: link.accountLabel.trim(), maskedAccount: maskAccountNumber(link.lastDigits),
      }));
    }}>
      <label>Bank<select aria-label="Bank" value={link.bankId} onChange={(event) => setLink({ ...link, bankId: event.target.value })}>
        {view?.banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name} ({bank.id})</option>)}
      </select></label>
      <label>Account nickname<input required maxLength={80} value={link.accountLabel} onChange={(event) => setLink({ ...link, accountLabel: event.target.value })} placeholder="Salary account" /></label>
      <label>Last digits of the account<input required inputMode="numeric" maxLength={6} value={link.lastDigits} onChange={(event) => setLink({ ...link, lastDigits: event.target.value.replace(/\D/g, "") })} placeholder="1234" /></label>
      <div className="evidenceActions"><button type="submit" className="primary button" disabled={busy || !link.bankId}>Request account link</button></div>
    </form>

    <h3>My policies</h3>
    {view && view.policies.length === 0 && <p>No policy yet. Buy a published package in the guided workflow.</p>}
    {view?.policies.slice(0, limit).map((policy) => {
      const accounts = accountsFor(policy);
      const sourceAccountId = selectedAccount(policy);
      const mandates = view.mandates.filter((mandate) => mandate.policyId === policy.id);
      const live = mandates.find((mandate) => ["PENDING", "ACTIVE"].includes(mandate.status));
      const collections = view.collections.filter((collection) => collection.policyId === policy.id).slice(-4);
      return <div className="queueItem" key={policy.id} style={{ display: "block" }}>
        <div className="queueTitle"><strong>{policy.id} · {formatBdt(policy.premiumMinor)} per installment</strong><StatusBadge status={policy.status} label={policy.status.replaceAll("_", " ")} /></div>
        <p>Term {policy.startDate} to {policy.endDate} · cover from {policy.coverStartDate || "the first premium payment"}{policy.reinstatedDate ? ` · reinstated ${policy.reinstatedDate}` : ""} · paid through {policy.paidThroughDate || "not yet paid"} · next due {policy.nextPremiumDueDate || policy.startDate}</p>
        {policy.standing.note && <p className={policy.standing.canPay ? "cardNote" : "evidenceWarning"}>{policy.standing.note}</p>}
        {accounts.length === 0 ? <p className="evidenceWarning">Link an account at {policy.bankIds.join(" or ") || "a partner bank"} to pay this policy.</p> : <>
          <label>Pay from<select aria-label="Pay from" value={sourceAccountId} onChange={(event) => setChoice({ ...choice, [policy.id]: event.target.value })}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.accountLabel} {account.maskedAccount} ({formatBdt(account.balanceMinor)})</option>)}
          </select></label>
          <div className="evidenceActions">
            <button type="button" className="primary button" disabled={busy || !policy.standing.canPay || !policy.nextInstallment || !policy.insurerAccount}
              onClick={() => {
                if (!policy.nextInstallment || !policy.insurerAccount) return;
                const tag = shortId("premium");
                onPreparePayment({
                  policyId: policy.id, sourceAccountId, destinationAccountId: policy.insurerAccount.id,
                  transferId: `transfer-${tag}`, paymentId: `payment-${tag}`,
                  periodStartDate: policy.nextInstallment.start, periodEndDate: policy.nextInstallment.end,
                  amountBdt: (policy.nextInstallment.amountMinor / 100).toFixed(2), externalReference: `otp-${tag}`,
                });
                setMessage(`Installment ${policy.nextInstallment.start} to ${policy.nextInstallment.end} is ready below. Request the code, then authorize.`);
              }}>{policy.status === "PENDING_PAYMENT" ? "Pay first premium now" : "Pay next installment by OTP"}</button>
            {!live && <button type="button" className="secondary button" disabled={busy || !policy.standing.canPay}
              onClick={() => void act("Automatic payment requested. The Bank must approve the mandate.", () => postWorkflow({
                operation: "requestBankMandate", id: shortId("mandate"), policyId: policy.id, accountReferenceId: sourceAccountId, expiryDate: policy.endDate,
              }))}>Set up automatic EFT payment</button>}
            {live && <button type="button" className="secondary button" disabled={busy}
              onClick={() => void act("Automatic payment cancelled.", () => postWorkflow({ operation: "cancelBankMandate", id: live.id }))}>Cancel automatic payment</button>}
          </div>
          {!policy.insurerAccount && <p className="evidenceWarning">The Insurer has no verified premium account at this bank yet.</p>}
        </>}
        {mandates.map((mandate) => <p key={mandate.id}><StatusBadge status={mandate.status} /> EFT mandate {mandate.id} · next debit {mandate.nextDebitDate || "—"} · until {mandate.expiryDate}</p>)}
        {collections.map((collection) => <p key={collection.id}><StatusBadge status={collection.status} /> Collection due {collection.dueDate} · attempts {collection.attemptCount}{collection.failureCode ? ` · ${collection.failureCode.replaceAll("_", " ").toLowerCase()}` : ""}</p>)}
      </div>;
    })}
    <div className="evidenceActions">
      <button type="button" className="secondary button" disabled={busy} onClick={() => void act("Refreshed from the ledger.", async () => undefined)}>Refresh</button>
      {(hidden > 0 || showAll) && <button type="button" className="secondary button" onClick={() => setShowAll(!showAll)}>{showAll ? "Show newest only" : `Show ${hidden} older records`}</button>}
    </div>
  </article>;
}
