"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  demoAccounts,
  workspaceForAccount,
  type DemoAccount,
} from "@/lib/auth/accounts";
import type { RoleDashboard } from "@/lib/dashboard/build-dashboard";
import { GuidedWorkflowForm, type PreparedWorkflow } from "@/components/guided-workflow-form";
import type { WorkflowCommand } from "@/lib/workflows/commands";
import { decryptEvidenceBytes, encryptEvidenceBytes, sha256Hex } from "@/lib/evidence/browser-crypto";

type AssetType = "package" | "policy" | "claim" | "evidence" | "verification" | "decision" | "settlement" | "access" | "claim-history";

const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const commandTemplates = {
  insurerAdmin: [
    ["Create package", { operation: "createPolicyPackage", id: "package-1", name: "Essential Health", description: "Core inpatient coverage", premiumMinor: 10000, coverageLimitMinor: 1000000, termsHash: hash }],
    ["Publish package", { operation: "publishPolicyPackage", id: "package-1" }],
    ["Retire package", { operation: "retirePolicyPackage", id: "package-1" }],
    ["Issue policy", { operation: "issuePolicy", id: "policy-1", packageId: "package-1", policyholderId: "policyholder1", startDate: "2026-01-01", endDate: "2026-12-31" }],
    ["Start review", { operation: "startClaimReview", claimId: "claim-1" }],
    ["Authorize settlement", { operation: "authorizeSettlement", settlementId: "settlement-1", claimId: "claim-1" }],
  ],
  policyholder: [
    ["Submit claim", { operation: "submitClaim", id: "claim-1", policyId: "policy-1", amountMinor: 250000, incidentDate: "2026-06-15", descriptionHash: hash }],
  ],
  hospitalOfficer: [
    ["Verify claim", { operation: "verifyClaim", claimId: "claim-1", verificationId: "verification-1", outcome: "VERIFIED", clinicalReferenceHash: hash }],
  ],
  auditor: [
    ["Approve claim", { operation: "recordAuditorDecision", claimId: "claim-1", decisionId: "decision-1", outcome: "APPROVE", reasonHash: hash }],
  ],
  bankOfficer: [
    ["Confirm settlement", { operation: "confirmSettlement", settlementId: "settlement-1", bankReferenceHash: hash }],
  ],
} as const;

async function responseJson(response: Response) {
  const body = await response.json().catch(() => ({ message: "Invalid server response" }));
  if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
  return body;
}

export function WorkspaceClient({
  initialAccount,
  initialDashboard,
}: {
  initialAccount: DemoAccount | null;
  initialDashboard: RoleDashboard | null;
}) {
  const router = useRouter();
  const [account, setAccount] = useState(initialAccount);
  const [command, setCommand] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("claim");
  const [assetId, setAssetId] = useState("");
  const [evidenceClaimId, setEvidenceClaimId] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [documentType, setDocumentType] = useState("DISCHARGE_SUMMARY");
  const [contentHash, setContentHash] = useState("");
  const [ciphertext, setCiphertext] = useState<File | null>(null);
  const [plaintextEvidence, setPlaintextEvidence] = useState<File | null>(null);
  const [evidencePassphrase, setEvidencePassphrase] = useState("");
  const [evidencePassphraseConfirmation, setEvidencePassphraseConfirmation] = useState("");
  const [encrypting, setEncrypting] = useState(false);
  const [retrievalEvidenceId, setRetrievalEvidenceId] = useState("");
  const [retrievalPassphrase, setRetrievalPassphrase] = useState("");
  const [retrieving, setRetrieving] = useState(false);
  const [decryptedEvidence, setDecryptedEvidence] = useState<{ url: string; name: string } | null>(null);
  const [output, setOutput] = useState("Ready.");
  const [busy, setBusy] = useState(false);
  const [dashboard, setDashboard] = useState<RoleDashboard | null>(initialDashboard);
  const [dashboardLoading, setDashboardLoading] = useState(Boolean(initialAccount && !initialDashboard));
  const [preparedWorkflow, setPreparedWorkflow] = useState<PreparedWorkflow | null>(null);
  const templates = useMemo(() => account ? commandTemplates[account.role] : [], [account]);

  useEffect(() => () => {
    if (decryptedEvidence) URL.revokeObjectURL(decryptedEvidence.url);
  }, [decryptedEvidence]);

  const refreshDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const body = await responseJson(await fetch("/api/dashboard", { cache: "no-store" }));
      setDashboard(body.dashboard);
    } catch (error) {
      setDashboard(null);
      setOutput(error instanceof Error ? error.message : "Dashboard failed to load");
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  async function login(accountId: string) {
    setBusy(true);
    try {
      const body = await responseJson(await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId }),
      }));
      const signedInAccount = body.account as DemoAccount;
      setAccount(signedInAccount);
      setOutput(`Signed in as ${body.account.displayName}.`);
      router.push(`/workspace/${workspaceForAccount(signedInAccount)}`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAccount(null);
    setDashboard(null);
    setCommand("");
    setOutput("Signed out.");
    router.push("/workspace");
    router.refresh();
  }

  async function submitWorkflow(payload: WorkflowCommand) {
    setBusy(true);
    try {
      const body = await responseJson(await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }));
      setOutput(JSON.stringify(body.result, null, 2));
      await refreshDashboard();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Command failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitCommand() {
    try {
      await submitWorkflow(JSON.parse(command) as WorkflowCommand);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Command JSON is invalid");
    }
  }

  async function queryAsset() {
    setBusy(true);
    try {
      if (!assetId.trim()) throw new Error("Enter an asset ID.");
      const body = await responseJson(await fetch(
        `/api/ledger/${assetType}/${encodeURIComponent(assetId.trim())}`,
      ));
      setOutput(JSON.stringify(body.result, null, 2));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Query failed");
    } finally {
      setBusy(false);
    }
  }

  async function listAssets() {
    setBusy(true);
    try {
      if (assetType === "claim-history") throw new Error("Claim history requires a claim ID.");
      const body = await responseJson(await fetch(`/api/ledger/${assetType}`));
      setOutput(JSON.stringify(body.result, null, 2));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "List query failed");
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidence() {
    setBusy(true);
    try {
      if (!ciphertext) throw new Error("Choose a client-encrypted .enc file.");
      const form = new FormData();
      form.set("claimId", evidenceClaimId);
      form.set("evidenceId", evidenceId);
      form.set("documentType", documentType);
      form.set("contentHash", contentHash);
      form.set("ciphertext", ciphertext);
      const body = await responseJson(await fetch("/api/evidence", { method: "POST", body: form }));
      setOutput(JSON.stringify(body, null, 2));
      await refreshDashboard();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Evidence upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function encryptEvidence() {
    setEncrypting(true);
    try {
      if (!plaintextEvidence) throw new Error("Choose the original evidence file.");
      if (evidencePassphrase !== evidencePassphraseConfirmation) throw new Error("Evidence passphrases do not match.");
      const encrypted = await encryptEvidenceBytes(
        new Uint8Array(await plaintextEvidence.arrayBuffer()),
        evidencePassphrase,
        { claimId: evidenceClaimId.trim(), evidenceId: evidenceId.trim() },
      );
      const safeName = plaintextEvidence.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const envelopeBuffer = new ArrayBuffer(encrypted.envelope.byteLength);
      new Uint8Array(envelopeBuffer).set(encrypted.envelope);
      const file = new File(
        [envelopeBuffer],
        `${safeName}.enc`,
        { type: "application/octet-stream" },
      );
      setCiphertext(file);
      setContentHash(encrypted.contentHash);
      setEvidencePassphrase("");
      setEvidencePassphraseConfirmation("");
      setOutput(`Encrypted ${plaintextEvidence.name} locally. Keep the passphrase safe; it cannot be recovered by Block-Insure.`);
    } catch (error) {
      setCiphertext(null);
      setContentHash("");
      setOutput(error instanceof Error ? error.message : "Evidence encryption failed");
    } finally {
      setEncrypting(false);
    }
  }

  async function retrieveEvidence() {
    setRetrieving(true);
    try {
      const id = retrievalEvidenceId.trim();
      if (!id) throw new Error("Enter an evidence ID to retrieve.");
      if (retrievalPassphrase.length < 12) throw new Error("Enter the evidence passphrase.");
      const response = await fetch(`/api/evidence/${encodeURIComponent(id)}`, { method: "POST", cache: "no-store" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: `Evidence retrieval failed (${response.status})` }));
        throw new Error(error.message);
      }
      const claimId = response.headers.get("x-evidence-claim-id");
      const expectedHash = response.headers.get("x-content-sha256");
      if (!claimId || !expectedHash) throw new Error("Evidence integrity metadata is missing.");
      const plaintext = await decryptEvidenceBytes(
        new Uint8Array(await response.arrayBuffer()),
        retrievalPassphrase,
        { claimId, evidenceId: id },
      );
      if (await sha256Hex(plaintext) !== expectedHash) throw new Error("Decrypted evidence failed its ledger integrity check.");
      const plaintextBuffer = new ArrayBuffer(plaintext.byteLength);
      new Uint8Array(plaintextBuffer).set(plaintext);
      const next = { url: URL.createObjectURL(new Blob([plaintextBuffer])), name: `${id}.decrypted` };
      setDecryptedEvidence(next);
      setRetrievalPassphrase("");
      setOutput(`Evidence ${id} decrypted locally and matched its Fabric content hash.`);
      await refreshDashboard();
    } catch (error) {
      setDecryptedEvidence(null);
      setOutput(error instanceof Error ? error.message : "Evidence retrieval failed");
    } finally {
      setRetrieving(false);
    }
  }

  if (!account) {
    return (
      <section className="shell signInPanel">
        <span className="kicker">Local demonstration access</span>
        <h1 className="workspaceTitle">Choose an organization account.</h1>
        <p className="lede">The selected account ID is mapped to a role on the server. Fabric certificates and keys never enter the browser.</p>
        <div className="accountGrid">
          {Object.values(demoAccounts).map((candidate) => (
            <button disabled={busy} key={candidate.id} onClick={() => login(candidate.id)}>
              <strong>{candidate.displayName}</strong>
              <span>{candidate.organization}</span>
            </button>
          ))}
        </div>
        <pre className="console compact">{output}</pre>
      </section>
    );
  }

  return (
    <section className="shell workspace">
      <header className="workspaceHeader">
        <div>
          <span className="kicker">{account.organization}</span>
          <h1 className="workspaceTitle">{account.displayName}</h1>
          <p>Application role: <code>{account.role}</code></p>
        </div>
        <button className="secondary button" onClick={logout}>Sign out</button>
      </header>

      <section className="roleDashboard" aria-busy={dashboardLoading}>
        <div className="dashboardIntro">
          <div>
            <span className="kicker">Organization-scoped overview</span>
            <h2>{dashboard?.title ?? "Loading ledger overview…"}</h2>
          </div>
          <p>{dashboard?.description ?? "Evaluating current world state through Fabric Gateway."}</p>
        </div>

        {dashboard && (
          <>
            <div className="metricGrid">
              {dashboard.metrics.map((metric) => (
                <article className="metricCard" key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small>{metric.hint}</small>
                </article>
              ))}
            </div>

            <div className="dashboardGrid">
              <article className="queuePanel">
                <div className="panelHeading">
                  <div><span className="kicker">Actionable now</span><h3>{dashboard.queueTitle}</h3></div>
                  <button className="textButton" disabled={dashboardLoading} onClick={refreshDashboard}>Refresh</button>
                </div>
                {dashboard.queue.length === 0 ? (
                  <p className="emptyState">No ledger records currently require this role.</p>
                ) : (
                  <div className="queueList">
                    {dashboard.queue.map((item) => (
                      <div className="queueItem" key={item.id}>
                        <div>
                          <div className="queueTitle"><strong>{item.title}</strong><span className={`status status-${item.status.toLowerCase()}`}>{item.status.replaceAll("_", " ")}</span></div>
                          <p>{item.detail}</p>
                        </div>
                        {item.command && <button onClick={() => {
                          if (!item.command) return;
                          setPreparedWorkflow({ command: item.command, revision: Date.now() });
                          document.getElementById("guided-workflow")?.scrollIntoView({ behavior: "smooth" });
                        }}>{item.commandLabel}</button>}
                      </div>
                    ))}
                  </div>
                )}
              </article>

              <article className="recentPanel">
                <span className="kicker">Ledger activity</span>
                <h3>Recently updated claims</h3>
                {dashboard.recentClaims.length === 0 ? <p className="emptyState">No visible claims yet.</p> : (
                  <div className="recentList">
                    {dashboard.recentClaims.map((claim) => (
                      <button key={claim.id} onClick={() => { setAssetType("claim"); setAssetId(claim.id); }}>
                        <span><strong>{claim.id}</strong><small>{claim.policyId}</small></span>
                        <i className={`status status-${claim.status.toLowerCase()}`}>{claim.status.replaceAll("_", " ")}</i>
                      </button>
                    ))}
                  </div>
                )}
              </article>
            </div>
          </>
        )}
      </section>

      <div className="workGrid" id="transaction-console">
        <GuidedWorkflowForm
          key={`${account.role}-${preparedWorkflow?.revision ?? 0}`}
          role={account.role}
          busy={busy}
          prepared={preparedWorkflow}
          onSubmit={submitWorkflow}
        />

        <article className="workCard">
          <span className="kicker">Evaluate transaction</span>
          <h2>Find ledger asset</h2>
          <label>Asset type
            <select value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType)}>
              <option value="package">Policy package</option><option value="policy">Policy</option>
              <option value="claim">Claim</option><option value="evidence">Evidence reference</option>
              <option value="verification">Hospital verification</option><option value="decision">Auditor decision</option>
              <option value="settlement">Settlement</option><option value="claim-history">Claim history</option>
              {(account.role === "insurerAdmin" || account.role === "auditor") && <option value="access">Evidence access log</option>}
            </select>
          </label>
          <label>Asset ID<input value={assetId} onChange={(event) => setAssetId(event.target.value)} placeholder="claim-1" /></label>
          <div className="queryActions">
            <button className="primary button" disabled={busy || assetType === "access"} onClick={queryAsset}>Find by ID</button>
            <button className="secondary button" disabled={busy || assetType === "claim-history"} onClick={listAssets}>List all allowed</button>
          </div>
        </article>

        <article className="workCard advancedCard">
          <span className="kicker">Advanced diagnostics</span>
          <h2>JSON command console</h2>
          <p className="cardNote">Use the guided form for normal work. This console remains available for development and contract diagnostics.</p>
          <details>
            <summary>Open advanced console</summary>
            <div className="templateButtons">
              {templates.map(([label, template]) => (
                <button type="button" key={label} onClick={() => setCommand(JSON.stringify(template, null, 2))}>{label}</button>
              ))}
            </div>
            <textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Select a command template" spellCheck={false} />
            <button className="primary button" disabled={busy || !command} onClick={submitCommand}>Submit raw command</button>
          </details>
        </article>

        {account.role === "policyholder" && (
          <article className="workCard evidenceCard">
            <span className="kicker">Ciphertext evidence</span>
            <h2>Encrypt, store, and anchor evidence</h2>
            <p className="cardNote">Encryption happens in this browser with AES-256-GCM. The passphrase and plaintext never reach the server; only the generated <code>.enc</code> envelope is stored, and Fabric receives integrity hashes.</p>
            <div className="evidenceFields">
              <label>Claim ID<input value={evidenceClaimId} onChange={(event) => setEvidenceClaimId(event.target.value)} placeholder="claim-1" /></label>
              <label>Evidence ID<input value={evidenceId} onChange={(event) => setEvidenceId(event.target.value)} placeholder="evidence-1" /></label>
              <label>Document type<input value={documentType} onChange={(event) => setDocumentType(event.target.value)} /></label>
              <label>Original file<input type="file" onChange={(event) => { setPlaintextEvidence(event.target.files?.[0] ?? null); setCiphertext(null); setContentHash(""); }} /></label>
              <label>Evidence passphrase<input type="password" autoComplete="new-password" value={evidencePassphrase} onChange={(event) => setEvidencePassphrase(event.target.value)} placeholder="At least 12 characters" /></label>
              <label>Confirm passphrase<input type="password" autoComplete="new-password" value={evidencePassphraseConfirmation} onChange={(event) => setEvidencePassphraseConfirmation(event.target.value)} /></label>
              <label>Original content SHA-256<input value={contentHash} readOnly placeholder="Calculated after encryption" /></label>
              <div className="encryptionStatus">
                <strong>{ciphertext ? "Ciphertext ready" : "Not encrypted yet"}</strong>
                <span>{ciphertext ? `${ciphertext.name} · ${ciphertext.size} bytes` : "Choose a file and protect it with a passphrase."}</span>
              </div>
            </div>
            <div className="evidenceActions">
              <button className="secondary button" disabled={busy || encrypting} onClick={encryptEvidence}>{encrypting ? "Encrypting…" : "Encrypt in browser"}</button>
              <button className="primary button" disabled={busy || encrypting || !ciphertext} onClick={uploadEvidence}>Store ciphertext and record reference</button>
            </div>
            <p className="evidenceWarning">Block-Insure never receives or stores the passphrase. Losing it makes the downloaded ciphertext unrecoverable.</p>
          </article>
        )}

        {account.role !== "bankOfficer" && (
          <article className="workCard evidenceCard">
            <span className="kicker">Authorized evidence access</span>
            <h2>Retrieve and decrypt evidence</h2>
            <p className="cardNote">The server validates your organization and the claim state, records this access on Fabric, and returns ciphertext. Decryption and integrity verification happen only in this browser.</p>
            <div className="evidenceFields">
              <label>Evidence ID<input value={retrievalEvidenceId} onChange={(event) => { setRetrievalEvidenceId(event.target.value); setDecryptedEvidence(null); }} placeholder="evidence-1" /></label>
              <label>Evidence passphrase<input type="password" autoComplete="current-password" value={retrievalPassphrase} onChange={(event) => setRetrievalPassphrase(event.target.value)} /></label>
            </div>
            <div className="evidenceActions">
              <button className="primary button" disabled={busy || retrieving} onClick={retrieveEvidence}>{retrieving ? "Retrieving…" : "Retrieve and decrypt"}</button>
              {decryptedEvidence && <a className="secondary button" download={decryptedEvidence.name} href={decryptedEvidence.url}>Download verified plaintext</a>}
            </div>
          </article>
        )}
      </div>

      <div className="resultHeading"><span className="kicker">Gateway response</span><span>{busy ? "Working…" : "Ready"}</span></div>
      <pre className="console">{output}</pre>
    </section>
  );
}
