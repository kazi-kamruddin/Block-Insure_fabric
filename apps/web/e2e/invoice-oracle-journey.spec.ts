import { createHash } from "node:crypto";
import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { decryptEvidenceBytes, encryptEvidenceBytes } from "../lib/evidence/browser-crypto";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const coverageEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 366 * 86_400_000).toISOString().slice(0, 10);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const oracleScenario = process.env.ORACLE_E2E_SCENARIO ?? "baseline";
async function actor(baseURL: string, accountId: string) {
  const context = await request.newContext({ baseURL });
  const login = await context.post("/api/auth/demo-login", { data: { accountId } });
  expect(login.ok(), await login.text()).toBe(true);
  return context;
}
async function send(context: APIRequestContext, data: Record<string, unknown>) {
  const response = await context.post("/api/workflows", { data });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).result;
}
async function asset(context: APIRequestContext, type: string, id: string) {
  const response = await context.get(`/api/ledger/${type}/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).result;
}
async function waitFor(context: APIRequestContext, claimId: string, status: string) {
  await expect.poll(async () => (await asset(context, "claim", claimId)).status, { timeout: 100_000, intervals: [750, 1500, 2500] }).toBe(status);
}

test("hospital invoice reaches Oracle consensus and a partial claim settles with auditable encrypted evidence", async ({ baseURL }) => {
  test.skip(oracleScenario !== "baseline", "uses all three baseline workers");
  test.setTimeout(240_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const hospital = await actor(baseURL, "hospital-officer");
  const holder = await actor(baseURL, "policyholder-1");
  const bank = await actor(baseURL, "bank-officer");
  const auditor = await actor(baseURL, "auditor");
  try {
    const policyId = `workflow-policy-${id}`;
    const invoiceId = `workflow-invoice-${id}`;
    const claimId = `workflow-claim-${id}`;
    await send(insurer, { operation: "issuePolicy", id: policyId, packageId: "showcase-health-v1", policyholderId: "policyholder1", startDate: today, endDate: coverageEnd });
    const invoice = await send(hospital, { operation: "createHospitalInvoice", id: invoiceId, patientReferenceHash: sha("policyholder1"), invoiceReferenceHash: sha(invoiceId), treatmentHash: sha("hospital treatment"), amountMinor: 50000, admissionDate: today, dischargeDate: today, status: "FINALIZED" });
    expect(invoice.invoice.privacyCredentialId).toMatch(/^invoice-credential-/);
    expect((await asset(hospital, "hospital-invoice", invoiceId)).status).toBe("FINALIZED");
    await send(holder, { operation: "submitClaim", id: claimId, policyId, hospitalId: "hospital-demo", hospitalInvoiceId: invoiceId, amountMinor: 25000, incidentDate: today, descriptionHash: sha("my own narrative") });
    const policyCredentialId = `workflow-policy-credential-${id}`;
    const presentationId = `workflow-presentation-${id}`;
    const credentialExpiry = new Date(Date.now() + 86_400_000).toISOString();
    await send(insurer, { operation: "issuePolicyPrivacyCredential", id: policyCredentialId, policyId, expiresAt: credentialExpiry });
    await send(holder, { operation: "registerClaimPrivacyPresentation", id: presentationId, claimId, invoiceCredentialId: invoice.invoice.privacyCredentialId, policyCredentialId, challenge: `workflow-challenge-${id}`, expiresAt: credentialExpiry });
    expect((await asset(holder, "privacy-presentation", presentationId)).status).toBe("VERIFIED");
    const evidenceId = `workflow-evidence-${id}`;
    const binding = { claimId, evidenceId };
    const passphrase = "local audit evidence passphrase";
    const plaintext = new TextEncoder().encode(`private evidence ${id}`);
    const encrypted = await encryptEvidenceBytes(plaintext, passphrase, binding);
    const upload = await holder.post("/api/evidence", { multipart: {
      ...binding, documentType: "DISCHARGE_SUMMARY", contentHash: encrypted.contentHash,
      ciphertext: { name: `${evidenceId}.enc`, mimeType: "application/octet-stream", buffer: Buffer.from(encrypted.envelope) },
    } });
    expect(upload.ok(), await upload.text()).toBe(true);
    expect((await bank.post(`/api/evidence/${evidenceId}`)).status()).toBe(403);
    expect((await hospital.post(`/api/evidence/${evidenceId}`)).status()).toBe(403);
    const download = await holder.post(`/api/evidence/${evidenceId}`);
    expect(download.ok(), await download.text()).toBe(true);
    expect(await decryptEvidenceBytes(new Uint8Array(await download.body()), passphrase, binding)).toEqual(plaintext);
    await expect(decryptEvidenceBytes(new Uint8Array(await download.body()), passphrase, { ...binding, claimId: `${claimId}-wrong` })).rejects.toThrow();
    const grantId = `workflow-grant-${id}`;
    await send(holder, { operation: "grantEvidenceAccess", id: grantId, evidenceId, granteeMsp: "AuditorMSP", granteeRole: "auditor", granteeSubject: "auditor1", purpose: "AUDIT", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), maxAccesses: 1 });
    const shared = await auditor.post(`/api/evidence/${evidenceId}`, { data: { grantId } });
    expect(shared.ok(), await shared.text()).toBe(true);
    expect((await auditor.post(`/api/evidence/${evidenceId}`, { data: { grantId } })).status()).toBe(403);
    await send(holder, { operation: "revokeEvidenceAccess", grantId });
    const batchId = `workflow-batch-${id}`;
    await send(insurer, { operation: "publishEvidenceMerkleBatch", id: batchId, evidenceIdsJson: JSON.stringify([evidenceId]) });
    const proof = await holder.get(`/api/evidence/${evidenceId}/proof?batchId=${batchId}`);
    expect(proof.ok(), await proof.text()).toBe(true);
    expect((await proof.json()).verification.included).toBe(true);
    const requestRecord = await send(insurer, { operation: "startClaimProcessing", claimId });
    expect(requestRecord.hospitalVerificationId).toMatch(/^oracle-invoice-/);
    expect(requestRecord.privacyPresentationId).toBe(presentationId);
    expect((await asset(insurer, "verification", requestRecord.hospitalVerificationId)).outcome).toBe("SOURCE_BOUND");
    await waitFor(holder, claimId, "APPROVED");
    expect((await asset(insurer, "oracle-request", requestRecord.id)).verifiedResult).toBe(true);
    const sourceAccountId = `workflow-source-${id}`;
    const destinationAccountId = `workflow-destination-${id}`;
    for (const [accountId, ownerId, accountType, balance] of [
      [sourceAccountId, "insurer", "INSURER", 0],
      [destinationAccountId, "policyholder1", "CUSTOMER", 0],
    ] as const) {
      await send(bank, { operation: "openBankAccount", id: accountId, bankId: "bank-demo", ownerId, accountType, accountLabel: "Audit payout account", maskedAccount: "**** **** 9001", accountTokenHash: sha(accountId), openingBalanceMinor: balance });
    }
    const settlementId = `workflow-settlement-${id}`;
    await send(insurer, { operation: "authorizeSettlement", settlementId, claimId, sourceAccountId, destinationAccountId });
    await send(bank, { operation: "confirmSettlement", settlementId, transferId: `payout-bounce-${id}`, bankReferenceHash: sha(`bounce-${settlementId}`) });
    expect(await asset(bank, "settlement", settlementId)).toMatchObject({ status: "PAYMENT_FAILED", failureCode: "INSUFFICIENT_FUNDS" });
    expect((await asset(holder, "account", destinationAccountId)).balanceMinor).toBe(0);
    await send(bank, { operation: "adjustBankAccountBalance", transferId: `fund-${id}`, accountId: sourceAccountId, direction: "CREDIT", amountMinor: 100000, externalReferenceHash: sha(`fund-${id}`) });
    const confirmation = { operation: "confirmSettlement", settlementId, transferId: `payout-${id}`, bankReferenceHash: sha(settlementId) };
    await send(bank, confirmation);
    expect((await bank.post("/api/workflows", { data: confirmation })).status()).toBe(409);
    await waitFor(holder, claimId, "SETTLED");
    expect((await asset(bank, "account", sourceAccountId)).balanceMinor).toBe(75000);
    expect((await asset(holder, "account", destinationAccountId)).balanceMinor).toBe(25000);
    const dossierResponse = await insurer.get(`/api/audit/claims/${claimId}`);
    expect(dossierResponse.ok(), await dossierResponse.text()).toBe(true);
    const dossier = await dossierResponse.json();
    expect(dossier).toMatchObject({ schemaVersion: 6, claim: { status: "SETTLED" }, settlement: { status: "CONFIRMED" } });
    expect(dossier.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ id: evidenceId })]));
    expect(dossier.evidenceGrants).toEqual(expect.arrayContaining([expect.objectContaining({ id: grantId, status: "REVOKED", accessCount: 1 })]));
    expect((await bank.get(`/api/audit/claims/${claimId}`)).status()).toBe(403);
    expect((await insurer.post("/api/internal/events/sync")).ok()).toBe(true);
    const notices = await insurer.get("/api/operations/notifications");
    expect(notices.ok(), await notices.text()).toBe(true);
    expect((await notices.json()).notifications).toEqual(expect.arrayContaining([expect.objectContaining({ assetId: claimId, title: "Claim payout confirmed by the Bank" })]));
    const communications = await bank.get("/api/operations/banking/communications");
    expect(communications.ok(), await communications.text()).toBe(true);
    expect((await communications.json()).communications).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: confirmation.transferId, policyId, status: "DEMO" }),
      expect.objectContaining({ assetId: `payout-bounce-${id}`, policyId, variables: expect.objectContaining({ status: "BOUNCED" }) }),
    ]));
  } finally {
    await Promise.all([insurer.dispose(), hospital.dispose(), holder.dispose(), bank.dispose(), auditor.dispose()]);
  }
});

test("an over-invoice claim receives Oracle failure, auditor rejection, and a corrected appeal", async ({ baseURL }) => {
  test.skip(oracleScenario !== "baseline", "uses all three baseline workers");
  test.setTimeout(240_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const hospital = await actor(baseURL, "hospital-officer");
  const holder = await actor(baseURL, "policyholder-1");
  const auditor1 = await actor(baseURL, "auditor");
  const auditor2 = await actor(baseURL, "auditor-2");
  try {
    const policyId = `workflow-policy-${id}`;
    const invoiceId = `workflow-invoice-${id}`;
    const claimId = `workflow-claim-${id}`;
    const reference = sha(invoiceId);
    await send(insurer, { operation: "issuePolicy", id: policyId, packageId: "showcase-health-v1", policyholderId: "policyholder1", startDate: today, endDate: coverageEnd });
    await send(hospital, { operation: "createHospitalInvoice", id: invoiceId, patientReferenceHash: sha("policyholder1"), invoiceReferenceHash: reference, treatmentHash: sha("hospital treatment"), amountMinor: 50000, admissionDate: today, dischargeDate: today, status: "FINALIZED" });
    await send(holder, { operation: "submitClaim", id: claimId, policyId, hospitalId: "hospital-demo", hospitalInvoiceId: invoiceId, amountMinor: 60000, incidentDate: today, descriptionHash: sha("a customer explanation") });
    const first = await send(insurer, { operation: "startClaimProcessing", claimId });
    await waitFor(holder, claimId, "ORACLE_FAILED");
    const reviewId = `workflow-review-${id}`;
    await send(insurer, { operation: "routeOracleFailureToReview", requestId: first.id, reviewId, assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: 3, rejectionThreshold: 2, deadline: new Date(Date.now() + 86_400_000).toISOString() });
    await send(auditor1, { operation: "recordAuditorDecision", reviewId, decisionId: `workflow-vote1-${id}`, outcome: "REJECT", reasonHash: sha("amount exceeds invoice") });
    await send(auditor2, { operation: "recordAuditorDecision", reviewId, decisionId: `workflow-vote2-${id}`, outcome: "REJECT", reasonHash: sha("amount exceeds invoice") });
    await waitFor(holder, claimId, "REJECTED");
    const appealId = `workflow-appeal-${id}`;
    await send(holder, { operation: "submitClaimAppeal", appealId, claimId, reasonCategory: "AMOUNT_CORRECTION", reasonHash: sha("corrected amount"), descriptionHash: sha("my correction"), proposedAmountMinor: 25000, proposedClinicalReferenceHash: reference });
    const second = await send(insurer, { operation: "startClaimProcessing", claimId });
    expect(second.claimVersion).toBe(2);
    expect(second.hospitalVerificationId).not.toBe(first.hospitalVerificationId);
    await waitFor(holder, claimId, "APPROVED");
    expect((await asset(holder, "appeal", appealId)).status).toBe("OVERTURNED");
  } finally {
    await Promise.all([insurer.dispose(), hospital.dispose(), holder.dispose(), auditor1.dispose(), auditor2.dispose()]);
  }
});

for (const scenario of ["one-unavailable", "timeout"] as const) {
  test(`@invoice-oracle-availability ${scenario}: invoice quorum and timeout enforce the assigned threshold`, async ({ baseURL }) => {
    test.skip(oracleScenario !== scenario, `requires the ${scenario} worker profile`);
    test.setTimeout(120_000);
    if (!baseURL) throw new Error("Playwright baseURL is required");
    const id = `availability-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const insurer = await actor(baseURL, "insurer-admin");
    const hospital = await actor(baseURL, "hospital-officer");
    const holder = await actor(baseURL, "policyholder-1");
    try {
      const policyId = `policy-${id}`;
      const invoiceId = `invoice-${id}`;
      const claimId = `claim-${id}`;
      const requestId = `request-${id}`;
      await send(insurer, { operation: "issuePolicy", id: policyId, packageId: "showcase-health-v1", policyholderId: "policyholder1", startDate: today, endDate: coverageEnd });
      await send(hospital, { operation: "createHospitalInvoice", id: invoiceId, patientReferenceHash: sha("policyholder1"), invoiceReferenceHash: sha(invoiceId), treatmentHash: sha(id), amountMinor: 50000, admissionDate: today, dischargeDate: today, status: "FINALIZED" });
      await send(holder, { operation: "submitClaim", id: claimId, policyId, hospitalId: "hospital-demo", hospitalInvoiceId: invoiceId, amountMinor: 25000, incidentDate: today, descriptionHash: sha("availability audit") });
      const revealDeadline = new Date(Date.now() + 40_000).toISOString();
      await send(insurer, { operation: "requestOracleVerification", requestId, claimId, snapshotId: "registry-demo-v1", modelVersion: "model-v1", modelHash: "c".repeat(64), assignedOracleIdsJson: '["oracle1","oracle2","oracle3"]', requiredConfirmations: 2, commitDeadline: new Date(Date.now() + 20_000).toISOString(), revealDeadline });
      if (scenario === "one-unavailable") {
        await waitFor(holder, claimId, "APPROVED");
        expect(await asset(insurer, "oracle-request", requestId)).toMatchObject({ status: "CONSENSUS", commitmentCount: 2, revealCount: 2, requiredConfirmations: 2, verifiedResult: true });
      } else {
        await expect.poll(async () => (await asset(insurer, "oracle-request", requestId)).revealCount, { timeout: 35_000, intervals: [1000] }).toBe(1);
        expect((await asset(holder, "claim", claimId)).status).toBe("ORACLE_PENDING");
        const premature = await insurer.post("/api/workflows", { data: { operation: "finalizeOracleTimeout", requestId } });
        expect(premature.status()).toBe(409);
        await expect.poll(() => Date.now(), { timeout: 45_000, intervals: [1000] }).toBeGreaterThan(Date.parse(revealDeadline));
        await send(insurer, { operation: "finalizeOracleTimeout", requestId });
        await waitFor(holder, claimId, "ORACLE_FAILED");
        expect(await asset(insurer, "oracle-request", requestId)).toMatchObject({ status: "FAILED", finalizationCode: "TIMEOUT", commitmentCount: 1, revealCount: 1 });
      }
    } finally {
      await Promise.all([insurer.dispose(), hospital.dispose(), holder.dispose()]);
    }
  });
}
