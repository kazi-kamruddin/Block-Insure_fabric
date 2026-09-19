"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  demoAccounts,
  workspaceForAccount,
  type DemoAccount,
  type DemoAccountId,
} from "@/lib/auth/accounts";
import type { RoleDashboard } from "@/lib/dashboard/build-dashboard";
import { GuidedWorkflowForm, type PreparedWorkflow } from "@/components/guided-workflow-form";
import { PresentationGuide } from "@/components/presentation-guide";
import type { WorkflowCommand } from "@/lib/workflows/commands";
import { bdtToMinor } from "@/lib/workflows/forms";
import { decryptEvidenceBytes, encryptEvidenceBytes, sha256Hex } from "@/lib/evidence/browser-crypto";

type AssetType = "partner-agreement" | "hospital-invoice" | "package" | "policy" | "claim" | "evidence" | "evidence-grant" | "verification" | "decision" | "review" | "appeal" | "fraud-assessment" | "settlement" | "access" | "claim-history" | "account" | "bank-transfer" | "mandate" | "premium-payment" | "premium-adjustment" | "collection" | "benefit-plan" | "beneficiaries" | "benefit-request" | "liability" | "oracle-snapshot" | "oracle-request" | "oracle-commitment" | "oracle-result" | "oracle-history";
type NotificationItem = { id: string; title: string; message: string; assetId: string; blockNumber: string };
type BankCommunicationItem = { id: string; title: string; assetId: string; amountMinor: number; currency: string; status: string; adapter: string; recipient: string; deliveredAt: string; error: string };
type ResearchSnapshotView = {
  reproducibilityHash: string;
  provenance: { ledgerSchemaVersion: number; indexedEvents: number; retainedEvents: number; checkpoint: { blockNumber: string } | null };
  portfolio: { policies: number; claims: number };
  adjudication: { reviewRounds: number; appeals: number; meanClosureLatencyMs: number | null };
  fraudDecisionSupport: { assessments: number; advisoryOnly: boolean };
  evidenceGovernance: { grants: number; accesses: number; grantBackedAccesses: number };
};
type OracleOperationsView = {
  workers: Array<{ oracleId: string; label: string; status: string; registrySource: string; registrySnapshotId: string; registryVersion: number; modelVersion: string; updatedAt: string; lastProcessedBlock: string | number | null; lastProcessedRequestId: string | null; lastError: string | null; counts: { requests: number; commitments: number; reveals: number; verified: number; failed: number }; lastProcessingLatencyMs: number | null }>;
  metrics: { requests: number; pending: number; agreements: number; conflicts: number; timeouts: number; finalized: number };
};

const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const accountGroups: ReadonlyArray<{
  label: string;
  description: string;
  accountIds: readonly DemoAccountId[];
}> = [
  { label: "Insurance", description: "Coverage ownership and insurer governance", accountIds: ["insurer-admin", "policyholder-1"] },
  { label: "Hospital network", description: "Independent institutional invoice registers", accountIds: ["hospital-officer", "hospital-officer-2", "hospital-officer-3", "hospital-officer-4", "hospital-officer-5"] },
  { label: "Independent review", description: "Certificate-bound fixed-quorum decisions", accountIds: ["auditor", "auditor-2", "auditor-3", "auditor-4"] },
  { label: "Banking", description: "External payment execution and reconciliation", accountIds: ["bank-officer"] },
];

const roleLabels: Record<DemoAccount["role"], string> = {
  insurerAdmin: "Administrator",
  policyholder: "Policyholder",
  hospitalOfficer: "Hospital officer",
  auditor: "Auditor",
  bankOfficer: "Bank officer",
};

const commandTemplates = {
  insurerAdmin: [
    ["Register partner", { operation: "createPartnerAgreement", id: "agreement-hospital-1", partnerType: "HOSPITAL", partnerId: "hospital-demo", name: "Dhaka Central Medical Hospital", location: "Dhaka", tier: "Preferred", accessScope: "Read-only invoice verification fields", effectiveDate: "2026-01-01", expiryDate: "2028-12-31" }],
    ["Create package", { operation: "createPolicyPackage", id: "package-1", name: "Essential Health", description: "Core inpatient coverage", premiumMinor: 10000, coverageLimitMinor: 1000000, termsHash: hash }],
    ["Configure package network", { operation: "configurePolicyPackagePartners", id: "package-1", hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' }],
    ["Publish package", { operation: "publishPolicyPackage", id: "package-1" }],
    ["Retire package", { operation: "retirePolicyPackage", id: "package-1" }],
    ["Issue policy", { operation: "issuePolicy", id: "policy-1", packageId: "package-1", policyholderId: "policyholder1", startDate: "2026-01-01", endDate: "2026-12-31" }],
    ["Publish Oracle registry", { operation: "publishOracleRegistrySnapshot", id: "registry-demo-v1", version: 1, rootHash: "c6da6361115c611b091faa9f35836f9f5c8ee0fdbefb6bc0d8cc6fdde571ebcd", rulesVersion: "rules-v1", rulesHash: hash, recordCount: 3 }],
    ["Request Oracle verification", { operation: "requestOracleVerification", requestId: "oracle-request-1", claimId: "claim-1", snapshotId: "registry-demo-v1", modelVersion: "model-v1", modelHash: "c".repeat(64), assignedOracleIdsJson: '["oracle1","oracle2"]', commitDeadline: "2026-09-09T12:00:00Z", revealDeadline: "2026-09-09T12:10:00Z" }],
    ["Route Oracle failure", { operation: "routeOracleFailureToReview", requestId: "oracle-request-1", reviewId: "review-1", assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: 3, rejectionThreshold: 2, deadline: "2026-09-12T12:00:00Z" }],
    ["Open review", { operation: "openClaimReview", claimId: "claim-1", reviewId: "review-1", assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: 3, rejectionThreshold: 2, deadline: "2026-09-09T12:00:00Z" }],
    ["Authorize settlement", { operation: "authorizeSettlement", settlementId: "settlement-1", claimId: "claim-1", sourceAccountId: "bank-insurer-premium", destinationAccountId: "showcase-customer-account" }],
  ],
  policyholder: [
    ["Submit claim", { operation: "submitClaim", id: "claim-1", policyId: "policy-1", hospitalId: "hospital-demo", hospitalInvoiceId: "invoice-1", amountMinor: 250000, incidentDate: "2026-06-15", descriptionHash: hash }],
    ["Appeal claim", { operation: "submitClaimAppeal", appealId: "appeal-1", claimId: "claim-1", reasonCategory: "DOCUMENT_ERROR", reasonHash: hash, descriptionHash: hash, evidenceHash: "", proposedHospitalId: "", proposedAmountMinor: 0, proposedIncidentDate: "", proposedDescriptionHash: "", proposedClinicalReferenceHash: hash }],
  ],
  hospitalOfficer: [
    ["Create invoice", { operation: "createHospitalInvoice", id: "invoice-1", patientReferenceHash: hash, invoiceReferenceHash: hash, treatmentHash: hash, amountMinor: 250000, admissionDate: "2026-06-15", dischargeDate: "2026-06-18", status: "FINALIZED" }],
  ],
  auditor: [
    ["Approve claim", { operation: "recordAuditorDecision", reviewId: "review-1", decisionId: "decision-1", outcome: "APPROVE", reasonHash: hash }],
  ],
  bankOfficer: [
    ["Confirm settlement", { operation: "confirmSettlement", settlementId: "settlement-1", transferId: "payout-transfer-1", bankReferenceHash: hash }],
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
  const [assetType, setAssetType] = useState<AssetType>(initialAccount?.role === "hospitalOfficer" ? "hospital-invoice" : initialAccount?.role === "bankOfficer" ? "account" : "claim");
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
  const [retrievalGrantId, setRetrievalGrantId] = useState("");
  const [retrievalPassphrase, setRetrievalPassphrase] = useState("");
  const [retrieving, setRetrieving] = useState(false);
  const [decryptedEvidence, setDecryptedEvidence] = useState<{ url: string; name: string } | null>(null);
  const [auditClaimId, setAuditClaimId] = useState("");
  const [manualPayment, setManualPayment] = useState({ policyId: "", sourceAccountId: "", destinationAccountId: "bank-insurer-premium", transferId: "", paymentId: "", periodStartDate: "", periodEndDate: "", amountBdt: "", externalReference: "", challengeId: "", otp: "", demoCode: "" });
  const [statementPolicyId, setStatementPolicyId] = useState("");
  const [output, setOutput] = useState("Ready.");
  const [busy, setBusy] = useState(false);
  const [dashboard, setDashboard] = useState<RoleDashboard | null>(initialDashboard);
  const [dashboardLoading, setDashboardLoading] = useState(Boolean(initialAccount && !initialDashboard));
  const [preparedWorkflow, setPreparedWorkflow] = useState<PreparedWorkflow | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [bankCommunications, setBankCommunications] = useState<BankCommunicationItem[]>([]);
  const [eventCheckpoint, setEventCheckpoint] = useState<string>("Not synchronized");
  const [researchSnapshot, setResearchSnapshot] = useState<ResearchSnapshotView | null>(null);
  const [oracleOperations, setOracleOperations] = useState<OracleOperationsView | null>(null);
  const templates = useMemo(() => account ? commandTemplates[account.role] : [], [account]);

  useEffect(() => () => {
    if (decryptedEvidence) URL.revokeObjectURL(decryptedEvidence.url);
  }, [decryptedEvidence]);

  const refreshNotifications = useCallback(async () => {
    try {
      const body = await responseJson(await fetch("/api/operations/notifications", { cache: "no-store" }));
      setNotifications(body.notifications ?? []);
      setEventCheckpoint(body.checkpoint ? `Block ${body.checkpoint.blockNumber}` : "Not synchronized");
    } catch {
      setNotifications([]);
    }
  }, []);

  const refreshBankCommunications = useCallback(async () => {
    try {
      const body = await responseJson(await fetch("/api/operations/banking/communications", { cache: "no-store" }));
      setBankCommunications(body.communications ?? []);
    } catch {
      setBankCommunications([]);
    }
  }, []);

  async function synchronizeEvents() {
    setBusy(true);
    try {
      const body = await responseJson(await fetch("/api/internal/events/sync", { method: "POST" }));
      setOutput(`Indexed ${body.processed} new Fabric events; projection now contains ${body.totalEvents}.`);
      await refreshNotifications();
      if (account?.role === "bankOfficer") await refreshBankCommunications();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Event synchronization failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshResearchSnapshot() {
    setBusy(true);
    try {
      setResearchSnapshot(await responseJson(await fetch("/api/research/snapshot", { cache: "no-store" })));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Research snapshot failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshOracleOperations() {
    setBusy(true);
    try {
      setOracleOperations(await responseJson(await fetch("/api/operations/oracles", { cache: "no-store" })));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Oracle operations health failed");
    } finally {
      setBusy(false);
    }
  }

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
      await refreshNotifications();
      if (signedInAccount.role === "bankOfficer") await refreshBankCommunications();
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

  function updateManualPayment(name: keyof typeof manualPayment, value: string) {
    setManualPayment((current) => ({ ...current, [name]: value }));
  }

  async function requestPremiumOtp() {
    setBusy(true);
    try {
      const body = await responseJson(await fetch("/api/banking/otp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId: manualPayment.policyId, sourceAccountId: manualPayment.sourceAccountId }),
      }));
      setManualPayment((current) => ({ ...current, challengeId: body.challengeId, demoCode: body.demoCode ?? "", otp: body.demoCode ?? "" }));
      setOutput(body.demoCode ? `Demo OTP ${body.demoCode} expires at ${body.expiresAt}.` : `OTP challenge created and delivered by the configured adapter; expires at ${body.expiresAt}.`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "OTP request failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitManualPremium() {
    setBusy(true);
    try {
      if (!manualPayment.challengeId) throw new Error("Request an OTP first.");
      const externalReferenceHash = await sha256Hex(new TextEncoder().encode(manualPayment.externalReference.trim()));
      const body = await responseJson(await fetch("/api/banking/premium-payment", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: manualPayment.challengeId, otp: manualPayment.otp,
          transferId: manualPayment.transferId, paymentId: manualPayment.paymentId, policyId: manualPayment.policyId,
          sourceAccountId: manualPayment.sourceAccountId, destinationAccountId: manualPayment.destinationAccountId,
          periodStartDate: manualPayment.periodStartDate, periodEndDate: manualPayment.periodEndDate,
          amountMinor: bdtToMinor(manualPayment.amountBdt), externalReferenceHash,
        }),
      }));
      setOutput(JSON.stringify(body.result, null, 2));
      setManualPayment((current) => ({ ...current, challengeId: "", otp: "", demoCode: "", externalReference: "" }));
      await refreshDashboard();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Premium payment failed");
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
      const response = await fetch(`/api/evidence/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(retrievalGrantId.trim() ? { grantId: retrievalGrantId.trim() } : {}),
        cache: "no-store",
      });
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
        <p className="presentationOrder"><strong>Suggested handoff:</strong> Insurer → Hospital → Policyholder → Bank → Insurer &amp; Oracles → Auditor → Bank</p>
        <div className="accountGroups">
          {accountGroups.map((group) => <section className="accountGroup" key={group.label}>
            <header className="accountGroupHeader"><div><span className="kicker">{group.label}</span><p>{group.description}</p></div><small>{group.accountIds.length} {group.accountIds.length === 1 ? "identity" : "identities"}</small></header>
            <div className="accountGrid">
              {group.accountIds.map((accountId) => {
                const candidate = demoAccounts[accountId];
                return <button aria-label={`Sign in as ${candidate.displayName}`} disabled={busy} key={candidate.id} onClick={() => login(candidate.id)}>
                  <span className="accountCardTop"><em>{roleLabels[candidate.role]}</em><b aria-hidden="true">↗</b></span>
                  <strong>{candidate.displayName}</strong>
                  <span className="accountIdentity">{candidate.organization}{"subjectId" in candidate ? ` · ${candidate.subjectId}` : ""}</span>
                </button>;
              })}
            </div>
          </section>)}
        </div>
        <pre aria-live="polite" className="console compact">{output}</pre>
      </section>
    );
  }

  return (
    <section className={`shell workspace workspace-${account.role}`}>
      <header className="workspaceHeader">
        <div>
          <span className="kicker">{account.role === "bankOfficer" ? "Independent banking portal" : account.role === "hospitalOfficer" ? "Independent hospital portal" : account.organization}</span>
          <h1 className="workspaceTitle">{account.displayName}</h1>
          <p>{account.role === "bankOfficer" ? "Treasury operations · BDT clearing · EFT mandates" : account.role === "hospitalOfficer" ? "Patient billing register · insurer read-only connection" : <>Application role: <code>{account.role}</code></>}</p>
        </div>
        <div className="workspaceHeaderActions">
          <a className="secondary button" href="/showcase">Presentation board</a>
          <button className="secondary button" onClick={logout}>Sign out</button>
        </div>
      </header>

      {account.role !== "bankOfficer" && account.role !== "hospitalOfficer" && <PresentationGuide role={account.role} />}

      {(account.role === "bankOfficer" || account.role === "hospitalOfficer") && <nav className="partnerPortalNav" aria-label="Partner portal sections">
        <strong>{account.role === "bankOfficer" ? "BDCB Treasury Online" : "Hospital Billing Registry"}</strong>
        <div><a href="#overview">Overview</a><a href="#operations">Operations</a><a href="#transaction-console">Records</a></div>
        <span>Connected to Block-Insure via Fabric Gateway</span>
      </nav>}

      <section className="roleDashboard" id="overview" aria-busy={dashboardLoading}>
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

            {dashboard.accountCards && dashboard.accountCards.length > 0 && <div className="bankAccountGrid">
              {dashboard.accountCards.map((bankAccount) => <article className="bankAccountCard" key={bankAccount.id}>
                <span>{bankAccount.accountType === "INSURER" ? "Corporate settlement account" : bankAccount.label || "Customer account"}</span>
                <strong>{bankAccount.maskedAccount || "**** **** ****"}</strong>
                <b>{new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT" }).format(bankAccount.balanceMinor / 100)}</b>
                <small>{bankAccount.id} · {bankAccount.status}</small>
              </article>)}
            </div>}

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

              {account.role === "hospitalOfficer" ? <article className="recentPanel">
                <span className="kicker">Organizational boundary</span>
                <h3>Independent from Block-Insure</h3>
                <p className="emptyState">This portal maintains Hospital invoices only. The contracted insurer can read verification fields but cannot edit these records.</p>
              </article> : account.role === "bankOfficer" ? <article className="recentPanel bankBoundaryPanel">
                <span className="kicker">Bank responsibility</span>
                <h3>Payments, not insurance decisions</h3>
                <p className="emptyState">This Bank can operate accounts, EFT mandates, premium transfers, and authorized claim payouts. It cannot inspect claim evidence or decide claim eligibility.</p>
              </article> : <article className="recentPanel">
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
              </article>}
            </div>
          </>
        )}
      </section>

      <div className="workGrid" id="operations">
        <article className="workCard">
          <span className="kicker">Event-driven operations</span>
          <h2>Fabric activity inbox</h2>
          <p className="cardNote">Durable, replay-safe projection checkpoint: {eventCheckpoint}. Notifications are derived from committed chaincode events.</p>
          {account.role === "insurerAdmin" && <button className="secondary button" disabled={busy} onClick={synchronizeEvents}>Synchronize Fabric events</button>}
          <button className="textButton" disabled={busy} onClick={refreshNotifications}>Refresh inbox</button>
          {notifications.length === 0 ? <p className="emptyState">No projected events currently require this identity.</p> : (
            <div className="recentList">{notifications.slice(0, 8).map((item) => (
              <div className="queueItem" key={item.id}><div><strong>{item.title}</strong><p>{item.assetId || item.message}</p></div><span className="status">Block {item.blockNumber}</span></div>
            ))}</div>
          )}
        </article>

        {account.role === "bankOfficer" && <article className="workCard">
          <span className="kicker">Bank communications</span>
          <h2>Customer delivery monitor</h2>
          <p className="cardNote">Committed transfers, mandate decisions, and benefit payouts create replay-safe email deliveries. This screen exposes delivery metadata, never OTP codes.</p>
          <button className="textButton" disabled={busy} onClick={refreshBankCommunications}>Refresh deliveries</button>
          {bankCommunications.length === 0 ? <p className="emptyState">No transaction communications have been projected yet.</p> : (
            <div className="recentList">{bankCommunications.slice(0, 12).map((item) => (
              <div className="queueItem" key={item.id}>
                <div><strong>{item.title}</strong><p>{item.assetId} · {new Intl.NumberFormat("en-BD", { style: "currency", currency: item.currency || "BDT" }).format(item.amountMinor / 100)}</p><small>{item.recipient || "recipient pending"}{item.error ? ` · ${item.error}` : ""}</small></div>
                <span className={`status status-${item.status.toLowerCase()}`}>{item.status}{item.adapter ? ` · ${item.adapter}` : ""}</span>
              </div>
            ))}</div>
          )}
        </article>}

        {(account.role === "insurerAdmin" || account.role === "auditor") && <article className="workCard">
          <span className="kicker">Research dashboard</span>
          <h2>Ledger-derived thesis snapshot</h2>
          <p className="cardNote">Current-world-state metrics carry Fabric provenance and a reproducibility hash. They do not claim clinical or causal validity.</p>
          <div className="evidenceActions">
            <button className="primary button" disabled={busy} onClick={refreshResearchSnapshot}>Refresh metrics</button>
            <a className="secondary button" href="/research">Open full dashboard</a>
            <a className="secondary button" download href="/api/research/snapshot?download=1">Download snapshot</a>
          </div>
          {researchSnapshot && <div className="metricGrid">
            <div className="metricCard"><span>Policies / claims</span><strong>{researchSnapshot.portfolio.policies} / {researchSnapshot.portfolio.claims}</strong><small>Current ledger assets</small></div>
            <div className="metricCard"><span>Reviews / appeals</span><strong>{researchSnapshot.adjudication.reviewRounds} / {researchSnapshot.adjudication.appeals}</strong><small>Immutable rounds</small></div>
            <div className="metricCard"><span>Fraud assessments</span><strong>{researchSnapshot.fraudDecisionSupport.assessments}</strong><small>{researchSnapshot.fraudDecisionSupport.advisoryOnly ? "Advisory only" : "Boundary violation"}</small></div>
            <div className="metricCard"><span>Evidence grants / access</span><strong>{researchSnapshot.evidenceGovernance.grants} / {researchSnapshot.evidenceGovernance.accesses}</strong><small>{researchSnapshot.evidenceGovernance.grantBackedAccesses} grant-backed</small></div>
          </div>}
          {researchSnapshot && <p className="cardNote">Schema {researchSnapshot.provenance.ledgerSchemaVersion}; indexed events {researchSnapshot.provenance.indexedEvents}; hash <code>{researchSnapshot.reproducibilityHash.slice(0, 16)}…</code></p>}
        </article>}

        {(account.role === "insurerAdmin" || account.role === "auditor") && <article className="workCard">
          <span className="kicker">Certificate-bound services</span>
          <h2>Oracle operations and consensus</h2>
          <p className="cardNote">Each worker uses a different OracleMSP certificate and independently validates the exact committed registry snapshot. Unrevealed results are never displayed.</p>
          <button className="primary button" disabled={busy} onClick={refreshOracleOperations}>Refresh Oracle health</button>
          {oracleOperations && <>
            <div className="metricGrid">
              <div className="metricCard"><span>Requests / pending</span><strong>{oracleOperations.metrics.requests} / {oracleOperations.metrics.pending}</strong><small>Ledger requests</small></div>
              <div className="metricCard"><span>Exact agreements</span><strong>{oracleOperations.metrics.agreements}</strong><small>positive and negative</small></div>
              <div className="metricCard"><span>Conflicts / timeouts</span><strong>{oracleOperations.metrics.conflicts} / {oracleOperations.metrics.timeouts}</strong><small>auditor fallback outcomes</small></div>
            </div>
            <div className="queueList">{oracleOperations.workers.map((worker) => <div className="queueItem" key={worker.oracleId}>
              <div><div className="queueTitle"><strong>{worker.label} · {worker.oracleId}</strong><span className={`status status-${worker.status.toLowerCase()}`}>{worker.status}</span></div><p>{worker.registrySource} · snapshot {worker.registrySnapshotId || "unavailable"} v{worker.registryVersion} · model {worker.modelVersion || "unavailable"}</p><small>Block {worker.lastProcessedBlock ?? "—"} · request {worker.lastProcessedRequestId ?? "—"} · {worker.lastProcessingLatencyMs ?? "—"} ms</small>{worker.lastError && <p className="evidenceWarning">{worker.lastError}</p>}</div>
              <span>{worker.counts.commitments} commit / {worker.counts.reveals} reveal</span>
            </div>)}</div>
          </>}
        </article>}
      </div>

      <div className="workGrid" id="transaction-console">
        <GuidedWorkflowForm
          key={`${account.role}-${preparedWorkflow?.revision ?? 0}`}
          role={account.role}
          busy={busy}
          prepared={preparedWorkflow}
          onSubmit={submitWorkflow}
        />

        {account.role === "policyholder" && (
          <article className="workCard evidenceCard">
            <span className="kicker">Manual premium</span>
            <h2>Pay with one-time authorization</h2>
            <p className="cardNote">The connected Bank emails an OTP bound to you, this policy, and the selected account. A valid code triggers one atomic customer debit and insurer credit; no EFT mandate is required.</p>
            <div className="evidenceFields">
              <label>Policy ID<input value={manualPayment.policyId} onChange={(event) => updateManualPayment("policyId", event.target.value)} /></label>
              <label>Customer account ID<input value={manualPayment.sourceAccountId} onChange={(event) => updateManualPayment("sourceAccountId", event.target.value)} /></label>
              <label>Insurer account ID<input value={manualPayment.destinationAccountId} onChange={(event) => updateManualPayment("destinationAccountId", event.target.value)} /></label>
              <label>Transfer ID<input value={manualPayment.transferId} onChange={(event) => updateManualPayment("transferId", event.target.value)} /></label>
              <label>Payment ID<input value={manualPayment.paymentId} onChange={(event) => updateManualPayment("paymentId", event.target.value)} /></label>
              <label>Period starts<input type="date" value={manualPayment.periodStartDate} onChange={(event) => updateManualPayment("periodStartDate", event.target.value)} /></label>
              <label>Period ends<input type="date" value={manualPayment.periodEndDate} onChange={(event) => updateManualPayment("periodEndDate", event.target.value)} /></label>
              <label>Premium (BDT)<input inputMode="decimal" value={manualPayment.amountBdt} onChange={(event) => updateManualPayment("amountBdt", event.target.value)} /></label>
              <label>External bank receipt<input value={manualPayment.externalReference} onChange={(event) => updateManualPayment("externalReference", event.target.value)} /></label>
              <label>Six-digit OTP<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={manualPayment.otp} onChange={(event) => updateManualPayment("otp", event.target.value.replace(/\D/g, ""))} /></label>
            </div>
            {manualPayment.demoCode && <p className="evidenceWarning">Local demo delivery code: <strong>{manualPayment.demoCode}</strong></p>}
            <div className="evidenceActions">
              <button className="secondary button" disabled={busy || !manualPayment.policyId || !manualPayment.sourceAccountId} onClick={requestPremiumOtp}>Email OTP</button>
              <button className="primary button" disabled={busy || !manualPayment.challengeId || manualPayment.otp.length !== 6} onClick={submitManualPremium}>Authorize premium</button>
            </div>
          </article>
        )}

        {account.role === "policyholder" && (
          <article className="workCard">
            <span className="kicker">Policy statement</span>
            <h2>Export coverage and payment history</h2>
            <p className="cardNote">Download premiums, reversals, mandates, collections, claims, benefits, and liabilities reconciled to one owned policy.</p>
            <label>Policy ID<input value={statementPolicyId} onChange={(event) => setStatementPolicyId(event.target.value)} placeholder="policy-1" /></label>
            <a aria-disabled={!statementPolicyId.trim()} className={`primary button${statementPolicyId.trim() ? "" : " disabledLink"}`} download href={statementPolicyId.trim() ? `/api/policies/${encodeURIComponent(statementPolicyId.trim())}/statement` : undefined}>Download statement JSON</a>
          </article>
        )}

        <article className="workCard" id="ledger-tools">
          <span className="kicker">Evaluate transaction</span>
          <h2>Find ledger asset</h2>
          <label>Asset type
            <select value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType)}>
              {account.role === "hospitalOfficer" ? <>
                <option value="hospital-invoice">Hospital invoice</option>
                <option value="partner-agreement">Insurer agreement</option>
                <option value="package">Connected policy packages</option>
              </> : account.role === "bankOfficer" ? <>
                <option value="account">Bank account</option><option value="mandate">EFT mandate</option>
                <option value="collection">Premium collection</option><option value="premium-payment">Premium payment</option>
                <option value="premium-adjustment">Premium reversal</option><option value="bank-transfer">Bank transfer</option>
                <option value="settlement">Authorized claim payout</option><option value="liability">Payment liability</option>
                <option value="partner-agreement">Insurer agreement</option>
              </> : <>
              {account.role === "insurerAdmin" && <option value="partner-agreement">Partner agreement</option>}
              {account.role === "insurerAdmin" && <option value="hospital-invoice">Hospital invoice</option>}
              <option value="package">Policy package</option><option value="policy">Policy</option>
              <option value="claim">Claim</option><option value="evidence">Evidence reference</option><option value="evidence-grant">Evidence access grant</option>
              <option value="verification">Invoice cross-check</option><option value="decision">Auditor decision</option>
              <option value="review">Claim review round</option><option value="appeal">Claim appeal</option><option value="fraud-assessment">Fraud assessment</option>
              <option value="settlement">Settlement</option><option value="claim-history">Claim history</option>
              <option value="oracle-snapshot">Oracle registry snapshot</option><option value="oracle-request">Oracle request</option>
              <option value="oracle-commitment">Oracle commitment</option><option value="oracle-result">Oracle revealed result</option><option value="oracle-history">Oracle request history</option>
              <option value="account">Bank account</option><option value="bank-transfer">Bank transfer</option><option value="mandate">Debit mandate</option>
              <option value="premium-payment">Premium payment</option><option value="premium-adjustment">Premium reversal</option><option value="collection">Premium collection</option>
              <option value="benefit-plan">Benefit plan</option><option value="beneficiaries">Beneficiary designation</option>
              <option value="benefit-request">Benefit request</option><option value="liability">Liability</option>
              {(account.role === "insurerAdmin" || account.role === "auditor") && <option value="access">Evidence access log</option>}
              </>}
            </select>
          </label>
          <label>Asset ID<input value={assetId} onChange={(event) => setAssetId(event.target.value)} placeholder="claim-1" /></label>
          <div className="queryActions">
            <button className="primary button" disabled={busy || assetType === "access"} onClick={queryAsset}>Find by ID</button>
            <button className="secondary button" disabled={busy || assetType === "claim-history" || assetType === "oracle-history"} onClick={listAssets}>List all allowed</button>
          </div>
        </article>

        {account.role !== "bankOfficer" && account.role !== "hospitalOfficer" && <article className="workCard advancedCard">
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
        </article>}

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

        {account.role !== "bankOfficer" && account.role !== "hospitalOfficer" && (
          <article className="workCard evidenceCard">
            <span className="kicker">Authorized evidence access</span>
            <h2>Retrieve and decrypt evidence</h2>
            <p className="cardNote">The server validates your organization and the claim state, records this access on Fabric, and returns ciphertext. Decryption and integrity verification happen only in this browser.</p>
            <div className="evidenceFields">
              <label>Evidence ID<input value={retrievalEvidenceId} onChange={(event) => { setRetrievalEvidenceId(event.target.value); setDecryptedEvidence(null); }} placeholder="evidence-1" /></label>
              <label>Grant ID (optional)<input value={retrievalGrantId} onChange={(event) => setRetrievalGrantId(event.target.value)} placeholder="grant-1" /></label>
              <label>Evidence passphrase<input type="password" autoComplete="current-password" value={retrievalPassphrase} onChange={(event) => setRetrievalPassphrase(event.target.value)} /></label>
            </div>
            <div className="evidenceActions">
              <button className="primary button" disabled={busy || retrieving} onClick={retrieveEvidence}>{retrieving ? "Retrieving…" : "Retrieve and decrypt"}</button>
              {decryptedEvidence && <a className="secondary button" download={decryptedEvidence.name} href={decryptedEvidence.url}>Download verified plaintext</a>}
            </div>
          </article>
        )}

        {(account.role === "insurerAdmin" || account.role === "auditor") && (
          <article className="workCard evidenceCard">
            <span className="kicker">Portable audit artifact</span>
            <h2>Export claim dossier</h2>
            <p className="cardNote">Download the ledger-backed claim timeline, Oracle request/commitments/reveals and registry/model provenance, evidence access, reviews, every auditor vote, appeals, fraud advisories, and settlement as one JSON record.</p>
            <div className="auditExport">
              <label>Claim ID<input value={auditClaimId} onChange={(event) => setAuditClaimId(event.target.value)} placeholder="claim-1" /></label>
              <a
                aria-disabled={!auditClaimId.trim()}
                className={`primary button${auditClaimId.trim() ? "" : " disabledLink"}`}
                download
                href={auditClaimId.trim() ? `/api/audit/claims/${encodeURIComponent(auditClaimId.trim())}` : undefined}
              >Download audit JSON</a>
            </div>
          </article>
        )}
      </div>

      <div className="resultHeading" id="gateway-proof"><span className="kicker">Gateway response</span><span>{busy ? "Working…" : "Ready"}</span></div>
      <pre className="console">{output}</pre>
    </section>
  );
}
