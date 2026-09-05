"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { demoAccounts, type DemoAccount } from "@/lib/auth/accounts";

type AssetType = "package" | "policy" | "claim" | "evidence" | "settlement" | "claim-history";

const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const commandTemplates = {
  insurerAdmin: [
    ["Create package", { operation: "createPolicyPackage", id: "package-1", name: "Essential Health", description: "Core inpatient coverage", premiumMinor: 10000, coverageLimitMinor: 1000000, termsHash: hash }],
    ["Publish package", { operation: "publishPolicyPackage", id: "package-1" }],
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

export function WorkspaceClient({ initialAccount }: { initialAccount: DemoAccount | null }) {
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
  const [output, setOutput] = useState("Ready.");
  const [busy, setBusy] = useState(false);
  const templates = useMemo(() => account ? commandTemplates[account.role] : [], [account]);

  async function login(accountId: string) {
    setBusy(true);
    try {
      const body = await responseJson(await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId }),
      }));
      setAccount(body.account);
      setOutput(`Signed in as ${body.account.displayName}.`);
      router.refresh();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAccount(null);
    setCommand("");
    setOutput("Signed out.");
    router.refresh();
  }

  async function submitCommand() {
    setBusy(true);
    try {
      const payload = JSON.parse(command);
      const body = await responseJson(await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }));
      setOutput(JSON.stringify(body.result, null, 2));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Command failed");
    } finally {
      setBusy(false);
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
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Evidence upload failed");
    } finally {
      setBusy(false);
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

      <div className="workGrid">
        <article className="workCard">
          <span className="kicker">Submit transaction</span>
          <h2>Role commands</h2>
          <div className="templateButtons">
            {templates.map(([label, template]) => (
              <button key={label} onClick={() => setCommand(JSON.stringify(template, null, 2))}>{label}</button>
            ))}
          </div>
          <textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Select a command template" spellCheck={false} />
          <button className="primary button" disabled={busy || !command} onClick={submitCommand}>Submit to ledger</button>
        </article>

        <article className="workCard">
          <span className="kicker">Evaluate transaction</span>
          <h2>Find ledger asset</h2>
          <label>Asset type
            <select value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType)}>
              <option value="package">Policy package</option><option value="policy">Policy</option>
              <option value="claim">Claim</option><option value="evidence">Evidence reference</option>
              <option value="settlement">Settlement</option><option value="claim-history">Claim history</option>
            </select>
          </label>
          <label>Asset ID<input value={assetId} onChange={(event) => setAssetId(event.target.value)} placeholder="claim-1" /></label>
          <div className="queryActions">
            <button className="primary button" disabled={busy} onClick={queryAsset}>Find by ID</button>
            <button className="secondary button" disabled={busy || assetType === "claim-history"} onClick={listAssets}>List all allowed</button>
          </div>
        </article>

        {account.role === "policyholder" && (
          <article className="workCard evidenceCard">
            <span className="kicker">Ciphertext evidence</span>
            <h2>Store and anchor evidence</h2>
            <p className="cardNote">Encrypt the file before choosing it. This service stores only the <code>.enc</code> ciphertext; the ledger receives integrity hashes, never document bytes or encryption keys.</p>
            <div className="evidenceFields">
              <label>Claim ID<input value={evidenceClaimId} onChange={(event) => setEvidenceClaimId(event.target.value)} placeholder="claim-1" /></label>
              <label>Evidence ID<input value={evidenceId} onChange={(event) => setEvidenceId(event.target.value)} placeholder="evidence-1" /></label>
              <label>Document type<input value={documentType} onChange={(event) => setDocumentType(event.target.value)} /></label>
              <label>Original content SHA-256<input value={contentHash} onChange={(event) => setContentHash(event.target.value)} placeholder="64 hexadecimal characters" /></label>
              <label>Encrypted file<input type="file" accept=".enc,application/octet-stream" onChange={(event) => setCiphertext(event.target.files?.[0] ?? null)} /></label>
            </div>
            <button className="primary button" disabled={busy} onClick={uploadEvidence}>Store ciphertext and record reference</button>
          </article>
        )}
      </div>

      <div className="resultHeading"><span className="kicker">Gateway response</span><span>{busy ? "Working…" : "Ready"}</span></div>
      <pre className="console">{output}</pre>
    </section>
  );
}
