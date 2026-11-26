"use client";

import { useState } from "react";
import { StatusBadge } from "./status-badge";
import { customerApi, type CustomerView } from "./customer-api";

const queueUrl = "/api/insurer/customers";
type Decision = "approve" | "reject" | "suspend" | "reactivate";

export function CustomerOnboardingQueue() {
  const [customers, setCustomers] = useState<CustomerView[]>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The customer update could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  function decide(form: HTMLFormElement | null, memberId: string, action: Decision) {
    if (!form || !form.reportValidity()) return;
    const reason = new FormData(form).get("reason");
    void run(async () => {
      const result = await customerApi<{ customer: CustomerView }>(queueUrl, { action, memberId, reason: reason || undefined });
      setCustomers(current => current?.map(item => item.memberId === memberId ? result.customer : item));
      setMessage({ approve: "Customer approved.", reject: "Profile rejected.", suspend: "Customer suspended.", reactivate: "Customer reactivated." }[action]);
    });
  }

  return <article className="workCard" aria-labelledby="customer-onboarding-heading">
    <h2 id="customer-onboarding-heading">Customer onboarding</h2>
    <button type="button" className="secondary button" disabled={busy} onClick={() => void run(async () => {
      const result = await customerApi<{ customers: CustomerView[] }>(queueUrl);
      setCustomers(result.customers);
    })}>Refresh customers</button>
    {customers?.length === 0 && <p>No customer profiles are waiting or on record.</p>}
    {customers && <div className="queueList">
      {[...customers].sort((left, right) => Number(right.status === "PENDING_KYC") - Number(left.status === "PENDING_KYC")).map(customer => <article className="queueItem customerQueueEntry" key={customer.memberId} aria-label={customer.memberId}>
        <div className="queueTitle"><strong>{customer.fullName || customer.memberId}</strong><StatusBadge status={customer.status} /></div>
        <dl className="customerCardDetails">
          <dt>Member ID</dt><dd>{customer.memberId}</dd>
          <dt>Email</dt><dd>{customer.email}</dd>
          {customer.dateOfBirth && <><dt>Date of birth</dt><dd>{customer.dateOfBirth}</dd></>}
          {customer.phone && <><dt>Phone</dt><dd>{customer.phone}</dd></>}
          {customer.address && <><dt>Address</dt><dd>{customer.address}</dd></>}
          {customer.nidLast3 && <><dt>National ID ends in</dt><dd>{customer.nidLast3}</dd></>}
          <dt>Data-sharing consent</dt><dd>{customer.consent?.dataSharing ? "Given" : "Not recorded"}</dd>
        </dl>
        {customer.duplicateNationalIdOf && <p className="formError" role="note">The same national ID is held by member {customer.duplicateNationalIdOf}. Approval is refused while that account is active or suspended.</p>}
        {(customer.status === "PENDING_KYC" || customer.status === "ACTIVE" || customer.status === "SUSPENDED") && <form className="guidedForm" onSubmit={event => event.preventDefault()}>
          <label className="wideField">Decision note (optional)<input name="reason" maxLength={300} /></label>
          <div className="wideField medicalButtonGroup">
            {customer.status === "PENDING_KYC" && <>
              <button type="button" className="primary button" disabled={busy} onClick={event => decide(event.currentTarget.form, customer.memberId, "approve")}>Approve customer</button>
              <button type="button" className="secondary button" disabled={busy} onClick={event => decide(event.currentTarget.form, customer.memberId, "reject")}>Reject customer</button>
            </>}
            {customer.status === "ACTIVE" && <button type="button" className="secondary button" disabled={busy} onClick={event => decide(event.currentTarget.form, customer.memberId, "suspend")}>Suspend customer</button>}
            {customer.status === "SUSPENDED" && <button type="button" className="primary button" disabled={busy} onClick={event => decide(event.currentTarget.form, customer.memberId, "reactivate")}>Reactivate customer</button>}
          </div>
        </form>}
      </article>)}
    </div>}
    {message && <p role="status">{message}</p>}
    {error && <p className="formError" role="alert">{error}</p>}
  </article>;
}
