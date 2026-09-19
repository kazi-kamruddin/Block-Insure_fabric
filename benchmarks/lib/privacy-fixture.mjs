import { createHash } from "node:crypto";
import {
  PRIVACY_PROTOCOL_VERSION,
  privacyLeafHash,
  privacyParentHash,
} from "../../services/oracle-worker/src/privacy.mjs";

function deterministicSalt(credentialId, name) {
  return createHash("sha256").update(`${credentialId}:${name}`, "utf8").digest("hex");
}

function credentialDisclosures(credentialId, values) {
  const fields = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      credentialId,
      credentialVersion: 1,
      name,
      value: String(value),
      salt: deterministicSalt(credentialId, name),
    }));
  const levels = [fields.map(privacyLeafHash)];
  while (levels.at(-1).length > 1) {
    const current = levels.at(-1);
    const next = [];
    for (let index = 0; index < current.length; index += 2) {
      next.push(privacyParentHash(current[index], current[index + 1] ?? current[index]));
    }
    levels.push(next);
  }
  const disclosures = fields.map((field, leafIndex) => {
    const proof = [];
    let index = leafIndex;
    for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
      const level = levels[levelIndex];
      const sibling = (index ^ 1) < level.length ? (index ^ 1) : index;
      proof.push({ hash: level[sibling], position: sibling < index ? "LEFT" : "RIGHT" });
      index = Math.floor(index / 2);
    }
    return { ...field, leafIndex, proof };
  });
  return { rootHash: levels.at(-1)[0], disclosures };
}

export function buildPrivacyFixture() {
  const claim = {
    id: "benchmark-claim",
    version: 1,
    hospitalInvoiceId: "benchmark-invoice",
    hospitalId: "hospital-demo",
    policyId: "benchmark-policy",
    claimantId: "policyholder1",
    amountMinor: 50_000,
    incidentDate: "2026-06-15",
  };
  const invoiceCredentialId = "benchmark-invoice-credential";
  const policyCredentialId = "benchmark-policy-credential";
  const invoice = credentialDisclosures(invoiceCredentialId, {
    admissionDate: "2026-06-10",
    amountMinor: 50_000,
    dischargeDate: "2026-06-20",
    hospitalId: claim.hospitalId,
    invoiceId: claim.hospitalInvoiceId,
    invoiceReferenceHash: "1".repeat(64),
    status: "FINALIZED",
  });
  const policy = credentialDisclosures(policyCredentialId, {
    coverageLimitMinor: 500_000,
    endDate: "2026-12-31",
    policyId: claim.policyId,
    policyholderId: claim.claimantId,
    startDate: "2026-01-01",
    status: "ACTIVE",
  });
  const privatePresentation = {
    protocolVersion: PRIVACY_PROTOCOL_VERSION,
    presentationId: "benchmark-presentation",
    claimId: claim.id,
    claimVersion: claim.version,
    challenge: "benchmark-challenge",
    expiresAt: "2099-01-01T00:00:00Z",
    disclosures: [...invoice.disclosures, ...policy.disclosures],
  };
  const presentationHash = createHash("sha256")
    .update(JSON.stringify(privatePresentation), "utf8")
    .digest("hex");
  const publicPresentation = {
    id: privatePresentation.presentationId,
    protocolVersion: PRIVACY_PROTOCOL_VERSION,
    claimId: claim.id,
    claimVersion: claim.version,
    invoiceCredentialId,
    policyCredentialId,
    invoiceRootHash: invoice.rootHash,
    policyRootHash: policy.rootHash,
    presentationHash,
    expiresAt: privatePresentation.expiresAt,
  };
  const requestBinding = {
    claimId: claim.id,
    claimVersion: claim.version,
    privacyPresentationId: publicPresentation.id,
    privacyPresentationHash: presentationHash,
    privacyProtocolVersion: PRIVACY_PROTOCOL_VERSION,
  };
  return { claim, publicPresentation, privatePresentation, requestBinding };
}
