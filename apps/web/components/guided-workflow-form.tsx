"use client";

import { useEffect, useRef, useState } from "react";
import type { FabricRole } from "@/lib/fabric/config";
import { formatBdt } from "@/lib/money";
import type { PublishedMedicalOffer } from "@/lib/fabric/medical";
import type { WorkflowCommand, WorkflowOperation } from "@/lib/workflows/commands";
import {
  applyCommandPreset,
  buildWorkflowCommand,
  createWorkflowFormValues,
  operationsByRole,
  workflowFormDefinitions,
  type WorkflowFormValues,
} from "@/lib/workflows/forms";

export type PreparedWorkflow = {
  command: Record<string, unknown>;
  revision: number;
};

const actionGroups: ReadonlyArray<{ label: string; operations: ReadonlySet<string> }> = [
  {
    label: "Claims & Adjudication",
    operations: new Set([
      "startClaimProcessing", "openClaimReview", "finalizeExpiredReview", "authorizeSettlement",
      "assessClaimFraud", "submitClaim", "submitClaimAppeal", "registerClaimPrivacyPresentation",
      "verifyMedicalAssociation", "configureMedicalRules", "registerMedicalOracleBenchmark",
    ]),
  },
  {
    label: "Oracle Consensus",
    operations: new Set([
      "publishOracleRegistrySnapshot", "requestOracleVerification", "finalizeOracleTimeout", "routeOracleFailureToReview",
    ]),
  },
  {
    label: "Policies & Coverage",
    operations: new Set([
      "createPolicyPackage", "configurePolicyPackagePartners", "publishPolicyPackage", "retirePolicyPackage",
      "issuePolicy", "issuePolicyPrivacyCredential", "revokePolicyPrivacyCredential", "advancePolicyLifecycle", "reinstatePolicy",
      "cancelPolicyAsInsurer", "acquirePolicy", "acquireMedicalPolicy", "renewPolicy", "cancelPolicy", "setBeneficiaries",
    ]),
  },
  {
    label: "Partners, Benefits & Evidence",
    operations: new Set([
      "createPartnerAgreement", "setPartnerAgreementStatus", "createBenefitPlan", "publishBenefitPlan", "retireBenefitPlan",
      "decideBenefitRequest", "markBenefitPaymentReady", "publishEvidenceMerkleBatch", "submitBenefitRequest",
      "grantEvidenceAccess", "revokeEvidenceAccess",
    ]),
  },
  {
    label: "Hospital Billing & Intake",
    operations: new Set([
      "createHospitalInvoice", "updateHospitalInvoice", "recordHospitalModelFacts",
      "issueInvoicePrivacyCredential", "revokeInvoicePrivacyCredential", "saveMedicalEpisode",
    ]),
  },
  {
    label: "Banking, Mandates & Settlement",
    operations: new Set([
      "queuePremiumCollection", "requestBankMandate", "cancelBankMandate", "openBankAccount",
      "adjustBankAccountBalance", "reviewBankMandate", "recordPremiumAdjustment", "processPremiumCollection",
      "expireBankMandate", "confirmBenefitPayment", "confirmSettlement",
      "requestBankAccountLink", "reviewBankAccountLink", "cancelBankAccountLink", "schedulePremiumCollections", "retryPremiumCollection",
    ]),
  },
];

function groupOperations(operations: readonly WorkflowOperation[]) {
  const matched = new Set<WorkflowOperation>();
  const groups = actionGroups
    .map((group) => {
      const items = operations.filter((op) => {
        if (!group.operations.has(op)) return false;
        matched.add(op);
        return true;
      });
      return { label: group.label, items };
    })
    .filter((group) => group.items.length > 0);
  const unassigned = operations.filter((op) => !matched.has(op));
  if (unassigned.length > 0) {
    groups.push({ label: "Additional actions", items: unassigned });
  }
  return groups;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type GuidedWorkflowFormProps = {
  role: FabricRole;
  busy: boolean;
  prepared: PreparedWorkflow | null;
  onSubmit: (command: WorkflowCommand) => Promise<void>;
  medical?: boolean;
  /** Limits the form to the operations of the current workspace page. */
  allowed?: readonly WorkflowOperation[];
  title?: string;
};

export function roleOperations(role: FabricRole, medical: boolean, maintenance = false): readonly WorkflowOperation[] {
  return medical && role === "hospitalOfficer" ? ["saveMedicalEpisode"]
    : medical && role === "insurerAdmin" ? [...operationsByRole[role].filter((operation) => operation !== "issuePolicy"), "configureMedicalRules", "verifyMedicalAssociation", "registerMedicalOracleBenchmark"]
    : medical && role === "policyholder" ? ["acquireMedicalPolicy", ...operationsByRole[role].filter((operation) => !["acquirePolicy", "renewPolicy", "submitClaim", "submitClaimAppeal"].includes(operation))]
    : role === "hospitalOfficer" && maintenance
    ? [...operationsByRole[role], "issueInvoicePrivacyCredential", "revokeInvoicePrivacyCredential"]
    : operationsByRole[role];
}

export function GuidedWorkflowForm(props: GuidedWorkflowFormProps) {
  const [maintenance, setMaintenance] = useState(false);
  const available = roleOperations(props.role, props.medical ?? false, maintenance);
  // A workspace page lists its operations in its own order.
  const operations = props.allowed ? props.allowed.filter((operation) => available.includes(operation)) : available;
  if (operations.length === 0) return null;
  return <GuidedWorkflowFormBody {...props} operations={operations} maintenance={maintenance} setMaintenance={setMaintenance} />;
}

function GuidedWorkflowFormBody({
  role,
  busy,
  prepared,
  onSubmit,
  medical = false,
  title,
  operations,
  maintenance,
  setMaintenance,
}: GuidedWorkflowFormProps & { operations: readonly WorkflowOperation[]; maintenance: boolean; setMaintenance: (next: boolean) => void }) {
  const preparedOperation = typeof prepared?.command.operation === "string"
    && operations.includes(prepared.command.operation as never)
    ? prepared.command.operation as WorkflowOperation
    : null;
  const initialOperation = preparedOperation ?? operations[0];
  const [operation, setOperation] = useState<WorkflowOperation>(initialOperation);
  const [values, setValues] = useState<WorkflowFormValues>(() => {
    const initial = createWorkflowFormValues(initialOperation);
    return preparedOperation && prepared
      ? applyCommandPreset(preparedOperation, initial, prepared.command)
      : initial;
  });
  const [formError, setFormError] = useState("");
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const [offers, setOffers] = useState<PublishedMedicalOffer[]>([]);
  const [payoutNote, setPayoutNote] = useState("");

  useEffect(() => {
    if (formError && errorRef.current) {
      errorRef.current.focus();
    }
  }, [formError]);
  const selectedOffer = offers.find(offer => offer.id === values.packageId);
  const exampleBillMinor = 8_500_000;
  const exampleEligible = selectedOffer ? Math.min(exampleBillMinor, selectedOffer.rules.serviceSublimitMinor) : 0;
  const exampleDeductible = selectedOffer ? Math.min(Math.floor(exampleEligible * selectedOffer.rules.deductibleBps / 10_000), selectedOffer.rules.deductibleCapMinor) : 0;
  const exampleShare = selectedOffer ? Math.floor((exampleEligible - exampleDeductible) * selectedOffer.rules.insurerShareBps / 10_000) : 0;
  const examplePayable = Math.min(exampleShare, selectedOffer?.coverageLimitMinor ?? 0);
  const termDays = (Date.parse(values.endDate) - Date.parse(values.startDate)) / 86_400_000 + 1;
  const definition = workflowFormDefinitions[operation];
  const portalCopy = role === "bankOfficer"
    ? { heading: "Banking instruction", submit: "Submit bank instruction" }
    : role === "hospitalOfficer"
      ? { heading: medical ? "Patient intake" : "Billing record", submit: medical ? "Save intake" : "Save invoice record" }
      : { heading: "New transaction", submit: "Submit verified transaction" };
  const heading = operations.length === 1 ? definition.label : title ?? portalCopy.heading;

  function selectOperation(nextOperation: WorkflowOperation) {
    setOperation(nextOperation);
    setValues(createWorkflowFormValues(nextOperation));
    setFormError("");
    setPayoutNote("");
  }

  // Fills the payout accounts for the entered claim: the claimant's verified
  // account and the Insurer's claims reserve at one of the policy's Banks.
  async function findPayoutAccounts(automatic = false) {
    setFormError("");
    setPayoutNote("");
    try {
      const claim = values.claimId?.trim();
      if (!claim) throw new Error("Enter the claim ID first.");
      const response = await fetch("/api/insurer/settlement-accounts?" + new URLSearchParams({ claim }), { cache: "no-store" });
      const result = await response.json().catch(() => null) as null | { message?: string;
        source: { id: string; accountLabel: string; maskedAccount: string; balanceMinor: number };
        destination: { id: string; accountLabel: string; maskedAccount: string } };
      if (!response.ok || !result?.source) throw new Error(result?.message ?? "Payout accounts could not be found.");
      setValues(current => ({ ...current, sourceAccountId: result.source.id, destinationAccountId: result.destination.id }));
      setPayoutNote(`Pays from ${result.source.accountLabel} ${result.source.maskedAccount} (balance ${formatBdt(result.source.balanceMinor)}) to the claimant's ${result.destination.accountLabel} ${result.destination.maskedAccount}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payout accounts could not be found.";
      if (automatic) setPayoutNote(`${message} Enter the accounts manually.`);
      else setFormError(message);
    }
  }

  // A settlement opened from the action queue looks up its payout accounts at once.
  const autoPayout = useRef(preparedOperation === "authorizeSettlement");
  useEffect(() => {
    if (!autoPayout.current) return;
    autoPayout.current = false;
    void findPayoutAccounts(true);
    // Runs once for the prepared claim; later lookups use the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadOffers() {
    try {
      setFormError("");
      const response = await fetch("/api/medical/offers", { cache: "no-store" });
      if (!response.ok) throw new Error("Published medical offers are unavailable.");
      const result = await response.json() as { offers: PublishedMedicalOffer[] };
      setOffers(result.offers);
      if (!result.offers.length) setFormError("No medical packages have been published.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not load medical offers.");
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    try {
      await onSubmit(await buildWorkflowCommand(operation, values, sha256));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The workflow form is invalid.");
    }
  }

  return (
    <article className="workCard guidedCard workCardWide" id="guided-workflow" aria-label={heading}>
      <h2>{heading}</h2>
      {role === "hospitalOfficer" && !medical && <details><summary>Credential maintenance</summary>
        <p className="cardNote">Credentials are issued automatically when an invoice is finalized. Voiding that invoice revokes its automatic credential.</p>
        <label className="checkboxLabel"><input type="checkbox" checked={maintenance} onChange={(event) => { setMaintenance(event.target.checked); selectOperation("createHospitalInvoice"); }} />Show issuer maintenance actions</label>
      </details>}
      {operations.length > 1 && <label>Action
        <select
          aria-label="Workflow action"
          value={operation}
          onChange={(event) => selectOperation(event.target.value as WorkflowOperation)}
        >
          {operations.length > 4
            ? groupOperations(operations).map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((candidate) => (
                  <option key={candidate} value={candidate}>{workflowFormDefinitions[candidate].label}</option>
                ))}
              </optgroup>
            ))
            : operations.map((candidate) => (
              <option key={candidate} value={candidate}>{workflowFormDefinitions[candidate].label}</option>
            ))}
        </select>
      </label>}
      <p className="cardNote workflowDescription">{definition.description}</p>
      {operation === "acquireMedicalPolicy" && <div className="guidedForm">
        <button type="button" className="secondary button" onClick={loadOffers}>Load published packages</button>
        <label>Medical package<select value={values.packageId ?? ""} onChange={(event) => {
          setValues(current => ({ ...current, packageId: event.target.value, acceptedTermsHash: "" }));
        }}><option value="">Select a package</option>
          {offers.map(offer => <option key={offer.id} value={offer.id}>{offer.name}</option>)}
        </select></label>
        {selectedOffer && <div className="wideField medicalSubpanel">
          <p>{formatBdt(selectedOffer.premiumMinor)} per 30-day period, due at the start of each period. The start date can be today or up to 60 days ahead, and the term is at most one year. Cover is never backdated: it begins on the start date, or on the payment date if the first premium is paid later.</p>
          <p>An installment still unpaid 15 days after its due date lapses the policy. Missed installments cannot be paid afterwards; only reinstatement by the Insurer, with a new installment from that day, restores cover, and the lapse gap stays uncovered. Only paid dates qualify.</p>
          <p>{selectedOffer.rules.service} is covered. Other service categories are excluded. Service sublimit {formatBdt(selectedOffer.rules.serviceSublimitMinor)}, deductible {selectedOffer.rules.deductibleBps / 100}% capped at {formatBdt(selectedOffer.rules.deductibleCapMinor)}, insurer share {selectedOffer.rules.insurerShareBps / 100}%, overall limit {formatBdt(selectedOffer.coverageLimitMinor)}.</p>
          <p>{selectedOffer.rules.waitingDays > 0
            ? `The hospital stay must begin at least ${selectedOffer.rules.waitingDays} days after cover starts, and again after any reinstatement;`
            : "There is no waiting period: a stay that begins on or after the day cover starts qualifies;"} a stay that began before cover is excluded. File within {selectedOffer.rules.filingDays} days of service, Asia/Dhaka. {selectedOffer.rules.evidenceRequired ? "Upload supporting invoice evidence." : "A complete verified episode can support routine processing."} Each monetary adjustment rounds down to the minor unit.</p>
          {Number.isFinite(termDays) && termDays > 1 && <p>{Math.ceil(termDays / 30)} installments for the dates selected below. The first is due on {values.startDate}, then every 30 days through the final coverage period.</p>}
          <p>Example: a {formatBdt(exampleBillMinor)} bill yields {formatBdt(exampleEligible)} eligible, {formatBdt(exampleDeductible)} deductible and {formatBdt(exampleShare)} insurer share. With the full policy limit still available, {formatBdt(examplePayable)} is payable.</p>
          <label className="checkboxLabel"><input type="checkbox" checked={values.acceptedTermsHash === selectedOffer.rules.termsHash} onChange={(event) => {
            setValues(current => ({ ...current, acceptedTermsHash: event.target.checked ? selectedOffer.rules.termsHash : "" }));
          }} />I accept these published terms</label>
        </div>}
      </div>}
      <form className="guidedForm" onSubmit={submit}>
        {definition.fields.filter(field => operation !== "acquireMedicalPolicy" || !["packageId", "acceptedTermsHash"].includes(field.name)).map((field) => {
          const helpId = field.help ? `field-help-${operation}-${field.name}` : undefined;
          return (
            <label className={field.kind === "textarea" ? "wideField" : undefined} key={field.name}>
              {field.label}
              {field.kind === "select" ? (
                <select
                  name={field.name}
                  value={values[field.name] ?? ""}
                  aria-describedby={helpId}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                >
                  {field.options?.map((option) => <option key={option}>{option}</option>)}
                </select>
              ) : field.kind === "textarea" ? (
                <textarea
                  name={field.name}
                  value={values[field.name] ?? ""}
                  placeholder={field.placeholder}
                  aria-describedby={helpId}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              ) : (
                <input
                  name={field.name}
                  value={values[field.name] ?? ""}
                  type={field.kind === "date" ? "date" : "text"}
                  inputMode={field.kind === "money" ? "decimal" : undefined}
                  placeholder={field.placeholder}
                  aria-describedby={helpId}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              )}
              {field.help && <small id={helpId}>{field.help}</small>}
            </label>
          );
        })}
        {operation === "authorizeSettlement" && <div className="wideField medicalButtonGroup">
          <button type="button" className="secondary button" onClick={() => void findPayoutAccounts()}>Find payout accounts</button>
          {payoutNote && <p className="cardNote" role="status">{payoutNote}</p>}
        </div>}
        {formError && <p ref={errorRef} tabIndex={-1} className="formError" role="alert">{formError}</p>}
        <button className="primary button guidedSubmit" disabled={busy} aria-busy={busy} type="submit">
          {busy ? "Submitting…" : portalCopy.submit}
        </button>
      </form>
    </article>
  );
}
