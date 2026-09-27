import { createHash } from "node:crypto";
import { canonicalProtocolHash } from "./protocol.mjs";

export const PRIVACY_PROTOCOL_VERSION = "block-insure-selective-disclosure-v1";
export const PRIVACY_LEAF_ENCODING = "block-insure-credential-leaf-v1";

const invoiceFields = new Set(["admissionDate", "amountMinor", "dischargeDate", "hospitalId", "invoiceId", "invoiceReferenceHash", "status"]);
const policyFields = new Set(["coverageLimitMinor", "endDate", "policyId", "policyholderId", "startDate", "status"]);

export function privacyLeafHash(disclosure) {
  return canonicalProtocolHash(
    PRIVACY_LEAF_ENCODING,
    disclosure.credentialId,
    disclosure.credentialVersion,
    disclosure.name,
    disclosure.value,
    String(disclosure.salt).toLowerCase(),
  );
}

export function privacyParentHash(left, right) {
  return canonicalProtocolHash(`${PRIVACY_PROTOCOL_VERSION}:node`, String(left).toLowerCase(), String(right).toLowerCase());
}

export function verifyDisclosure(disclosure, rootHash) {
  let computed = privacyLeafHash(disclosure);
  for (const step of disclosure.proof ?? []) {
    if (!/^[a-f0-9]{64}$/i.test(step.hash)) return false;
    if (step.position === "LEFT") computed = privacyParentHash(step.hash, computed);
    else if (step.position === "RIGHT") computed = privacyParentHash(computed, step.hash);
    else return false;
  }
  return computed === String(rootHash).toLowerCase();
}

function valuesFor(disclosures, credentialId, required) {
  const values = new Map();
  for (const disclosure of disclosures) {
    if (disclosure.credentialId !== credentialId) continue;
    if (values.has(disclosure.name)) throw new Error(`Duplicate disclosure ${credentialId}.${disclosure.name}`);
    values.set(disclosure.name, disclosure.value);
  }
  for (const name of required) if (!values.has(name)) throw new Error(`Missing disclosure ${credentialId}.${name}`);
  return Object.fromEntries(values);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validSemantics(claim, invoice, policy) {
  const amount = Number(invoice.amountMinor);
  const limit = Number(policy.coverageLimitMinor);
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(limit) || amount < 0 || limit < amount) return false;
  if (invoice.invoiceId !== claim.hospitalInvoiceId || invoice.hospitalId !== claim.hospitalId || amount !== claim.amountMinor || invoice.status !== "FINALIZED") return false;
  if (policy.policyId !== claim.policyId || policy.policyholderId !== claim.claimantId || policy.status !== "ACTIVE") return false;
  const dates = [claim.incidentDate, invoice.admissionDate, invoice.dischargeDate, policy.startDate, policy.endDate];
  if (!dates.every(validDate)) return false;
  return claim.incidentDate >= invoice.admissionDate && claim.incidentDate <= invoice.dischargeDate
    && claim.incidentDate >= policy.startDate && claim.incidentDate <= policy.endDate;
}

export function verifySelectiveDisclosurePresentation({ request, claim, publicPresentation, privatePresentation, invoiceCredential, policyCredential, now = Date.now() }) {
  if (!request.privacyPresentationId) return { valid: true, code: "LEGACY_NO_PRESENTATION" };
  if (!publicPresentation || !privatePresentation) return { valid: false, code: "PRIVACY_PRESENTATION_MISSING" };
  if (publicPresentation.id !== request.privacyPresentationId
    || publicPresentation.presentationHash !== request.privacyPresentationHash
    || publicPresentation.protocolVersion !== request.privacyProtocolVersion
    || publicPresentation.protocolVersion !== PRIVACY_PROTOCOL_VERSION
    || publicPresentation.claimId !== request.claimId
    || publicPresentation.claimVersion !== request.claimVersion
    || privatePresentation.presentationId !== publicPresentation.id
    || privatePresentation.claimId !== request.claimId
    || privatePresentation.claimVersion !== request.claimVersion) {
    return { valid: false, code: "PRIVACY_PROOF_INVALID" };
  }
  if (now >= Date.parse(publicPresentation.expiresAt) || now >= Date.parse(privatePresentation.expiresAt)) {
    return { valid: false, code: "PRIVACY_PRESENTATION_EXPIRED" };
  }
  if (!invoiceCredential || !policyCredential
    || invoiceCredential.id !== publicPresentation.invoiceCredentialId
    || policyCredential.id !== publicPresentation.policyCredentialId
    || invoiceCredential.rootHash !== publicPresentation.invoiceRootHash
    || policyCredential.rootHash !== publicPresentation.policyRootHash
    || invoiceCredential.status !== "ACTIVE" || policyCredential.status !== "ACTIVE"
    || now >= Date.parse(invoiceCredential.expiresAt) || now >= Date.parse(policyCredential.expiresAt)) {
    return { valid: false, code: "PRIVACY_CREDENTIAL_INACTIVE" };
  }
  const serialized = JSON.stringify(privatePresentation);
  const presentationHash = createHash("sha256").update(serialized, "utf8").digest("hex");
  if (presentationHash !== publicPresentation.presentationHash) return { valid: false, code: "PRIVACY_PROOF_INVALID" };
  try {
    const invoice = valuesFor(privatePresentation.disclosures, publicPresentation.invoiceCredentialId, invoiceFields);
    const policy = valuesFor(privatePresentation.disclosures, publicPresentation.policyCredentialId, policyFields);
    for (const disclosure of privatePresentation.disclosures) {
      const root = disclosure.credentialId === publicPresentation.invoiceCredentialId
        ? publicPresentation.invoiceRootHash
        : disclosure.credentialId === publicPresentation.policyCredentialId
          ? publicPresentation.policyRootHash
          : null;
      if (!root || !verifyDisclosure(disclosure, root)) return { valid: false, code: "PRIVACY_PROOF_INVALID" };
    }
    if (!validSemantics(claim, invoice, policy)) return { valid: false, code: "PRIVACY_PROOF_INVALID" };
  } catch {
    return { valid: false, code: "PRIVACY_PROOF_INVALID" };
  }
  return { valid: true, code: "PRIVACY_PROOF_VERIFIED", presentationHash };
}
