"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { customerApi, type CodeResponse } from "./customer-api";

const title = { signup: "Sign up for an insurance account", login: "Customer sign-in" };

export function CustomerAccess({ mode }: { mode: keyof typeof title }) {
  const [phase, setPhase] = useState<"email" | "code" | "profile" | "received">("email");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [displayCode, setDisplayCode] = useState("");
  const [busy, setBusy] = useState(false);
  const nextControl = useRef<HTMLInputElement>(null);
  const completion = useRef<HTMLParagraphElement>(null);
  const moveFocus = useRef(false);
  const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";

  useEffect(() => {
    if (!moveFocus.current) return;
    if (phase === "received") completion.current?.focus();
    else nextControl.current?.focus();
  }, [phase]);

  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function requestCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    void run(async () => {
      const result = await customerApi<CodeResponse>(endpoint, { action: "request", email });
      setDisplayCode(result.displayCode ?? "");
      setMessage(result.message ?? "Check your email for the next step.");
      moveFocus.current = true;
      setPhase("code");
    });
  }

  function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = new FormData(form).get("code");
    void run(async () => {
      const result = await customerApi<{ next?: "complete-profile" }>(endpoint, { action: "verify", email, code });
      form.reset();
      setDisplayCode("");
      setMessage("");
      if (mode === "signup" || result.next === "complete-profile") setPhase("profile");
      else window.location.assign(new URL("/workspace/policyholder", window.location.origin));
    });
  }

  function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void run(async () => {
      await customerApi("/api/auth/signup", {
        action: "profile",
        fullName: fields.get("fullName"),
        phone: fields.get("phone"),
        dateOfBirth: fields.get("dateOfBirth"),
        nid: fields.get("nid"),
        address: fields.get("address") || undefined,
        dataSharing: fields.has("consent"),
      });
      setPhase("received");
    });
  }

  return (
    <section className="shell signInPanel customerAccess" aria-labelledby="customer-access-heading">
      <h1 className="workspaceTitle" id="customer-access-heading">{title[mode]}</h1>
      {phase === "email" && <form className="guidedForm" onSubmit={requestCode}>
        <label className="wideField">Email address
          <input ref={nextControl} name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} required />
        </label>
        <button type="submit" className="primary button" disabled={busy}>Send code</button>
      </form>}
      {phase === "code" && <form className="guidedForm" onSubmit={verifyCode}>
        <p className="wideField customerEmail">Email address <strong>{email}</strong></p>
        <label className="wideField">Verification code
          <input ref={nextControl} name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required />
        </label>
        {displayCode && <p className="wideField">Demo verification code <output aria-label="Demo verification code">{displayCode}</output></p>}
        <div className="wideField medicalButtonGroup">
          <button type="submit" className="primary button" disabled={busy}>{mode === "signup" ? "Verify code" : "Sign in"}</button>
          <button type="button" className="secondary button" disabled={busy} onClick={() => requestCode()}>Send another code</button>
          <button type="button" className="secondary button" disabled={busy} onClick={() => {
            setPhase("email");
            setDisplayCode("");
            setMessage("");
            setError("");
          }}>Change email address</button>
        </div>
      </form>}
      {phase === "profile" && <form className="guidedForm" onSubmit={submitProfile}>
        <label>Full name<input ref={nextControl} name="fullName" autoComplete="name" maxLength={120} required /></label>
        <label>Phone<input name="phone" type="tel" autoComplete="tel" maxLength={25} required /></label>
        <label>Date of birth<input name="dateOfBirth" type="date" autoComplete="bday" required aria-describedby="birth-help" />
          <small id="birth-help">The policyholder must be 18 or older.</small></label>
        <div>
          <label>National ID<input name="nid" type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]{10}|[0-9]{13}|[0-9]{17}" maxLength={17} aria-describedby="nid-help" required /></label>
          <small id="nid-help">Enter a 10-, 13-, or 17-digit number.</small>
        </div>
        <label className="wideField">Address (optional)<input name="address" autoComplete="street-address" maxLength={250} /></label>
        <label className="customerConsent wideField"><input name="consent" type="checkbox" required />I consent to sharing my information with the insurer for coverage and claims</label>
        <button type="submit" className="primary button" disabled={busy}>Submit profile</button>
      </form>}
      {phase === "received" && <p ref={completion} tabIndex={-1} role="status">Profile submitted. The insurer will review it before you can sign in.</p>}
      {message && <p role="status">{message}</p>}
      {error && <p className="formError" role="alert">{error}</p>}
      <div className="medicalButtonGroup">
        {mode === "signup" ? <Link href="/signin">Already have an account? Sign in</Link> : <Link href="/signup">Create an insurance account</Link>}
        <Link href="/workspace">Staff sign-in</Link>
      </div>
    </section>
  );
}
