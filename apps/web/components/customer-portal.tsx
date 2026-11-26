"use client";

import { useEffect, useState, type FormEvent } from "react";
import { StatusBadge } from "./status-badge";
import { customerApi, type CodeResponse, type CustomerView } from "./customer-api";
import type { Policy } from "@/lib/fabric/types";

const profileUrl = "/api/customer/profile";

export function CustomerPortal({ memberId, view = "both" }: { memberId: string; view?: "card" | "profile" | "both" }) {
  const [customer, setCustomer] = useState<CustomerView>();
  const [policies, setPolicies] = useState<Policy[]>();
  const [policyId, setPolicyId] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [profileError, setProfileError] = useState("");
  const [policyError, setPolicyError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [emailPending, setEmailPending] = useState(false);
  const [displayCode, setDisplayCode] = useState("");
  const policy = policies?.find(item => item.id === policyId) ?? policies?.[0];

  useEffect(() => {
    let mounted = true;
    void customerApi<{ customer: CustomerView }>(profileUrl).then(
      result => { if (mounted) setCustomer(result.customer); },
      () => { if (mounted) setProfileError("Your profile could not be loaded."); },
    );
    void customerApi<{ result: Policy[] }>("/api/ledger/policy").then(
      result => { if (mounted) setPolicies(result.result.filter(item => item.policyholderId === memberId)); },
      () => { if (mounted) setPolicyError("Your policies could not be loaded."); },
    );
    const changed = () => {
      void customerApi<{ result: Policy[] }>("/api/ledger/policy").then(
        result => { if (mounted) setPolicies(result.result.filter(item => item.policyholderId === memberId)); },
        () => undefined,
      );
    };
    window.addEventListener("block-insure:coverage-changed", changed);
    return () => { mounted = false; window.removeEventListener("block-insure:coverage-changed", changed); };
  }, [memberId]);

  async function runProfileAction(action: () => Promise<void>) {
    setBusy(true);
    setProfileError("");
    setProfileNotice("");
    try {
      await action();
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "The profile action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void runProfileAction(async () => {
      const result = await customerApi<{ customer: CustomerView }>(profileUrl, {
        action: "update", fullName: data.get("fullName"), phone: data.get("phone"),
        address: data.get("address"), dataSharing: data.has("consent"),
      });
      setCustomer(result.customer);
      setProfileNotice("Profile updated.");
    });
  }

  function requestEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runProfileAction(async () => {
      const result = await customerApi<CodeResponse>(profileUrl, { action: "request-email", email });
      setEmailPending(true);
      setDisplayCode(result.displayCode ?? "");
      setProfileNotice(result.message ?? "Check the new email address for a verification code.");
    });
  }

  function verifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code");
    void runProfileAction(async () => {
      const result = await customerApi<{ customer: CustomerView }>(profileUrl, { action: "verify-email", email, code });
      setCustomer(result.customer);
      setEmail("");
      setEmailPending(false);
      setDisplayCode("");
      setProfileNotice("Email address updated.");
    });
  }

  async function refreshCoverage() {
    setPolicyError("");
    try {
      const { result } = await customerApi<{ result: Policy[] }>("/api/ledger/policy");
      setPolicies(result.filter(item => item.policyholderId === memberId));
    } catch {
      setPolicyError("Your policies could not be loaded.");
    }
  }

  return <section className="workGrid customerWorkspace" aria-label="Customer account">
    {view !== "card" && <article className="workCard" aria-labelledby="my-profile-heading">
      <h2 id="my-profile-heading">My profile</h2>
      {customer && <>
        <p className="customerEmail">Current email address <strong>{customer.email}</strong></p>
        <form className="guidedForm" onSubmit={saveProfile}>
          <label>Full name (verified)<input name="fullName" autoComplete="name" maxLength={120} defaultValue={customer.fullName} readOnly aria-describedby="verified-name-help" required />
            <small id="verified-name-help">Checked by the Insurer when your account was approved. Ask the Insurer to correct it.</small></label>
          <label>Phone<input name="phone" type="tel" autoComplete="tel" maxLength={32} defaultValue={customer.phone} required /></label>
          <label className="wideField">Address (optional)<input name="address" autoComplete="street-address" maxLength={300} defaultValue={customer.address} /></label>
          <label className="wideField customerConsent"><input name="consent" type="checkbox" defaultChecked={customer.consent?.dataSharing} />I consent to sharing my information with the insurer for coverage and claims</label>
          <button type="submit" className="secondary button" disabled={busy}>Save profile</button>
        </form>
        <div className="medicalSubpanel">
          <h3>Change email address</h3>
          <form className="guidedForm" onSubmit={requestEmail}>
            <label className="wideField">New email address
              <input type="email" autoComplete="email" maxLength={254} value={email} required onChange={event => {
                setEmail(event.target.value);
                setEmailPending(false);
                setDisplayCode("");
                setProfileNotice("");
              }} />
            </label>
            <button type="submit" className="secondary button" disabled={busy}>{emailPending ? "Send another email code" : "Send email code"}</button>
          </form>
          {emailPending && <form className="guidedForm" onSubmit={verifyEmail}>
            <label className="wideField">Email verification code
              <input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required />
            </label>
            {displayCode && <p className="wideField">Demo verification code <output aria-label="Demo verification code">{displayCode}</output></p>}
            <button type="submit" className="secondary button" disabled={busy}>Verify new email</button>
          </form>}
        </div>
      </>}
      {profileNotice && <p role="status">{profileNotice}</p>}
      {profileError && <p className="formError" role="alert">{profileError}</p>}
    </article>}
    {view !== "profile" && <article className="workCard" id="insurance-card" aria-labelledby="insurance-card-heading">
      <h2 id="insurance-card-heading">Insurance card</h2>
      <p>Give this member ID to the hospital when you register a stay.</p>
      <dl className="customerCardDetails">
        <dt>Member ID</dt><dd><strong>{memberId}</strong></dd>
        <dt>Name</dt><dd>{customer?.fullName || "Pending profile"}</dd>
        {policy && <>
          <dt>Policy</dt><dd>{policy.id}</dd>
          <dt>Policy status</dt><dd><StatusBadge status={policy.status} /></dd>
          <dt>Cover starts</dt><dd>{policy.coverStartDate || "Not yet active"}</dd>
          <dt>Paid through</dt><dd>{policy.paidThroughDate || "No paid days"}</dd>
          <dt>Policy ends</dt><dd>{policy.endDate}</dd>
        </>}
      </dl>
      {policies?.length === 0 && <p>No policy has been issued to this member.</p>}
      {policyError && <p className="formError" role="alert">{policyError}</p>}
      <div className="medicalButtonGroup customerCardControls">
        {policies && policies.length > 1 && <label>Choose a policy
          <select value={policy?.id ?? ""} onChange={event => setPolicyId(event.target.value)}>
            {policies.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
          </select>
        </label>}
        <button type="button" className="secondary button" onClick={() => void refreshCoverage()}>Refresh coverage</button>
        <button type="button" className="secondary button" disabled={!customer} onClick={() => window.print()}>Print insurance card</button>
      </div>
    </article>}
  </section>;
}
