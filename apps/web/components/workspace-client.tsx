"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import Link from "next/link";
import { formatBdt } from "@/lib/money";
import {
  demoAccounts,
  workspaceForAccount,
  type DemoAccount,
  type DemoAccountId,
  type WorkspaceAccount,
} from "@/lib/auth/accounts";
import { CustomerPortal } from "@/components/customer-portal";
import { CustomerOnboardingQueue } from "@/components/customer-onboarding-queue";
import type { RoleDashboard } from "@/lib/dashboard/build-dashboard";
import { GuidedWorkflowForm, roleOperations, type PreparedWorkflow } from "@/components/guided-workflow-form";
import { isMedicalChannel, medicalDevLiteChannel } from "@/lib/fabric/medical-channel";
import { MedicalRegistryControls } from "./medical-registry-controls";
import { MedicalIntake } from "@/components/medical-intake";
import { MedicalReview } from "@/components/medical-review";
import { MedicalSettlementTimeline } from "@/components/medical-timeline";
import { MedicalOCR } from "@/components/medical-ocr";
import { WorkspaceIconGlyph } from "@/components/workspace-icon";
import { findSection, overviewSection, sectionForOperation, sectionHref, sectionsFor } from "@/lib/workspace/sections";
import { StatusBadge } from "@/components/status-badge";
import { PremiumCenter } from "@/components/premium-center";
import { BankDesk } from "@/components/bank-desk";
import { PremiumOperations } from "@/components/premium-operations";
import type { WorkflowCommand, WorkflowOperation } from "@/lib/workflows/commands";
import { bdtToMinor, workflowFormDefinitions } from "@/lib/workflows/forms";
import { decryptEvidenceBytes, encryptEvidenceBytes, sha256Hex } from "@/lib/evidence/browser-crypto";
import { createEvidenceRecovery, restoreEvidenceRecovery } from "@/lib/evidence/recovery";
import { recoverableTransactions } from "@/lib/workflows/recoverable";
import { readSavedAction, parseSavedAction, saveAction, savedActionKey, type SavedWorkflowAction } from "@/lib/workflows/saved-action";

type AssetType = "partner-agreement" | "hospital-invoice" | "package" | "policy" | "claim" | "evidence" | "evidence-batch" | "evidence-grant" | "verification" | "decision" | "review" | "appeal" | "fraud-assessment" | "settlement" | "access" | "claim-history" | "account" | "bank-transfer" | "mandate" | "premium-payment" | "premium-adjustment" | "collection" | "benefit-plan" | "beneficiaries" | "benefit-request" | "liability" | "oracle-snapshot" | "oracle-request" | "oracle-commitment" | "oracle-result" | "oracle-history" | "privacy-credential" | "privacy-presentation";
type NotificationItem = { id: string; title: string; message: string; assetId: string; blockNumber: string };
type BankCommunicationItem = { id: string; title: string; assetId: string; amountMinor: number; currency: string; status: string; adapter: string; recipient: string; deliveredAt: string; error: string };
type ResearchSnapshotView = {
  reproducibilityHash: string;
  provenance: { ledgerSchemaVersion: number; indexedEvents: number; retainedEvents: number; checkpoint: { blockNumber: string } | null };
  portfolio: { policies: number; claims: number };
  adjudication: { reviewRounds: number; appeals: number; meanClosureLatencyMs: number | null };
  fraudDecisionSupport: { assessments: number; advisoryOnly: boolean };
  evidenceGovernance: { grants: number; accesses: number; grantBackedAccesses: number };
  privacyPreservingVerification: { credentials: number; presentations: number; privacyBoundOracleRequests: number };
};
type OracleOperationsView = {
  workers: Array<{ oracleId: string; label: string; status: string; registrySource: string; registrySnapshotId: string; registryVersion: number; registryDatasetId?: string | null; registryDatasetVersion?: string | null; registryInputSha256?: string | null; registryTransformationVersion?: string | null; modelVersion: string; updatedAt: string; lastProcessedBlock: string | number | null; lastProcessedRequestId: string | null; lastError: string | null; counts: { requests: number; commitments: number; reveals: number; verified: number; failed: number }; lastProcessingLatencyMs: number | null }>;
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
  insurerAdmin: "Insurer administrator",
  policyholder: "Policyholder",
  hospitalOfficer: "Hospital billing officer",
  auditor: "Independent auditor",
  bankOfficer: "Bank operations officer",
};

const readyOutput = "Ready.";

const commandTemplates = {
  insurerAdmin: [
    ["Register partner", { operation: "createPartnerAgreement", id: "agreement-hospital-1", partnerType: "HOSPITAL", partnerId: "hospital-demo", name: "Dhaka Central Medical Hospital", location: "Dhaka", tier: "Preferred", accessScope: "Read-only invoice verification fields", effectiveDate: "2026-01-01", expiryDate: "2028-12-31" }],
    ["Create package", { operation: "createPolicyPackage", id: "package-1", name: "Essential Health", description: "Core inpatient coverage", premiumMinor: 125000, coverageLimitMinor: 30000000, termsHash: hash }],
    ["Configure package network", { operation: "configurePolicyPackagePartners", id: "package-1", hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' }],
    ["Publish package", { operation: "publishPolicyPackage", id: "package-1" }],
    ["Retire package", { operation: "retirePolicyPackage", id: "package-1" }],
    ["Issue policy", { operation: "issuePolicy", id: "policy-1", packageId: "package-1", policyholderId: "policyholder1", startDate: "2026-01-01", endDate: "2026-12-31" }],
    ["Publish Oracle registry", { operation: "publishOracleRegistrySnapshot", id: "registry-demo-v1", version: 1, rootHash: "c6da6361115c611b091faa9f35836f9f5c8ee0fdbefb6bc0d8cc6fdde571ebcd", rulesVersion: "rules-v1", rulesHash: hash, recordCount: 3 }],
    ["Request Oracle verification", { operation: "requestOracleVerification", requestId: "oracle-request-1", claimId: "claim-1", snapshotId: "registry-demo-v1", modelVersion: "model-v1", modelHash: "c".repeat(64), assignedOracleIdsJson: '["oracle1","oracle2","oracle3"]', requiredConfirmations: 2, commitDeadline: "2026-09-09T12:00:00Z", revealDeadline: "2026-09-09T12:10:00Z" }],
    ["Route Oracle failure", { operation: "routeOracleFailureToReview", requestId: "oracle-request-1", reviewId: "review-1", assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: 3, rejectionThreshold: 2, deadline: "2026-09-12T12:00:00Z" }],
    ["Open review", { operation: "openClaimReview", claimId: "claim-1", reviewId: "review-1", assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: 3, rejectionThreshold: 2, deadline: "2026-09-09T12:00:00Z" }],
    ["Authorize settlement", { operation: "authorizeSettlement", settlementId: "settlement-1", claimId: "claim-1", sourceAccountId: "bank-insurer-premium", destinationAccountId: "showcase-customer-account" }],
  ],
  policyholder: [
    ["Submit claim", { operation: "submitClaim", id: "claim-1", policyId: "policy-1", hospitalId: "hospital-demo", hospitalInvoiceId: "invoice-1", amountMinor: 8500000, incidentDate: "2026-06-15", descriptionHash: hash }],
    ["Appeal claim", { operation: "submitClaimAppeal", appealId: "appeal-1", claimId: "claim-1", reasonCategory: "DOCUMENT_ERROR", reasonHash: hash, descriptionHash: hash, evidenceHash: "", proposedHospitalId: "", proposedAmountMinor: 0, proposedIncidentDate: "", proposedDescriptionHash: "", proposedClinicalReferenceHash: hash }],
  ],
  hospitalOfficer: [
    ["Create invoice", { operation: "createHospitalInvoice", id: "invoice-1", patientReferenceHash: hash, invoiceReferenceHash: hash, treatmentHash: hash, amountMinor: 8500000, admissionDate: "2026-06-15", dischargeDate: "2026-06-18", status: "FINALIZED" }],
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

function subscribeSavedAction(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("fabric-saved-action", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("fabric-saved-action", callback); };
}
function notifySavedAction() { window.dispatchEvent(new Event("fabric-saved-action")); }

type GatewaySummary = {
  status?: string;
  operation?: string;
  identifier?: string;
  version?: string;
  txId?: string;
  count?: number;
};

function parseGatewaySummary(raw: string): GatewaySummary | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return { operation: "List query", count: parsed.length };
    }
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const summary: GatewaySummary = {};
    if (typeof obj.status === "string") summary.status = obj.status;
    else if (typeof obj.state === "string") summary.status = obj.state;
    else if (typeof obj.outcome === "string") summary.status = obj.outcome;
    if (typeof obj.operation === "string") summary.operation = obj.operation;
    else if (typeof obj.docType === "string") summary.operation = obj.docType;
    else if (typeof obj.type === "string") summary.operation = obj.type;
    const idCandidate = obj.id ?? obj.claimId ?? obj.policyId ?? obj.settlementId ?? obj.requestId ?? obj.reviewId ?? obj.evidenceId ?? obj.invoiceId;
    if (typeof idCandidate === "string" && idCandidate) summary.identifier = idCandidate;
    if (typeof obj.version === "number" || typeof obj.version === "string") summary.version = String(obj.version);
    const txCandidate = obj.txId ?? obj.transactionId;
    if (typeof txCandidate === "string" && txCandidate) summary.txId = txCandidate;
    return Object.keys(summary).length > 0 ? summary : null;
  } catch {
    return null;
  }
}

export function WorkspaceClient({
  initialAccount,
  initialDashboard,
  deployment,
  medicalReviewEnabled = false,
  investigationEnabled = false,
  onboardingEnabled = false,
  demoAuthEnabled = false,
  showLegacyPolicyholderLogin = false,
  workspace = "",
  children,
}: {
  initialAccount: WorkspaceAccount | null;
  initialDashboard: RoleDashboard | null;
  deployment: string;
  medicalReviewEnabled?: boolean;
  investigationEnabled?: boolean;
  onboardingEnabled?: boolean;
  demoAuthEnabled?: boolean;
  showLegacyPolicyholderLogin?: boolean;
  workspace?: string;
  children?: React.ReactNode;
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
  const [uploadNotice, setUploadNotice] = useState<{ pending: boolean; message: string } | null>(null);
  const uploadPending = uploadNotice?.pending === true;
  const [plaintextEvidence, setPlaintextEvidence] = useState<File | null>(null);
  const [evidencePassphrase, setEvidencePassphrase] = useState("");
  const [evidencePassphraseConfirmation, setEvidencePassphraseConfirmation] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const [recoveryDownload, setRecoveryDownload] = useState<{ url: string; name: string } | null>(null);
  const [recoveryFile, setRecoveryFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
  const [encrypting, setEncrypting] = useState(false);
  const [retrievalEvidenceId, setRetrievalEvidenceId] = useState("");
  const [retrievalGrantId, setRetrievalGrantId] = useState("");
  const [retrievalPassphrase, setRetrievalPassphrase] = useState("");
  const [retrieving, setRetrieving] = useState(false);
  const [decryptedEvidence, setDecryptedEvidence] = useState<{ url: string; name: string; blob: Blob; id: string; accessId: string; reviewId: string; digest: string } | null>(null);
  const medicalReview = medicalReviewEnabled && isMedicalChannel(deployment.split("/")[0]);
  const [auditClaimId, setAuditClaimId] = useState("");
  const [proofEvidenceId, setProofEvidenceId] = useState("");
  const [proofBatchId, setProofBatchId] = useState("");
  const [manualPayment, setManualPayment] = useState({ policyId: "", sourceAccountId: "", destinationAccountId: "bank-insurer-premium", transferId: "", paymentId: "", periodStartDate: "", periodEndDate: "", amountBdt: "", externalReference: "", challengeId: "", otp: "", demoCode: "", sourceLabel: "" });
  const [statementPolicyId, setStatementPolicyId] = useState("");
  const [output, setOutput] = useState(readyOutput);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [busy, setBusy] = useState(false);
  const gatewaySummary = useMemo(() => parseGatewaySummary(output), [output]);
  const savedSnapshot = useSyncExternalStore(subscribeSavedAction, () => {
    if (!account) return null;
    try { return localStorage.getItem(savedActionKey(deployment, account.id)); } catch { return "unavailable"; }
  }, () => null);
  const savedAction = useMemo(() => {
    if (!savedSnapshot) return null;
    try { return parseSavedAction(savedSnapshot); } catch { return null; }
  }, [savedSnapshot]);
  const [dashboard, setDashboard] = useState<RoleDashboard | null>(initialDashboard);
  const [dashboardLoading, setDashboardLoading] = useState(Boolean(initialAccount && !initialDashboard));
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [preparedWorkflow, setPreparedWorkflow] = useState<PreparedWorkflow | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [bankCommunications, setBankCommunications] = useState<BankCommunicationItem[]>([]);
  const [eventCheckpoint, setEventCheckpoint] = useState<string>("Not synchronized");
  const [researchSnapshot, setResearchSnapshot] = useState<ResearchSnapshotView | null>(null);
  const [oracleOperations, setOracleOperations] = useState<OracleOperationsView | null>(null);
  const templates = useMemo(() => account ? commandTemplates[account.role] : [], [account]);
  const segment = useSelectedLayoutSegment();
  const sectionOptions = useMemo(() => ({ medical: isMedicalChannel(deployment.split("/")[0]), onboarding: onboardingEnabled }), [deployment, onboardingEnabled]);
  const section = account ? findSection(account.role, segment, sectionOptions) : undefined;
  const [preparedSection, setPreparedSection] = useState<string | null>(null);
  const [expandedLists, setExpandedLists] = useState<Record<string, boolean>>({});
  const [pendingScroll, setPendingScroll] = useState<{ section: string; anchor: string } | null>(null);

  // After moving to another sub-page, bring the requested card into view.
  useEffect(() => {
    if (!pendingScroll || section?.id !== pendingScroll.section) return;
    const timer = window.setTimeout(() => {
      document.getElementById(pendingScroll.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingScroll(null);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [pendingScroll, section?.id]);

  function goTo(target: string, anchor?: string) {
    if (section?.id === target) {
      if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (anchor) setPendingScroll({ section: target, anchor });
    router.push(sectionHref(workspace, target));
  }

  // Fill the transaction form on the sub-page that owns the operation.
  function prepare(next: PreparedWorkflow) {
    if (!account) return;
    const operation = typeof next.command.operation === "string" ? next.command.operation : "";
    const target = sectionForOperation(account.role, operation)?.id ?? section?.id ?? overviewSection;
    // An operation this network does not offer (such as the legacy claim form on
    // the medical channel) opens its page without pre-filling a form.
    if (!roleOperations(account.role, sectionOptions.medical, true).includes(operation as WorkflowOperation)) {
      goTo(target);
      return;
    }
    setPreparedWorkflow(next);
    setPreparedSection(target);
    goTo(target, "guided-workflow");
  }

  useEffect(() => () => {
    if (decryptedEvidence) URL.revokeObjectURL(decryptedEvidence.url);
  }, [decryptedEvidence]);
  useEffect(() => () => { if (recoveryDownload) URL.revokeObjectURL(recoveryDownload.url); }, [recoveryDownload]);

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

  const refreshDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const body = await responseJson(await fetch("/api/dashboard", { cache: "no-store" }));
      setDashboard(body.dashboard);
      setDashboardError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dashboard failed to load";
      setDashboard(null);
      setDashboardError(message);
      setOutput(message);
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!account) return;
    const timer = window.setTimeout(() => {
      if (!initialDashboard) void refreshDashboard();
      void refreshNotifications();
      if (account.role === "bankOfficer") void refreshBankCommunications();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [account, initialDashboard, refreshDashboard, refreshNotifications, refreshBankCommunications]);

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

  async function verifyEvidenceProof() {
    setBusy(true);
    try {
      const result = await responseJson(await fetch(`/api/evidence/${encodeURIComponent(proofEvidenceId.trim())}/proof?batchId=${encodeURIComponent(proofBatchId.trim())}`, { cache: "no-store" }));
      setOutput(JSON.stringify(result, null, 2));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Evidence proof verification failed");
    } finally {
      setBusy(false);
    }
  }

  const copyGatewayOutput = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopiedOutput(true);
      window.setTimeout(() => setCopiedOutput(false), 2000);
    } catch {
      setCopiedOutput(false);
    }
  }, [output]);

  async function login(accountId: string) {
    setBusy(true);
    try {
      const body = await responseJson(await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId }),
      }));
      const signedInAccount = body.account as DemoAccount;
      // Session changes require a fresh server-authorized workspace. Rendering
      // optimistic forms here races the pending route and can discard a click.
      setOutput("Opening your workspace…");
      // A new document is intentional at this cookie/role boundary.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/workspace/${workspaceForAccount(signedInAccount)}`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await responseJson(await fetch("/api/auth/logout", { method: "POST" }));
      setAccount(null);
      setDashboard(null);
      setCommand("");
      setEvidencePassphrase("");
      setEvidencePassphraseConfirmation("");
      setRetrievalPassphrase("");
      setBackupPassword("");
      setRestorePassword("");
      setRecoveryFile(null);
      setRecoveryDownload(null);
      setDecryptedEvidence(null);
      setUploadNotice(null);
      setOutput("Signed out.");
      router.push("/workspace");
      router.refresh();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Sign-out failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitWorkflow(payload: WorkflowCommand, recoverOnly = false) {
    setBusy(true);
    try {
      let action: SavedWorkflowAction | null = null;
      const storageKey = account ? savedActionKey(deployment, account.id) : "";
      if (recoverableTransactions[payload.operation]) {
        if (!account) throw new Error("Sign in before submitting this action");
        action = readSavedAction(localStorage, storageKey);
        if (action && JSON.stringify(action.command) !== JSON.stringify(payload)) throw new Error("Recover the saved action before submitting a different instruction");
        action ??= { requestId: crypto.randomUUID(), command: payload };
        saveAction(localStorage, storageKey, action); notifySavedAction();
      }
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json", ...(action ? { "idempotency-key": action.requestId, "x-workflow-deployment": deployment, "x-workflow-recovery": String(recoverOnly) } : {}) },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (action && body.state !== "COMMITTED") {
        const pending = { ...action, state: body.state ?? "PENDING" };
        saveAction(localStorage, storageKey, pending); notifySavedAction();
        setOutput(body.message ?? "Outcome unresolved. Recover the saved action; do not submit another instruction.");
        return;
      }
      if (!response.ok) throw new Error(body.message ?? "Command failed");
      if (action) { localStorage.removeItem(storageKey); notifySavedAction(); }
      setOutput(JSON.stringify(body.result, null, 2));
      await refreshDashboard();
      // Policies, accounts and the insurance card are held by separate panels.
      window.dispatchEvent(new Event("block-insure:coverage-changed"));
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
    setManualPayment((current) => ({ ...current, [name]: value,
      ...(!["otp", "challengeId", "demoCode"].includes(name) ? { challengeId: "", otp: "", demoCode: "" } : {}),
      ...(name === "sourceAccountId" ? { sourceLabel: "" } : {}),
    }));
  }

  async function requestPremiumOtp() {
    setBusy(true);
    try {
      const externalReferenceHash = await sha256Hex(new TextEncoder().encode(manualPayment.externalReference.trim()));
      const body = await responseJson(await fetch("/api/banking/otp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId: manualPayment.policyId, sourceAccountId: manualPayment.sourceAccountId,
          destinationAccountId: manualPayment.destinationAccountId, transferId: manualPayment.transferId, paymentId: manualPayment.paymentId,
          periodStartDate: manualPayment.periodStartDate, periodEndDate: manualPayment.periodEndDate,
          amountMinor: bdtToMinor(manualPayment.amountBdt), externalReferenceHash }),
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
      if (!account) throw new Error("Sign in before authorizing a payment.");
      if (!manualPayment.challengeId) throw new Error("Request an OTP first.");
      const externalReferenceHash = await sha256Hex(new TextEncoder().encode(manualPayment.externalReference.trim()));
      const intent = {
        transferId: manualPayment.transferId, paymentId: manualPayment.paymentId, policyId: manualPayment.policyId,
        sourceAccountId: manualPayment.sourceAccountId, destinationAccountId: manualPayment.destinationAccountId,
        periodStartDate: manualPayment.periodStartDate, periodEndDate: manualPayment.periodEndDate,
        amountMinor: bdtToMinor(manualPayment.amountBdt), externalReferenceHash,
      };
      const pendingKey = `block-insure:premium-intent:${account.id}`;
      const previous = localStorage.getItem(pendingKey);
      if (previous && previous !== JSON.stringify(intent)) throw new Error("Recover the saved payment outcome before authorizing a different payment.");
      localStorage.setItem(pendingKey, JSON.stringify(intent));
      const body = await responseJson(await fetch("/api/banking/premium-payment", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: manualPayment.challengeId, otp: manualPayment.otp,
          ...intent,
        }),
      }));
      setOutput(JSON.stringify(body.result, null, 2));
      if (["SETTLED", "BOUNCED"].includes(body.result?.status)) localStorage.removeItem(pendingKey);
      setManualPayment((current) => ({ ...current, challengeId: "", otp: "", demoCode: "", externalReference: "" }));
      await refreshDashboard();
      // The premium panel and insurance card hold their own copies of the policy.
      window.dispatchEvent(new Event("block-insure:coverage-changed"));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Premium payment failed");
    } finally {
      setBusy(false);
    }
  }

  async function recoverManualPremium() {
    setBusy(true);
    try {
      if (!account) throw new Error("Sign in before recovering a payment.");
      const key = `block-insure:premium-intent:${account.id}`;
      const saved = localStorage.getItem(key);
      if (!saved) throw new Error("No saved payment intent is available in this browser.");
      const outcome = await responseJson(await fetch("/api/banking/premium-payment", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...JSON.parse(saved), recoverOnly: true }),
      }));
      setOutput(JSON.stringify(outcome, null, 2));
      if (["SETTLED", "BOUNCED"].includes(outcome.status)) { localStorage.removeItem(key); await refreshDashboard(); }
    } catch (error) { setOutput(error instanceof Error ? error.message : "Payment recovery unavailable"); }
    finally { setBusy(false); }
  }

  async function uploadEvidence() {
    setBusy(true);
    let uploadStarted = false;
    let definitivelyRejected = false;
    try {
      if (!ciphertext) throw new Error("Choose a client-encrypted .enc file.");
      const form = new FormData();
      form.set("claimId", evidenceClaimId);
      form.set("evidenceId", evidenceId);
      form.set("documentType", documentType);
      form.set("contentHash", contentHash);
      form.set("ciphertext", ciphertext);
      uploadStarted = true;
      const response = await fetch("/api/evidence", { method: "POST", body: form });
      definitivelyRejected = response.status >= 400 && response.status < 500;
      const body = await responseJson(response);
      setUploadNotice({ pending: body.status === "PENDING_RECONCILIATION", message: body.status === "PENDING_RECONCILIATION"
        ? "Registration is unresolved. Keep this page open and retry the original ciphertext; do not re-encrypt or change its identifiers."
        : "Ciphertext is linked to the current claim version on Fabric." });
      setOutput(JSON.stringify(body, null, 2));
      await refreshDashboard();
    } catch (error) {
      const pending = uploadStarted && !definitivelyRejected;
      setUploadNotice({ pending, message: pending
        ? "Upload outcome unresolved. Keep this page open and retry the original ciphertext without changing its identifiers."
        : error instanceof Error ? error.message : "Evidence upload failed" });
      setOutput(error instanceof Error ? error.message : "Evidence upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function encryptEvidence() {
    setEncrypting(true);
    setUploadNotice(null);
    setRecoveryDownload(null);
    try {
      if (!plaintextEvidence) throw new Error("Choose the original evidence file.");
      if (evidencePassphrase !== evidencePassphraseConfirmation) throw new Error("Evidence passphrases do not match.");
      const encrypted = await encryptEvidenceBytes(
        new Uint8Array(await plaintextEvidence.arrayBuffer()),
        evidencePassphrase,
        { claimId: evidenceClaimId.trim(), evidenceId: evidenceId.trim() },
      );
      const safeName = plaintextEvidence.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      if (backupPassword) {
        const backup = await createEvidenceRecovery(evidencePassphrase, backupPassword,
          { claimId: evidenceClaimId.trim(), evidenceId: evidenceId.trim() }, encrypted.contentHash);
        setRecoveryDownload({ url: URL.createObjectURL(new Blob([backup], { type: "application/json" })), name: `${safeName}.bifkey` });
      }
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
      setBackupPassword("");
      setOutput(`Encrypted ${plaintextEvidence.name} locally. Keep the passphrase safe; it cannot be recovered by Block-Insure.`);
    } catch (error) {
      setCiphertext(null);
      setContentHash("");
      setOutput(error instanceof Error ? error.message : "Evidence encryption failed");
    } finally {
      setEncrypting(false);
    }
  }

  async function restoreEvidenceKey() {
    setRetrieving(true);
    try {
      if (!recoveryFile || recoveryFile.size > 16_384) throw new Error("Select a recovery file of at most 16 KiB.");
      const recovered = await restoreEvidenceRecovery(await recoveryFile.text(), restorePassword);
      setRetrievalEvidenceId(recovered.evidenceId);
      setRetrievalPassphrase(recovered.passphrase);
      setDecryptedEvidence(null);
      setRestorePassword("");
      setOutput(`Recovery key restored for ${recovered.evidenceId}. Retrieve the original ciphertext to verify and decrypt it.`);
    } catch (error) { setOutput(error instanceof Error ? error.message : "Recovery file could not be opened"); }
    finally { setRetrieving(false); }
  }

  async function retrieveEvidence() {
    setRetrieving(true);
    setDecryptedEvidence(null);
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
      const blob = new Blob([plaintextBuffer]);
      const next = { url: URL.createObjectURL(blob), name: `${id}.decrypted`, blob, id, digest: expectedHash,
        accessId: response.headers.get("x-evidence-access-id") ?? "", reviewId: response.headers.get("x-evidence-medical-review-id") ?? "" };
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

  async function confirmMedicalReadiness() {
    if (!decryptedEvidence?.reviewId || !decryptedEvidence.accessId) return;
    setBusy(true);
    try {
      const response = await fetch("/api/medical/review", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", reviewId: decryptedEvidence.reviewId, evidenceId: decryptedEvidence.id,
          accessId: decryptedEvidence.accessId, contentHash: decryptedEvidence.digest }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setOutput("Decryption confirmed for the current medical review. Refresh the case to see readiness.");
    } catch (error) { setOutput(error instanceof Error ? error.message : "Decryption confirmation failed"); }
    finally { setBusy(false); }
  }

  if (!account) {
    const staffGroups = accountGroups.map(group => ({
      ...group,
      accountIds: group.accountIds.filter(id => id !== "policyholder-1" || showLegacyPolicyholderLogin),
    })).filter(group => group.accountIds.length);
    return (
      <section className="shell signInPanel">
        <h1 className="workspaceTitle">Sign in to Block-Insure</h1>
        {onboardingEnabled && <section className="customerAccessOptions" aria-labelledby="customer-access-options">
          <h2 id="customer-access-options">Customers</h2>
          <div className="medicalButtonGroup">
            <Link className="primary button" href="/signin">Customer sign-in</Link>
            <Link className="secondary button" href="/signup">Create an insurance account</Link>
          </div>
        </section>}
        {demoAuthEnabled && <section aria-labelledby="staff-sign-in">
          <h2 id="staff-sign-in">Partner staff</h2>
          <div className="accountGroups">
          {staffGroups.map((group) => <section className="accountGroup" key={group.label}>
            <header className="accountGroupHeader"><div><h3 className="kicker" style={{ margin: 0, lineHeight: 1.4 }}>{group.label}</h3><p>{group.description}</p></div><small>{group.accountIds.length} {group.accountIds.length === 1 ? "identity" : "identities"}</small></header>
            <div className="accountGrid">
              {group.accountIds.map((accountId) => {
                const candidate = demoAccounts[accountId];
                return <button type="button" aria-label={`Sign in as ${candidate.displayName}`} disabled={busy} key={candidate.id} onClick={() => login(candidate.id)}>
                  <span className="accountCardTop"><em>{roleLabels[candidate.role]}</em><b aria-hidden="true">↗</b></span>
                  <strong>{candidate.displayName}</strong>
                  <span className="accountIdentity">{candidate.organization}{"subjectId" in candidate ? ` · ${candidate.subjectId}` : ""}</span>
                </button>;
              })}
            </div>
          </section>)}
          </div>
          {output !== readyOutput && <p aria-live="polite" className="signInStatus" role="status">{output}</p>}
        </section>}
        {!onboardingEnabled && !demoAuthEnabled && <p>Sign-in is unavailable for this deployment.</p>}
      </section>
    );
  }

  const customerAccount = onboardingEnabled && account.role === "policyholder" && account.subjectId && account.id === "customer:" + account.subjectId ? account.subjectId : null;
  // Only registered customers have an editable profile.
  const devLite = deployment.startsWith(`${medicalDevLiteChannel}/`);
  // Only registered customers have an editable profile; registry controls exist on dev-lite only.
  const sections = sectionsFor(account.role, sectionOptions)
    .filter((item) => (item.id !== "profile" || customerAccount) && (item.id !== "registry" || devLite));
  const isAdmin = account.role === "insurerAdmin" || account.role === "auditor";
  // Staff queues are work waiting for them; a customer's list is their policies.
  const queueCount = account.role === "policyholder" ? 0 : dashboard?.queue.length ?? 0;
  const identityLine = account.role === "policyholder"
    ? (account.subjectId ? `Member ${account.subjectId}` : "Policyholder")
    : roleLabels[account.role];
  const initials = account.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase()).join("");
  const preparedOperation = preparedWorkflow && section && preparedSection === section.id && typeof preparedWorkflow.command.operation === "string"
    ? preparedWorkflow.command.operation as WorkflowOperation : null;
  const formOperations: WorkflowOperation[] | null = !section ? null
    : section.formOnDemand ? (preparedOperation ? [preparedOperation] : null)
      : section.operations || preparedOperation
        ? [...(section.operations ?? []), ...(preparedOperation && !section.operations?.includes(preparedOperation) ? [preparedOperation] : [])]
        : null;
  // Long lists show their first rows; the rest open on request.
  const visible = <T,>(key: string, items: readonly T[], limit = 6) => expandedLists[key] ? items : items.slice(0, limit);
  const showMore = (key: string, total: number, noun: string, limit = 6) => total > limit
    ? <button type="button" className="textButton showMoreButton" onClick={() => setExpandedLists((current) => ({ ...current, [key]: !current[key] }))}>
      {expandedLists[key] ? "Show fewer" : `Show all ${total} ${noun}`}
    </button> : null;
  const money = (minor: number, currency = "BDT") => new Intl.NumberFormat("en-BD", { style: "currency", currency }).format(minor / 100);
  const medicalChannel = isMedicalChannel(deployment.split("/")[0]);

  const dashboardBlock = <section className="roleDashboard" aria-busy={dashboardLoading} aria-labelledby="dashboard-title">
    <div className="dashboardIntro">
      <h2 id="dashboard-title">{dashboard?.title ?? (dashboardLoading ? "Loading overview…" : "Overview unavailable")}</h2>
      {dashboard?.description && <p>{dashboard.description}</p>}
    </div>
    {dashboardLoading && !dashboard && <div className="metricGrid" aria-hidden="true">
      {[0, 1, 2, 3].map((slot) => <div className="skeletonCard" key={slot}>
        <div className="skeletonLine" style={{ width: "42%" }} /><div className="skeletonMetric" /><div className="skeletonLine" />
      </div>)}
    </div>}
    {!dashboardLoading && !dashboard && <div className="dashboardUnavailable" role="status">
      <div>
        <StatusBadge status="DEGRADED" label="Overview unavailable" tone="pending" />
        <h3>The ledger could not be reached</h3>
        <p>{dashboardError ?? "Live figures could not be loaded. Try again in a moment."}</p>
      </div>
      <button type="button" className="primary button" onClick={refreshDashboard} disabled={dashboardLoading}>Try again</button>
    </div>}
    {dashboard && <>
      <div className="metricGrid">
        {dashboard.metrics.map((metric) => <article className="metricCard" key={metric.label}>
          <span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.hint}</small>
        </article>)}
      </div>
      <div className={account.role === "hospitalOfficer" || account.role === "bankOfficer" ? "dashboardGrid dashboardGridSingle" : "dashboardGrid"}>
        <article className="queuePanel">
          <div className="panelHeading">
            <h3>{dashboard.queueTitle}</h3>
            <button type="button" className="textButton" disabled={dashboardLoading} onClick={refreshDashboard}>Refresh</button>
          </div>
          {dashboard.queue.length === 0 ? <p className="emptyState">Nothing is waiting for you.</p> : <div className="queueList">
            {visible("queue", dashboard.queue).map((item) => <div className="queueItem" key={item.id}>
              <div>
                <div className="queueTitle"><strong>{item.title}</strong><StatusBadge status={item.status} label={item.status.replaceAll("_", " ")} /></div>
                <p>{item.detail}</p>
              </div>
              {item.command && <button type="button" onClick={() => { if (item.command) prepare({ command: item.command, revision: Date.now() }); }}>{item.commandLabel}</button>}
            </div>)}
            {showMore("queue", dashboard.queue.length, "items")}
          </div>}
        </article>
        {account.role !== "hospitalOfficer" && account.role !== "bankOfficer" && <article className="recentPanel">
          <h3>Recently updated claims</h3>
          {dashboard.recentClaims.length === 0 ? <p className="emptyState">No claims yet.</p> : <div className="recentList">
            {visible("recent", dashboard.recentClaims).map((claim) => <button type="button" key={claim.id} onClick={() => {
              if (isAdmin) { setAssetType("claim"); setAssetId(claim.id); goTo("tools", "ledger-tools"); }
              else goTo("claims");
            }}>
              <span><strong>{claim.id}</strong><small>{claim.policyId}</small></span>
              <StatusBadge status={claim.status} label={claim.status.replaceAll("_", " ")} />
            </button>)}
            {showMore("recent", dashboard.recentClaims.length, "claims")}
          </div>}
        </article>}
      </div>
    </>}
  </section>;

  const activityCard = <article className="workCard workCardWide">
    <div className="cardHeading">
      <h2>Recent activity</h2>
      <div className="medicalButtonGroup">
        {account.role === "insurerAdmin" && <button type="button" className="secondary button" disabled={busy} onClick={synchronizeEvents}>Synchronise events</button>}
        <button type="button" className="textButton" disabled={busy} onClick={refreshNotifications}>Refresh</button>
      </div>
    </div>
    <p className="cardNote">{eventCheckpoint === "Not synchronized" ? "Events have not been synchronised yet." : `Synchronised to ${eventCheckpoint.toLowerCase()}.`}</p>
    {notifications.length === 0 ? <p className="emptyState">No recent activity.</p> : <div className="recentList">{visible("activity", notifications, 8).map((item) => (
      <div className="queueItem" key={item.id}><div><strong>{item.title}</strong><p>{item.assetId || item.message}</p></div><StatusBadge status="BLOCK" label={`Block ${item.blockNumber}`} tone="neutral" /></div>
    ))}{showMore("activity", notifications.length, "events", 8)}</div>}
  </article>;

  const communicationsCard = <article className="workCard workCardWide">
    <div className="cardHeading">
      <h2>Customer notifications</h2>
      <button type="button" className="textButton" disabled={busy} onClick={refreshBankCommunications}>Refresh</button>
    </div>
    <p className="cardNote">Emails sent to customers for transfers, mandate decisions and payouts.</p>
    {bankCommunications.length === 0 ? <p className="emptyState">No notifications have been sent yet.</p> : <div className="recentList">{visible("communications", bankCommunications, 8).map((item) => (
      <div className="queueItem" key={item.id}>
        <div><strong>{item.title}</strong><p>{item.assetId} · {money(item.amountMinor, item.currency || "BDT")}</p><small>{item.recipient || "Recipient pending"}{item.error ? ` · ${item.error}` : ""}</small></div>
        <StatusBadge status={item.status} label={item.status} />
      </div>
    ))}{showMore("communications", bankCommunications.length, "notifications", 8)}</div>}
  </article>;

  const reportsCard = <article className="workCard workCardWide">
    <h2>Portfolio metrics</h2>
    <p className="cardNote">Figures are calculated from the current ledger state.</p>
    <div className="evidenceActions">
      <button type="button" className="primary button" disabled={busy} onClick={refreshResearchSnapshot}>Load metrics</button>
      <a className="secondary button" href="/research">Open full report</a>
      <a className="secondary button" download href="/api/research/snapshot?download=1">Download snapshot</a>
    </div>
    {researchSnapshot && <div className="metricGrid" style={{ marginTop: 16 }}>
      <div className="metricCard"><span>Policies / claims</span><strong>{researchSnapshot.portfolio.policies} / {researchSnapshot.portfolio.claims}</strong><small>On the ledger</small></div>
      <div className="metricCard"><span>Reviews / appeals</span><strong>{researchSnapshot.adjudication.reviewRounds} / {researchSnapshot.adjudication.appeals}</strong><small>Review rounds</small></div>
      <div className="metricCard"><span>Fraud assessments</span><strong>{researchSnapshot.fraudDecisionSupport.assessments}</strong><small>{researchSnapshot.fraudDecisionSupport.advisoryOnly ? "Advisory only" : "Check boundary"}</small></div>
      <div className="metricCard"><span>Evidence grants / access</span><strong>{researchSnapshot.evidenceGovernance.grants} / {researchSnapshot.evidenceGovernance.accesses}</strong><small>{researchSnapshot.evidenceGovernance.grantBackedAccesses} by grant</small></div>
      <div className="metricCard"><span>Credentials / proofs</span><strong>{researchSnapshot.privacyPreservingVerification.credentials} / {researchSnapshot.privacyPreservingVerification.presentations}</strong><small>{researchSnapshot.privacyPreservingVerification.privacyBoundOracleRequests} verification requests</small></div>
    </div>}
    {researchSnapshot && <p className="cardNote" style={{ marginTop: 14 }}>Schema {researchSnapshot.provenance.ledgerSchemaVersion} · {researchSnapshot.provenance.indexedEvents} events · snapshot <code>{researchSnapshot.reproducibilityHash.slice(0, 16)}…</code></p>}
  </article>;

  const oracleCard = <article className="workCard workCardWide">
    <div className="cardHeading">
      <h2>Oracle verification</h2>
      <button type="button" className="primary button" disabled={busy} onClick={refreshOracleOperations}>Refresh status</button>
    </div>
    <p className="cardNote">Three independent Oracle workers check each claim against the Hospital record. Two matching results are required; anything else goes to auditor review.</p>
    {oracleOperations && <>
      <div className="metricGrid" style={{ marginTop: 16 }}>
        <div className="metricCard"><span>Requests / pending</span><strong>{oracleOperations.metrics.requests} / {oracleOperations.metrics.pending}</strong><small>Verification requests</small></div>
        <div className="metricCard"><span>Agreements</span><strong>{oracleOperations.metrics.agreements}</strong><small>Matching results</small></div>
        <div className="metricCard"><span>Conflicts / timeouts</span><strong>{oracleOperations.metrics.conflicts} / {oracleOperations.metrics.timeouts}</strong><small>Sent to auditors</small></div>
      </div>
      <div className="queueList" style={{ marginTop: 14 }}>{oracleOperations.workers.map((worker) => <div className="queueItem" key={worker.oracleId}>
        <div><div className="queueTitle"><strong>{worker.label} · {worker.oracleId}</strong><StatusBadge status={worker.status} /></div><p>{worker.registrySource} · snapshot {worker.registrySnapshotId || "unavailable"} v{worker.registryVersion} · model {worker.modelVersion || "unavailable"}</p>{worker.registryDatasetId && <small>{worker.registryDatasetId}@{worker.registryDatasetVersion} · transform {worker.registryTransformationVersion} · input {worker.registryInputSha256?.slice(0, 12)}…</small>}<small>Block {worker.lastProcessedBlock ?? "—"} · request {worker.lastProcessedRequestId ?? "—"} · {worker.lastProcessingLatencyMs ?? "—"} ms</small>{worker.lastError && <p className="evidenceWarning">{worker.lastError}</p>}</div>
        <span>{worker.counts.commitments} commit / {worker.counts.reveals} reveal</span>
      </div>)}</div>
    </>}
  </article>;

  const accountCards = dashboard?.accountCards && dashboard.accountCards.length > 0 ? <section className="workCardWide" aria-labelledby="bank-accounts-heading">
    <h2 id="bank-accounts-heading" className="sectionSubheading">{account.role === "bankOfficer" ? "Accounts held at this Bank" : "Your bank accounts"}</h2>
    <div className="bankAccountGrid">
      {visible("accounts", dashboard.accountCards).map((bankAccount) => <article className="bankAccountCard" key={bankAccount.id}>
        <span>{bankAccount.accountType === "INSURER" ? "Corporate settlement account" : bankAccount.label || "Customer account"}</span>
        <strong>{bankAccount.maskedAccount || "**** **** ****"}</strong>
        <b>{money(bankAccount.balanceMinor)}</b>
        <small>{bankAccount.id} · {bankAccount.status}</small>
      </article>)}
    </div>
    {showMore("accounts", dashboard.accountCards.length, "accounts")}
  </section> : null;

  const savedActionBlock = <>
    {savedSnapshot && !savedAction && <p className="formError workCardWide" role="alert">Saved action storage is unavailable or invalid. Nothing new will be sent until browser storage is usable.</p>}
    {savedAction && <article className="workCard workCardWide savedActionCard" aria-label="Saved workflow action">
      <div className="reviewSummaryRow">
        <h2>Recover saved action</h2>
        <StatusBadge status={savedAction.state ?? "PENDING"} />
      </div>
      <p>{workflowFormDefinitions[savedAction.command.operation].label} · {savedAction.state ?? "Outcome unresolved"}. Check this action before submitting another one.</p>
      <div className="evidenceActions">
        <button type="button" className="primary button" disabled={busy} onClick={() => submitWorkflow(savedAction.command, true)}>Check saved action</button>
        {["INVALID", "REJECTED", "NOT_SUBMITTED"].includes(savedAction.state ?? "") && <button type="button" className="secondary button" disabled={busy} onClick={() => {
          if (!account) return;
          localStorage.removeItem(savedActionKey(deployment, account.id)); notifySavedAction();
          prepare({ command: savedAction.command, revision: Date.now() });
          setOutput("The failed action was cleared. Review it before trying again.");
        }}>Review failed action for a new attempt</button>}
      </div>
    </article>}
  </>;

  const guidedForm = section && formOperations && formOperations.length > 0 ? <GuidedWorkflowForm
    medical={medicalChannel}
    key={`${account.role}-${section.id}-${preparedWorkflow?.revision ?? 0}`}
    role={account.role}
    busy={busy}
    allowed={formOperations}
    title={section.formTitle}
    prepared={preparedSection === section.id ? preparedWorkflow : null}
    onSubmit={submitWorkflow}
  /> : null;

  const paymentReady = Boolean(manualPayment.policyId && manualPayment.sourceAccountId && manualPayment.amountBdt);
  const manualPremiumCard = <article className="workCard evidenceCard workCardWide" id="manual-premium">
    <h2>Pay with one-time authorization</h2>
    {paymentReady ? <>
      <p className="cardNote">A one-time code is emailed to you for these exact payment details. Changing any detail needs a new code.</p>
      <dl className="connectionDetails paymentSummary">
        <dt>Policy</dt><dd>{manualPayment.policyId}</dd>
        <dt>Pay from</dt><dd>{manualPayment.sourceLabel || manualPayment.sourceAccountId}</dd>
        <dt>Amount</dt><dd>{Number.isFinite(Number(manualPayment.amountBdt)) ? formatBdt(Math.round(Number(manualPayment.amountBdt) * 100)) : `BDT ${manualPayment.amountBdt}`}</dd>
        {manualPayment.periodStartDate && <><dt>Period</dt><dd>{manualPayment.periodStartDate} to {manualPayment.periodEndDate}</dd></>}
      </dl>
    </> : <p className="cardNote">Choose <strong>Pay first premium now</strong> or <strong>Pay next installment by OTP</strong> on a policy above.</p>}
    <details className="paymentDetails">
      <summary>{paymentReady ? "Edit payment details" : "Enter payment details manually"}</summary>
    <div className="evidenceFields">
      <label>Policy ID<input spellCheck={false} autoComplete="off" value={manualPayment.policyId} onChange={(event) => updateManualPayment("policyId", event.target.value)} /></label>
      <label>Customer account ID<input spellCheck={false} autoComplete="off" value={manualPayment.sourceAccountId} onChange={(event) => updateManualPayment("sourceAccountId", event.target.value)} /></label>
      <label>Insurer account ID<input spellCheck={false} autoComplete="off" value={manualPayment.destinationAccountId} onChange={(event) => updateManualPayment("destinationAccountId", event.target.value)} /></label>
      <label>Transfer ID<input spellCheck={false} autoComplete="off" value={manualPayment.transferId} onChange={(event) => updateManualPayment("transferId", event.target.value)} /></label>
      <label>Payment ID<input spellCheck={false} autoComplete="off" value={manualPayment.paymentId} onChange={(event) => updateManualPayment("paymentId", event.target.value)} /></label>
      <label>Period starts<input type="date" value={manualPayment.periodStartDate} onChange={(event) => updateManualPayment("periodStartDate", event.target.value)} /></label>
      <label>Period ends<input type="date" value={manualPayment.periodEndDate} onChange={(event) => updateManualPayment("periodEndDate", event.target.value)} /></label>
      <label>Premium (BDT)<input inputMode="decimal" value={manualPayment.amountBdt} onChange={(event) => updateManualPayment("amountBdt", event.target.value)} /></label>
      <label>External bank receipt<input spellCheck={false} autoComplete="off" value={manualPayment.externalReference} onChange={(event) => updateManualPayment("externalReference", event.target.value)} /></label>
    </div>
    </details>
    {(paymentReady || manualPayment.challengeId) && <div className="otpSection">
      <h3>Confirm one-time authorization code</h3>
      <div className="evidenceFields">
        <label>Six-digit OTP<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={manualPayment.otp} onChange={(event) => updateManualPayment("otp", event.target.value.replace(/\D/g, ""))} /></label>
      </div>
      {manualPayment.demoCode && <p className="evidenceWarning">Local demo delivery code: <strong>{manualPayment.demoCode}</strong></p>}
      <div className="evidenceActions" style={{ marginTop: 14 }}>
        <button type="button" className="secondary button" disabled={busy || !manualPayment.policyId || !manualPayment.sourceAccountId} onClick={requestPremiumOtp}>Email OTP</button>
        <button type="button" className="primary button" disabled={busy || !manualPayment.challengeId || manualPayment.otp.length !== 6} onClick={submitManualPremium}>Authorize premium</button>
        <button type="button" className="secondary button" disabled={busy} onClick={recoverManualPremium}>Recover saved payment</button>
      </div>
    </div>}
  </article>;

  const statementCard = <article className="workCard workCardWide">
    <h2>Export coverage and payment history</h2>
    <p className="cardNote">Premiums, mandates, collections, claims and benefits for one of your policies.</p>
    <div className="auditExport">
      <label>Policy ID<input spellCheck={false} autoComplete="off" value={statementPolicyId} onChange={(event) => setStatementPolicyId(event.target.value)} placeholder="policy-1" /></label>
      <a aria-disabled={!statementPolicyId.trim()} tabIndex={statementPolicyId.trim() ? undefined : -1}
        className={`primary button${statementPolicyId.trim() ? "" : " disabledLink"}`} download
        href={statementPolicyId.trim() ? `/api/policies/${encodeURIComponent(statementPolicyId.trim())}/statement` : undefined}>Download statement JSON</a>
    </div>
  </article>;

  const lookupCard = <article className="workCard" id="ledger-tools">
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
          <option value="claim">Claim</option><option value="evidence">Evidence reference</option><option value="evidence-batch">Evidence Merkle batch</option><option value="evidence-grant">Evidence access grant</option>
          <option value="verification">Invoice cross-check</option><option value="decision">Auditor decision</option>
          <option value="review">Claim review round</option><option value="appeal">Claim appeal</option><option value="fraud-assessment">Fraud assessment</option>
          <option value="settlement">Settlement</option><option value="claim-history">Claim history</option>
          <option value="oracle-snapshot">Oracle registry snapshot</option><option value="oracle-request">Oracle request</option>
          <option value="oracle-commitment">Oracle commitment</option><option value="oracle-result">Oracle revealed result</option><option value="oracle-history">Oracle request history</option>
          <option value="privacy-credential">Privacy credential anchor</option><option value="privacy-presentation">Selective disclosure presentation</option>
          <option value="account">Bank account</option><option value="bank-transfer">Bank transfer</option><option value="mandate">Debit mandate</option>
          <option value="premium-payment">Premium payment</option><option value="premium-adjustment">Premium reversal</option><option value="collection">Premium collection</option>
          <option value="benefit-plan">Benefit plan</option><option value="beneficiaries">Beneficiary designation</option>
          <option value="benefit-request">Benefit request</option><option value="liability">Liability</option>
          {isAdmin && <option value="access">Evidence access log</option>}
        </>}
      </select>
    </label>
    <label>Asset ID<input spellCheck={false} autoComplete="off" value={assetId} onChange={(event) => setAssetId(event.target.value)} placeholder="claim-1" /></label>
    <div className="queryActions">
      <button type="button" className="primary button" disabled={busy || assetType === "access"} onClick={queryAsset}>Find by ID</button>
      <button type="button" className="secondary button" disabled={busy || assetType === "claim-history" || assetType === "oracle-history"} onClick={listAssets}>List all allowed</button>
    </div>
  </article>;

  const connectionCard = <article className="workCard">
    <h2>Connection details</h2>
    <dl className="connectionDetails">
      <dt>Organisation</dt><dd>{account.organization}</dd>
      <dt>Role</dt><dd>{roleLabels[account.role]}</dd>
      <dt>Channel</dt><dd><code>{deployment.split("/")[0]}</code></dd>
      <dt>Chaincode</dt><dd><code>{deployment.split("/")[1]}</code></dd>
    </dl>
  </article>;

  const consoleCard = <article className="workCard workCardWide advancedCard">
    <h2>JSON command console</h2>
    <p className="cardNote">Submit a raw ledger command. The forms on the other pages cover day-to-day work.</p>
    <details>
      <summary>Open console</summary>
      <div className="templateButtons">
        {templates.map(([label, template]) => <button type="button" key={label} onClick={() => setCommand(JSON.stringify(template, null, 2))}>{label}</button>)}
      </div>
      <textarea aria-label="Command JSON payload" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Select a command template" spellCheck={false} />
      <button type="button" className="primary button" disabled={busy || !command} onClick={submitCommand}>Submit raw command</button>
    </details>
  </article>;

  const uploadCard = <article className="workCard evidenceCard workCardWide">
    <h2>Encrypt, store, and anchor evidence</h2>
    <p className="cardNote">Files are encrypted in your browser before upload. Only the encrypted file is stored, and the ledger records its fingerprint.</p>
    <div className="evidenceFields">
      <label>Claim ID<input spellCheck={false} autoComplete="off" disabled={busy || encrypting || uploadPending} value={evidenceClaimId} onChange={(event) => { setEvidenceClaimId(event.target.value); setCiphertext(null); setContentHash(""); setRecoveryDownload(null); setUploadNotice(null); }} placeholder="claim-1" /></label>
      <label>Evidence ID<input spellCheck={false} autoComplete="off" disabled={busy || encrypting || uploadPending} value={evidenceId} onChange={(event) => { setEvidenceId(event.target.value); setCiphertext(null); setContentHash(""); setRecoveryDownload(null); setUploadNotice(null); }} placeholder="evidence-1" /></label>
      <label>Document type<input spellCheck={false} autoComplete="off" disabled={busy || encrypting || uploadPending} value={documentType} onChange={(event) => { setDocumentType(event.target.value); setUploadNotice(null); }} /></label>
      <label>Original file<input disabled={busy || encrypting || uploadPending} type="file" onChange={(event) => { setPlaintextEvidence(event.target.files?.[0] ?? null); setCiphertext(null); setContentHash(""); setRecoveryDownload(null); setUploadNotice(null); }} /></label>
      <label>Evidence passphrase<input disabled={busy || encrypting} type="password" autoComplete="new-password" value={evidencePassphrase} onChange={(event) => setEvidencePassphrase(event.target.value)} placeholder="At least 12 characters" /></label>
      <label>Confirm passphrase<input disabled={busy || encrypting} type="password" autoComplete="new-password" value={evidencePassphraseConfirmation} onChange={(event) => setEvidencePassphraseConfirmation(event.target.value)} /></label>
      <label>Separate backup password (optional)<input disabled={busy || encrypting} type="password" autoComplete="new-password" value={backupPassword} onChange={(event) => setBackupPassword(event.target.value)} placeholder="Protect a downloadable recovery key" /></label>
      <label>Original content SHA-256<input className="monoWrap" value={contentHash} readOnly placeholder="Calculated after encryption" /></label>
      <div className="encryptionStatus">
        <strong>{ciphertext ? "Ciphertext ready" : "Not encrypted yet"}</strong>
        <span>{ciphertext ? `${ciphertext.name} · ${ciphertext.size} bytes` : "Choose a file and protect it with a passphrase."}</span>
      </div>
    </div>
    <div className="evidenceActions">
      <button type="button" className="secondary button" disabled={busy || encrypting || uploadPending} onClick={encryptEvidence}>{encrypting ? "Encrypting…" : "Encrypt in browser"}</button>
      <button type="button" className="primary button" disabled={busy || encrypting || !ciphertext} onClick={uploadEvidence}>{uploadPending ? "Retry original ciphertext" : "Store ciphertext and record reference"}</button>
      {recoveryDownload && <a className="secondary button" href={recoveryDownload.url} download={recoveryDownload.name}>Download recovery key</a>}
    </div>
    {uploadPending && uploadNotice && <div className="pendingFreezeBanner" role="status">
      <strong>Upload awaiting retry. The claim and evidence fields are locked until it completes.</strong>
      <p>{uploadNotice.message}</p>
    </div>}
    {!uploadPending && uploadNotice && <p className="evidenceWarning" role="status">{uploadNotice.message}</p>}
    <p className="cardNote" style={{ marginTop: 16 }}>{medicalReview
      ? "For a clarification or appeal, use the document type shown on the case."
      : "An appeal accepts only the APPEAL_DOCUMENT recorded with it."}</p>
    <p className="evidenceWarning">Keep the passphrase, or download the recovery key and remember its backup password. Without either, the file cannot be recovered.</p>
  </article>;

  const retrieveCard = <article className="workCard evidenceCard workCardWide">
    <h2 id="retrieve-evidence">Retrieve and decrypt evidence</h2>
    <p className="cardNote">Access is checked and recorded on the ledger. The file is decrypted only in this browser.</p>
    <div className="evidenceFields">
      <label>Evidence ID<input spellCheck={false} autoComplete="off" disabled={retrieving} value={retrievalEvidenceId} onChange={(event) => { setRetrievalEvidenceId(event.target.value); setDecryptedEvidence(null); }} placeholder="evidence-1" /></label>
      <label>Grant ID (optional)<input spellCheck={false} autoComplete="off" disabled={retrieving} value={retrievalGrantId} onChange={(event) => { setRetrievalGrantId(event.target.value); setDecryptedEvidence(null); }} placeholder="grant-1" /></label>
      <label>Evidence passphrase<input type="password" autoComplete="current-password" value={retrievalPassphrase} onChange={(event) => setRetrievalPassphrase(event.target.value)} /></label>
      <label>Recovery key file<input type="file" accept=".bifkey,application/json" onChange={(event) => setRecoveryFile(event.target.files?.[0] ?? null)} /></label>
      <label>Backup password<input type="password" autoComplete="current-password" value={restorePassword} onChange={(event) => setRestorePassword(event.target.value)} /></label>
    </div>
    <div className="evidenceActions">
      <button type="button" className="primary button" disabled={busy || retrieving} onClick={retrieveEvidence}>{retrieving ? "Retrieving…" : "Retrieve and decrypt"}</button>
      <button type="button" className="secondary button" disabled={busy || retrieving || !recoveryFile} onClick={restoreEvidenceKey}>Restore recovery key</button>
      {decryptedEvidence && <a className="secondary button" download={decryptedEvidence.name} href={decryptedEvidence.url}>Download verified plaintext</a>}
      {medicalReview && decryptedEvidence?.reviewId && <button type="button" className="secondary button" disabled={busy} onClick={confirmMedicalReadiness}>Confirm decryption for this review</button>}
    </div>
    {medicalReview && decryptedEvidence && (account.role === "policyholder" || account.role === "auditor") &&
      <MedicalOCR key={decryptedEvidence.accessId} file={decryptedEvidence.blob} evidenceId={decryptedEvidence.id} accessId={decryptedEvidence.accessId} />}
  </article>;

  const dossierCard = <article className="workCard evidenceCard">
    <h2>Export claim dossier</h2>
    <p className="cardNote">Claim history, verification, evidence access, reviews and settlement in one file.</p>
    <div className="auditExport">
      <label>Claim ID<input spellCheck={false} autoComplete="off" value={auditClaimId} onChange={(event) => setAuditClaimId(event.target.value)} placeholder="claim-1" /></label>
      <a aria-disabled={!auditClaimId.trim()} tabIndex={auditClaimId.trim() ? undefined : -1}
        className={`primary button${auditClaimId.trim() ? "" : " disabledLink"}`} download
        href={auditClaimId.trim() ? `/api/audit/claims/${encodeURIComponent(auditClaimId.trim())}` : undefined}>Download audit JSON</a>
    </div>
  </article>;

  const proofCard = <article className="workCard evidenceCard">
    <h2>Verify anchored evidence</h2>
    <p className="cardNote">Checks that a document belongs to a published evidence batch.</p>
    <div className="evidenceFields">
      <label>Evidence ID<input spellCheck={false} autoComplete="off" value={proofEvidenceId} onChange={(event) => setProofEvidenceId(event.target.value)} placeholder="evidence-1001" /></label>
      <label>Merkle batch ID<input spellCheck={false} autoComplete="off" value={proofBatchId} onChange={(event) => setProofBatchId(event.target.value)} placeholder="evidence-batch-1001" /></label>
    </div>
    <div className="evidenceActions">
      <button type="button" className="primary button" disabled={busy || !proofEvidenceId.trim() || !proofBatchId.trim()} onClick={verifyEvidenceProof}>Verify proof</button>
      <a aria-disabled={!proofEvidenceId.trim() || !proofBatchId.trim()} tabIndex={proofEvidenceId.trim() && proofBatchId.trim() ? undefined : -1}
        className={`secondary button${proofEvidenceId.trim() && proofBatchId.trim() ? "" : " disabledLink"}`} download
        href={proofEvidenceId.trim() && proofBatchId.trim() ? `/api/evidence/${encodeURIComponent(proofEvidenceId.trim())}/proof?batchId=${encodeURIComponent(proofBatchId.trim())}&download=1` : undefined}>Download proof JSON</a>
    </div>
  </article>;

  const reviewCard = medicalReview && account.role !== "hospitalOfficer" && account.role !== "bankOfficer" ? <MedicalReview role={account.role} investigationEnabled={investigationEnabled} onEvidence={(id, grant) => {
    setRetrievalEvidenceId(id); setRetrievalGrantId(grant); setDecryptedEvidence(null);
    goTo(account.role === "policyholder" ? "documents" : account.role === "auditor" ? "reviews" : "evidence", "retrieve-evidence");
  }} /> : null;
  const intakeCard = medicalChannel && (account.role === "insurerAdmin" || account.role === "policyholder")
    ? <MedicalIntake insurer={account.role === "insurerAdmin"} customerMatching={onboardingEnabled && account.role === "insurerAdmin"} onAssociation={prepare} /> : null;

  let content: React.ReactNode = null;
  if (section) switch (`${account.role}:${section.id}`) {
    case "policyholder:overview":
      content = <>{customerAccount && <CustomerPortal key={account.id} memberId={customerAccount} view="card" />}{dashboardBlock}
        {accountCards && <div className="workGrid">{accountCards}</div>}</>; break;
    case "insurerAdmin:overview": case "auditor:overview": case "hospitalOfficer:overview": case "bankOfficer:overview":
      content = dashboardBlock; break;
    case "insurerAdmin:claims":
      content = <div className="workGrid">{reviewCard}{guidedForm}{dossierCard}</div>; break;
    case "auditor:reviews":
      content = <div className="workGrid">{reviewCard}{retrieveCard}{guidedForm}{dossierCard}</div>; break;
    case "insurerAdmin:customers":
      content = <div className="workGrid">{onboardingEnabled && <CustomerOnboardingQueue />}{intakeCard}{guidedForm}</div>; break;
    case "insurerAdmin:products":
      content = <div className="workGrid">{guidedForm}</div>; break;
    case "insurerAdmin:evidence": case "auditor:evidence":
      content = <div className="workGrid">{retrieveCard}{proofCard}{guidedForm}</div>; break;
    case "policyholder:documents":
      content = <div className="workGrid">{uploadCard}{retrieveCard}{proofCard}{guidedForm}</div>; break;
    case "insurerAdmin:partners":
      content = <div className="workGrid">{devLite && <MedicalRegistryControls role="insurerAdmin" />}{guidedForm}</div>; break;
    case "insurerAdmin:premiums":
      content = <div className="workGrid"><PremiumOperations />{guidedForm}</div>; break;
    case "insurerAdmin:verification": case "auditor:verification":
      content = <div className="workGrid">{oracleCard}{guidedForm}</div>; break;
    case "insurerAdmin:reports": case "auditor:reports":
      content = <div className="workGrid">{reportsCard}</div>; break;
    case "insurerAdmin:tools": case "auditor:tools":
      content = <div className="workGrid">{lookupCard}{connectionCard}{consoleCard}</div>; break;
    case "hospitalOfficer:records": case "bankOfficer:records":
      content = <div className="workGrid">{lookupCard}{connectionCard}</div>; break;
    case "policyholder:policies":
      content = <div className="workGrid">{guidedForm}{statementCard}</div>; break;
    case "policyholder:payments":
      content = <div className="workGrid"><PremiumCenter onPreparePayment={(payment) => {
        setManualPayment((current) => ({ ...current, sourceLabel: "", ...payment, challengeId: "", otp: "", demoCode: "" }));
        // Scroll once the card has rendered the payment summary.
        window.setTimeout(() => document.getElementById("manual-premium")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }} />{manualPremiumCard}{guidedForm}</div>; break;
    case "policyholder:claims":
      content = <div className="workGrid">{intakeCard}{reviewCard}{guidedForm}</div>; break;
    case "policyholder:profile":
      content = customerAccount ? <CustomerPortal key={account.id} memberId={customerAccount} view="profile" />
        : <p className="emptyState">A profile is available to registered customers.</p>; break;
    case "hospitalOfficer:intake":
      content = <div className="workGrid">{guidedForm}</div>; break;
    case "hospitalOfficer:registry":
      content = devLite ? <div className="workGrid"><MedicalRegistryControls role="hospitalOfficer" /></div>
        : <p className="emptyState">Registry approvals are not used on this network.</p>; break;
    case "bankOfficer:accounts":
      content = <div className="workGrid">{accountCards}<BankDesk show="links" />{guidedForm}</div>; break;
    case "bankOfficer:collections":
      content = <div className="workGrid"><BankDesk show="collections" />{guidedForm}</div>; break;
    case "bankOfficer:payouts":
      content = <div className="workGrid">{devLite && <MedicalSettlementTimeline />}{guidedForm}</div>; break;
    case "bankOfficer:notifications":
      content = <div className="workGrid">{communicationsCard}{activityCard}</div>; break;
    default:
      content = section.id === "activity" ? <div className="workGrid">{activityCard}</div> : null;
  }

  return (
    <div className={`workspaceShell workspace-${account.role}`}>
      <aside className="workspaceSidebar" aria-label="Workspace">
        <div className="sidebarIdentity">
          <span className="sidebarAvatar" aria-hidden="true">{initials || "BI"}</span>
          <div><strong>{account.displayName}</strong><small>{identityLine}</small></div>
        </div>
        <nav className="sidebarNav" aria-label="Workspace pages">
          <ul>
            {sections.map((item) => <li key={item.id}>
              <Link href={sectionHref(workspace, item.id)} aria-current={section?.id === item.id ? "page" : undefined} className="sidebarLink">
                <WorkspaceIconGlyph name={item.icon} />
                <span>{item.label}</span>
                {item.id === overviewSection && queueCount > 0 && <span className="sidebarBadge" aria-label={`${queueCount} waiting`}>{queueCount}</span>}
              </Link>
            </li>)}
          </ul>
        </nav>
        <div className="sidebarFooter">
          <button type="button" className="secondary button" disabled={busy} onClick={logout}>Sign out</button>
        </div>
      </aside>

      <section className="workspaceContent" aria-labelledby={section ? "workspace-page-title" : undefined}>
        {section ? <>
          <header className="pageHeader">
            <div>
              <h1 id="workspace-page-title" className="pageTitle">{section.title}</h1>
              <p>{section.description}</p>
            </div>
            {busy && <span className="pageBusy" role="status">Working…</span>}
          </header>
          {(savedAction || savedSnapshot) && <div className="workGrid savedActionRow">{savedActionBlock}</div>}
          {content}
          {output !== readyOutput && <section className="resultPanel" aria-label="Last result">
            <div className="resultPanelHeading">
              <h2>Last result</h2>
              <div className="evidenceActions" style={{ alignItems: "center" }}>
                {gatewaySummary?.status && <StatusBadge status={gatewaySummary.status} />}
                <span role="status" className="copyStatus">{copiedOutput ? "Copied" : ""}</span>
                <button type="button" className="textButton" onClick={copyGatewayOutput}>Copy</button>
                <button type="button" className="textButton" onClick={() => setOutput(readyOutput)}>Dismiss</button>
              </div>
            </div>
            {gatewaySummary && <div className="responseSummaryGrid">
              {gatewaySummary.identifier && <div><span>Identifier</span><strong>{gatewaySummary.identifier}</strong></div>}
              {gatewaySummary.operation && <div><span>Record</span><strong>{gatewaySummary.operation}</strong></div>}
              {gatewaySummary.version && <div><span>Version</span><strong>{gatewaySummary.version}</strong></div>}
              {gatewaySummary.count !== undefined && <div><span>Items returned</span><strong>{gatewaySummary.count}</strong></div>}
              {gatewaySummary.txId && <div><span>Transaction ID</span><strong>{gatewaySummary.txId}</strong></div>}
            </div>}
            <pre aria-live="polite" className="console">{output}</pre>
          </section>}
        </> : children}
      </section>
    </div>
  );
}
