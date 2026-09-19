import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { createHash } from "node:crypto";
import { decryptEvidenceBytes, encryptEvidenceBytes } from "../lib/evidence/browser-crypto";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const registryRoot = "c6da6361115c611b091faa9f35836f9f5c8ee0fdbefb6bc0d8cc6fdde571ebcd";

async function actor(baseURL: string, accountId: string) {
  const context = await request.newContext({ baseURL });
  const login = await context.post("/api/auth/demo-login", { data: { accountId } });
  expect(login.ok(), await login.text()).toBe(true);
  return context;
}

async function command(context: APIRequestContext, payload: Record<string, unknown>) {
  const response = await context.post("/api/workflows", { data: payload });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test("five organization sessions complete a Fabric insurance workflow", async ({ baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const ids = {
    package: `e2e-package-${suffix}`,
    invoice: `e2e-invoice-${suffix}`,
    policy: `e2e-policy-${suffix}`,
    claim: `e2e-claim-${suffix}`,
    evidence: `e2e-evidence-${suffix}`,
    grant: `e2e-grant-${suffix}`,
    verification: `e2e-verification-${suffix}`,
    decision: `e2e-decision-${suffix}`,
    review: `e2e-review-${suffix}`,
    fraud: `e2e-fraud-${suffix}`,
    settlement: `e2e-settlement-${suffix}`,
    insurerAccount: `e2e-insurer-account-${suffix}`,
  };

  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  const auditor = await actor(baseURL, "auditor");
  const auditor2 = await actor(baseURL, "auditor-2");
  const auditor3 = await actor(baseURL, "auditor-3");
  const bank = await actor(baseURL, "bank-officer");

  try {
    await command(bank, {
      operation: "openBankAccount", id: ids.insurerAccount, bankId: "bank-demo",
      ownerId: "insurer", accountType: "INSURER", accountLabel: "E2E settlement reserve",
      maskedAccount: "**** **** 9001",
      accountTokenHash: createHash("sha256").update(`e2e-insurer-vault-${suffix}`).digest("hex"),
      openingBalanceMinor: 500_000,
    });
    await command(insurer, {
      operation: "createPolicyPackage", id: ids.package, name: "Browser Regression Plan",
      description: "Playwright multi-organization workflow", premiumMinor: 10_000,
      coverageLimitMinor: 1_000_000, termsHash: hashA,
    });
    await command(insurer, { operation: "configurePolicyPackagePartners", id: ids.package, hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
    await command(insurer, { operation: "publishPolicyPackage", id: ids.package });
    await command(insurer, {
      operation: "issuePolicy", id: ids.policy, packageId: ids.package,
      policyholderId: "policyholder1", startDate: "2026-01-01", endDate: "2026-12-31",
    });
    await command(insurer, { operation: "retirePolicyPackage", id: ids.package });
    await command(hospital, { operation: "createHospitalInvoice", id: ids.invoice, patientReferenceHash: hashA, invoiceReferenceHash: hashC, treatmentHash: hashB, amountMinor: 250_000, admissionDate: "2026-06-10", dischargeDate: "2026-06-20", status: "FINALIZED" });
    await command(policyholder, {
      operation: "submitClaim", id: ids.claim, policyId: ids.policy, hospitalId: "hospital-demo", hospitalInvoiceId: ids.invoice, amountMinor: 250_000,
      incidentDate: "2026-06-15", descriptionHash: hashB,
    });
    const evidencePlaintext = new TextEncoder().encode(`private-e2e-evidence-${suffix}`);
    const evidencePassphrase = "browser regression evidence passphrase";
    const encryptedEvidence = await encryptEvidenceBytes(evidencePlaintext, evidencePassphrase, {
      claimId: ids.claim,
      evidenceId: ids.evidence,
    });
    const evidenceUpload = await policyholder.post("/api/evidence", {
      multipart: {
        claimId: ids.claim,
        evidenceId: ids.evidence,
        documentType: "DISCHARGE_SUMMARY",
        contentHash: encryptedEvidence.contentHash,
        ciphertext: {
          name: `${ids.evidence}.enc`,
          mimeType: "application/octet-stream",
          buffer: Buffer.from(encryptedEvidence.envelope),
        },
      },
    });
    expect(evidenceUpload.ok(), await evidenceUpload.text()).toBe(true);
    await command(policyholder, {
      operation: "grantEvidenceAccess", id: ids.grant, evidenceId: ids.evidence,
      granteeMsp: "AuditorMSP", granteeRole: "auditor", granteeSubject: "auditor1",
      purpose: "AUDIT", expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), maxAccesses: 2,
    });

    const bankEvidence = await bank.post(`/api/evidence/${ids.evidence}`);
    expect(bankEvidence.status()).toBe(403);
    const ownerEvidence = await policyholder.post(`/api/evidence/${ids.evidence}`);
    expect(ownerEvidence.ok(), await ownerEvidence.text()).toBe(true);
    expect(ownerEvidence.headers()["x-ciphertext-sha256"]).toMatch(/^[a-f0-9]{64}$/);
    expect(ownerEvidence.headers()["x-content-sha256"]).toBe(encryptedEvidence.contentHash);
    expect(ownerEvidence.headers()["x-evidence-claim-id"]).toBe(ids.claim);
    const downloadedPlaintext = await decryptEvidenceBytes(
      new Uint8Array(await ownerEvidence.body()),
      evidencePassphrase,
      { claimId: ids.claim, evidenceId: ids.evidence },
    );
    expect(new TextDecoder().decode(downloadedPlaintext)).toBe(`private-e2e-evidence-${suffix}`);

    const sharedEvidence = await auditor.post(`/api/evidence/${ids.evidence}`, { data: { grantId: ids.grant } });
    expect(sharedEvidence.ok(), await sharedEvidence.text()).toBe(true);
    expect(sharedEvidence.headers()["x-content-sha256"]).toBe(encryptedEvidence.contentHash);
    await command(policyholder, { operation: "revokeEvidenceAccess", grantId: ids.grant });
    const revokedGrant = await policyholder.get(`/api/ledger/evidence-grant/${ids.grant}`);
    expect((await revokedGrant.json()).result).toMatchObject({ status: "REVOKED", accessCount: 1 });

    const accessLog = await insurer.get("/api/ledger/access");
    expect(accessLog.ok(), await accessLog.text()).toBe(true);
    expect((await accessLog.json()).result.some((item: { evidenceId: string; accessorRole: string }) =>
      item.evidenceId === ids.evidence && item.accessorRole === "policyholder",
    )).toBe(true);

    const hospitalInvoice = await hospital.get(`/api/ledger/hospital-invoice/${ids.invoice}`);
    expect(hospitalInvoice.ok(), await hospitalInvoice.text()).toBe(true);
    expect((await hospitalInvoice.json()).result).toMatchObject({ hospitalId: "hospital-demo", status: "FINALIZED" });
    const hospitalClaimAccess = await hospital.get(`/api/ledger/claim/${ids.claim}`);
    expect(hospitalClaimAccess.status()).toBe(403);
    await command(insurer, { operation: "crossCheckClaimInvoice", claimId: ids.claim, verificationId: ids.verification });
    const verification = await policyholder.get(`/api/ledger/verification/${ids.verification}`);
    expect(verification.ok(), await verification.text()).toBe(true);
    expect((await verification.json()).result).toMatchObject({ id: ids.verification, claimId: ids.claim, outcome: "VERIFIED" });
    const assessment = await command(insurer, { operation: "assessClaimFraud", assessmentId: ids.fraud, claimId: ids.claim });
    expect(assessment.result).toMatchObject({ id: ids.fraud, claimId: ids.claim, advisory: true });
    await command(insurer, {
      operation: "openClaimReview", claimId: ids.claim, reviewId: ids.review,
      assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]',
      approvalThreshold: 3, rejectionThreshold: 2,
      deadline: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });

    const auditorBefore = await auditor.get("/api/dashboard");
    expect((await auditorBefore.json()).dashboard.queue.some((item: { id: string }) => item.id === ids.review)).toBe(true);
    await command(auditor, {
      operation: "recordAuditorDecision", reviewId: ids.review, decisionId: `${ids.decision}-1`,
      outcome: "APPROVE", reasonHash: hashA,
    });
    const pendingClaim = await policyholder.get(`/api/ledger/claim/${ids.claim}`);
    expect((await pendingClaim.json()).result.status).toBe("UNDER_REVIEW");
    await command(auditor2, { operation: "recordAuditorDecision", reviewId: ids.review, decisionId: `${ids.decision}-2`, outcome: "APPROVE", reasonHash: hashA });
    await command(auditor3, { operation: "recordAuditorDecision", reviewId: ids.review, decisionId: `${ids.decision}-3`, outcome: "APPROVE", reasonHash: hashA });
    const decision = await policyholder.get(`/api/ledger/decision/${ids.decision}-3`);
    expect(decision.ok(), await decision.text()).toBe(true);
    expect((await decision.json()).result).toMatchObject({ id: `${ids.decision}-3`, claimId: ids.claim, reviewId: ids.review, outcome: "APPROVE" });
    await command(insurer, {
      operation: "authorizeSettlement", settlementId: ids.settlement, claimId: ids.claim, sourceAccountId: ids.insurerAccount, destinationAccountId: "showcase-customer-account",
    });

    const bankBefore = await bank.get("/api/dashboard");
    expect((await bankBefore.json()).dashboard.queue.some((item: { id: string }) => item.id === ids.settlement)).toBe(true);
    await command(bank, {
      operation: "confirmSettlement", settlementId: ids.settlement, transferId: `payout-${ids.settlement}`,
      bankReferenceHash: createHash("sha256").update(`claim-settlement-${suffix}`).digest("hex"),
    });

    const claimResponse = await policyholder.get(`/api/ledger/claim/${ids.claim}`);
    expect(claimResponse.ok(), await claimResponse.text()).toBe(true);
    expect((await claimResponse.json()).result).toMatchObject({
      id: ids.claim,
      claimantId: "policyholder1",
      status: "SETTLED",
    });

    const dossierResponse = await insurer.get(`/api/audit/claims/${ids.claim}`);
    expect(dossierResponse.ok(), await dossierResponse.text()).toBe(true);
    expect(dossierResponse.headers()["content-disposition"]).toContain(`${ids.claim}-audit.json`);
    const dossier = await dossierResponse.json();
    expect(dossier).toMatchObject({
      schemaVersion: 6,
      claim: { id: ids.claim, status: "SETTLED" },
      hospitalVerification: { id: ids.verification, outcome: "VERIFIED" },
      settlement: { id: ids.settlement, status: "CONFIRMED" },
    });
    expect(dossier.reviewRounds).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.review, status: "APPROVED", votesCast: 3 })]));
    expect(dossier.auditorDecisions).toHaveLength(3);
    expect(dossier.fraudAssessments).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.fraud, advisory: true })]));
    expect(dossier.history.length).toBeGreaterThanOrEqual(6);
    expect(dossier.evidence.some((item: { id: string }) => item.id === ids.evidence)).toBe(true);
    expect(dossier.evidenceAccess.some((item: { evidenceId: string }) => item.evidenceId === ids.evidence)).toBe(true);
    expect(dossier.evidenceGrants).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.grant, status: "REVOKED", accessCount: 1 })]));

    const eventSync = await insurer.post("/api/internal/events/sync");
    expect(eventSync.ok(), await eventSync.text()).toBe(true);
    const research = await insurer.get("/api/research/snapshot");
    expect(research.ok(), await research.text()).toBe(true);
    expect(await research.json()).toMatchObject({
      schemaVersion: 1,
      provenance: { ledgerSchemaVersion: 12 },
      fraudDecisionSupport: { advisoryOnly: true },
    });
    const auditorNotifications = await auditor.get("/api/operations/notifications");
    expect((await auditorNotifications.json()).notifications.some((item: { assetId: string }) => item.assetId === ids.review)).toBe(true);

    const forbiddenDossier = await bank.get(`/api/audit/claims/${ids.claim}`);
    expect(forbiddenDossier.status()).toBe(403);

    const forbidden = await bank.post("/api/workflows", {
      data: { operation: "openClaimReview", claimId: ids.claim, reviewId: ids.review, assignedAuditorIdsJson: "[]", approvalThreshold: 1, rejectionThreshold: 1, deadline: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(forbidden.status()).toBe(403);
  } finally {
    await Promise.all([
      insurer.dispose(), policyholder.dispose(), hospital.dispose(), auditor.dispose(), auditor2.dispose(), auditor3.dispose(), bank.dispose(),
    ]);
  }
});

test("rejected claim requires a committed correction, matching Hospital invoice, fresh cross-check, and independent Oracle approval", async ({ baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const suffix = `appeal-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const packageId = `e2e-package-${suffix}`;
  const policyId = `e2e-policy-${suffix}`;
  const claimId = `e2e-claim-${suffix}`;
  const invoiceId = `e2e-invoice-${suffix}`;
  const correctedInvoiceId = `e2e-invoice-corrected-${suffix}`;
  const review1 = `e2e-review-initial-${suffix}`;
  const appealId = `e2e-appeal-${suffix}`;
  const deadline = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const assignedAuditorIdsJson = '["auditor1","auditor2","auditor3","auditor4"]';
  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  const foreignHospital = await actor(baseURL, "hospital-officer-2");
  const auditors = await Promise.all(["auditor", "auditor-2", "auditor-3"].map((id) => actor(baseURL, id)));

  try {
    const registry = await insurer.get("/api/ledger/oracle-snapshot/registry-demo-v1");
    if (!registry.ok()) {
      await command(insurer, { operation: "publishOracleRegistrySnapshot", id: "registry-demo-v1", version: 1, rootHash: registryRoot, rulesVersion: "rules-v1", rulesHash: hashA, recordCount: 3 });
    }
    await command(insurer, { operation: "createPolicyPackage", id: packageId, name: "Appeal Plan", description: "Appeal regression", premiumMinor: 10_000, coverageLimitMinor: 1_000_000, termsHash: hashA });
    await command(insurer, { operation: "configurePolicyPackagePartners", id: packageId, hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
    await command(insurer, { operation: "publishPolicyPackage", id: packageId });
    await command(insurer, { operation: "issuePolicy", id: policyId, packageId, policyholderId: "policyholder1", startDate: "2026-01-01", endDate: "2026-12-31" });
    await command(hospital, { operation: "createHospitalInvoice", id: invoiceId, patientReferenceHash: hashA, invoiceReferenceHash: hashC, treatmentHash: hashB, amountMinor: 400_000, admissionDate: "2026-06-10", dischargeDate: "2026-06-20", status: "FINALIZED" });
    await command(policyholder, { operation: "submitClaim", id: claimId, policyId, hospitalId: "hospital-demo", hospitalInvoiceId: invoiceId, amountMinor: 400_000, incidentDate: "2026-06-15", descriptionHash: hashB });
    const foreignRead = await foreignHospital.get(`/api/ledger/claim/${claimId}`);
    expect(foreignRead.status()).toBe(403);
    const foreignInvoice = await foreignHospital.get(`/api/ledger/hospital-invoice/${invoiceId}`);
    expect(foreignInvoice.status()).toBe(403);
    await command(insurer, { operation: "crossCheckClaimInvoice", claimId, verificationId: `verification-${suffix}` });
    await command(insurer, { operation: "openClaimReview", claimId, reviewId: review1, assignedAuditorIdsJson, approvalThreshold: 3, rejectionThreshold: 2, deadline });
    await command(auditors[0], { operation: "recordAuditorDecision", reviewId: review1, decisionId: `decision-r1-a1-${suffix}`, outcome: "REJECT", reasonHash: hashA });
    const duplicate = await auditors[0].post("/api/workflows", { data: { operation: "recordAuditorDecision", reviewId: review1, decisionId: `decision-r1-duplicate-${suffix}`, outcome: "REJECT", reasonHash: hashA } });
    expect(duplicate.status()).toBe(409);
    await command(auditors[1], { operation: "recordAuditorDecision", reviewId: review1, decisionId: `decision-r1-a2-${suffix}`, outcome: "REJECT", reasonHash: hashA });
    await command(hospital, { operation: "createHospitalInvoice", id: correctedInvoiceId, patientReferenceHash: hashA, invoiceReferenceHash: "1".repeat(64), treatmentHash: hashB, amountMinor: 50_000, admissionDate: "2026-06-10", dischargeDate: "2026-06-20", status: "FINALIZED" });
    await command(policyholder, {
      operation: "submitClaimAppeal", appealId, claimId, reasonCategory: "DOCUMENT_ERROR",
      reasonHash: hashB, descriptionHash: hashC, evidenceHash: hashC,
      proposedHospitalId: "", proposedAmountMinor: 50_000, proposedIncidentDate: "2026-06-15",
      proposedDescriptionHash: hashA, proposedClinicalReferenceHash: "1".repeat(64),
    });
    const premature = await insurer.post("/api/workflows", { data: {
      operation: "requestOracleVerification", requestId: `premature-${suffix}`, claimId,
      snapshotId: "registry-demo-v1", modelVersion: "model-v1", modelHash: hashC,
      assignedOracleIdsJson: '["oracle1","oracle2"]',
      commitDeadline: new Date(Date.now() + 60_000).toISOString(), revealDeadline: new Date(Date.now() + 120_000).toISOString(),
    } });
    expect(premature.status()).toBe(409);
    const verification2 = `verification-appeal-${suffix}`;
    await command(insurer, { operation: "crossCheckClaimInvoice", claimId, verificationId: verification2 });
    const requestId = `oracle-request-appeal-${suffix}`;
    await command(insurer, {
      operation: "requestOracleVerification", requestId, claimId, snapshotId: "registry-demo-v1",
      modelVersion: "model-v1", modelHash: hashC, assignedOracleIdsJson: '["oracle1","oracle2"]',
      commitDeadline: new Date(Date.now() + 60_000).toISOString(), revealDeadline: new Date(Date.now() + 120_000).toISOString(),
    });
    await expect.poll(async () => {
      const response = await policyholder.get(`/api/ledger/claim/${claimId}`);
      return response.ok() ? (await response.json()).result.status : `HTTP_${response.status()}`;
    }, { timeout: 90_000, intervals: [500, 1_000, 2_000] }).toBe("APPROVED");

    const claim = await (await policyholder.get(`/api/ledger/claim/${claimId}`)).json();
    const appeal = await (await policyholder.get(`/api/ledger/appeal/${appealId}`)).json();
    const reviews = await (await policyholder.get("/api/ledger/review")).json();
    expect(claim.result).toMatchObject({ status: "APPROVED", appealCount: 1, reviewRound: 1, currentAppealId: appealId, hospitalVerificationId: verification2, oracleOutcome: "EXACT_CONSENSUS" });
    expect(appeal.result).toMatchObject({ status: "OVERTURNED", claimVersion: 2, hospitalVerificationId: verification2, round: 1, proposedDescriptionHash: hashA, proposedClinicalReferenceHash: "1".repeat(64) });
    expect(appeal.result.commitmentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reviews.result.filter((item: { claimId: string }) => item.claimId === claimId)).toEqual([
      expect.objectContaining({ id: review1, status: "REJECTED", round: 1 }),
    ]);
    const oracleRequest = await (await insurer.get(`/api/ledger/oracle-request/${requestId}`)).json();
    expect(oracleRequest.result).toMatchObject({ claimVersion: 2, appealId, appealCommitmentHash: appeal.result.commitmentHash, status: "CONSENSUS" });
    const dossier = await (await insurer.get(`/api/audit/claims/${claimId}`)).json();
    expect(dossier).toMatchObject({ schemaVersion: 6 });
    expect(dossier.hospitalVerifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimVersion: 1, appealId: "" }),
      expect.objectContaining({ claimVersion: 2, appealId, id: verification2 }),
    ]));
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose(), foreignHospital.dispose(), ...auditors.map((item) => item.dispose())]);
  }
});

test("policy, premium, mandate, benefit, and banking lifecycles complete across Fabric", async ({ baseURL }) => {
  test.setTimeout(240_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const digest = (label: string) => createHash("sha256").update(`${label}-${suffix}`).digest("hex");
  const ids = {
    package: `lifecycle-package-${suffix}`, benefitPlan: `lifecycle-plan-${suffix}`,
    policy: `lifecycle-policy-${suffix}`, renewal: `lifecycle-renewal-${suffix}`,
    account: `lifecycle-account-${suffix}`, insurerAccount: `lifecycle-insurer-account-${suffix}`, mandate: `lifecycle-mandate-${suffix}`,
    transfer1: `lifecycle-transfer-1-${suffix}`, transfer2: `lifecycle-transfer-2-${suffix}`, transfer3: `lifecycle-transfer-3-${suffix}`,
    payment1: `lifecycle-payment-1-${suffix}`, payment2: `lifecycle-payment-2-${suffix}`,
    payment3: `lifecycle-payment-3-${suffix}`, adjustment: `lifecycle-adjustment-${suffix}`,
    collection: `lifecycle-collection-${suffix}`, benefit: `lifecycle-benefit-${suffix}`,
  };
  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const bank = await actor(baseURL, "bank-officer");
  try {
    await command(insurer, { operation: "createPolicyPackage", id: ids.package, name: "Lifecycle Plan", description: "Issue 8 browser workflow", premiumMinor: 10_000, coverageLimitMinor: 1_000_000, termsHash: digest("terms") });
    await command(insurer, { operation: "configurePolicyPackagePartners", id: ids.package, hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
    await command(insurer, { operation: "createBenefitPlan", id: ids.benefitPlan, packageId: ids.package, deathBenefitMinor: 500_000, surrenderBenefitMinor: 100_000, maturityBenefitMinor: 250_000, rulesHash: digest("benefit-rules") });
    await command(insurer, { operation: "publishBenefitPlan", id: ids.benefitPlan });
    await command(insurer, { operation: "publishPolicyPackage", id: ids.package });
    await command(bank, { operation: "openBankAccount", id: ids.account, bankId: "bank-demo", ownerId: "policyholder1", accountType: "CUSTOMER", accountLabel: "Lifecycle savings", maskedAccount: "**** **** 4821", accountTokenHash: digest("vault-token"), openingBalanceMinor: 40_000 });
    await command(bank, { operation: "openBankAccount", id: ids.insurerAccount, bankId: "bank-demo", ownerId: "insurer", accountType: "INSURER", accountLabel: "Lifecycle insurer", maskedAccount: "**** **** 9001", accountTokenHash: digest("insurer-vault-token"), openingBalanceMinor: 500_000 });
    await command(policyholder, { operation: "acquirePolicy", id: ids.policy, packageId: ids.package, startDate: "2026-01-01", endDate: "2026-12-31" });
    await command(policyholder, { operation: "setBeneficiaries", policyId: ids.policy, allocationsJson: JSON.stringify([{ beneficiaryId: "beneficiary-primary", shareBps: 7000 }, { beneficiaryId: "beneficiary-secondary", shareBps: 3000 }]) });
    await command(policyholder, { operation: "requestBankMandate", id: ids.mandate, policyId: ids.policy, accountReferenceId: ids.account, expiryDate: "2026-12-31" });
    await command(bank, { operation: "reviewBankMandate", id: ids.mandate, outcome: "APPROVE", decisionHash: digest("mandate-approval") });

    const otpResponse = await policyholder.post("/api/banking/otp", { data: { policyId: ids.policy, sourceAccountId: ids.account } });
    expect(otpResponse.ok(), await otpResponse.text()).toBe(true);
    const otp = await otpResponse.json();
    expect(otp.demoCode).toMatch(/^\d{6}$/);
    const manualPayment = await policyholder.post("/api/banking/premium-payment", { data: {
      challengeId: otp.challengeId, otp: otp.demoCode, transferId: ids.transfer1, paymentId: ids.payment1,
      policyId: ids.policy, sourceAccountId: ids.account, destinationAccountId: ids.insurerAccount, periodStartDate: "2026-01-01",
      periodEndDate: "2026-01-30", amountMinor: 10_000, externalReferenceHash: digest("manual-receipt"),
    } });
    expect(manualPayment.ok(), await manualPayment.text()).toBe(true);
    const otpReplay = await policyholder.post("/api/banking/premium-payment", { data: {
      challengeId: otp.challengeId, otp: otp.demoCode, transferId: `replay-${ids.transfer1}`, paymentId: `replay-${ids.payment1}`,
      policyId: ids.policy, sourceAccountId: ids.account, destinationAccountId: ids.insurerAccount, periodStartDate: "2026-01-31",
      periodEndDate: "2026-03-01", amountMinor: 10_000, externalReferenceHash: digest("manual-replay"),
    } });
    expect(otpReplay.status()).toBe(409);

    await command(insurer, { operation: "queuePremiumCollection", id: ids.collection, mandateId: ids.mandate, dueDate: "2026-01-31" });
    await command(bank, { operation: "processPremiumCollection", collectionId: ids.collection, paymentId: ids.payment2, transferId: ids.transfer2, destinationAccountId: ids.insurerAccount, periodEndDate: "2026-03-01", externalReferenceHash: digest("eft-receipt") });
    await command(bank, { operation: "recordPremiumAdjustment", id: ids.adjustment, paymentId: ids.payment2, amountMinor: 2_000, externalReferenceHash: digest("reversal"), reasonHash: digest("reversal-reason") });

    await command(policyholder, { operation: "submitBenefitRequest", id: ids.benefit, policyId: ids.policy, benefitType: "DEATH", eventDate: "2026-06-15", evidenceHash: digest("benefit-evidence") });
    await command(insurer, { operation: "decideBenefitRequest", id: ids.benefit, outcome: "APPROVE", decisionHash: digest("benefit-decision") });
    await command(insurer, { operation: "markBenefitPaymentReady", id: ids.benefit, fundingReferenceHash: digest("benefit-funding") });
    await command(bank, { operation: "confirmBenefitPayment", id: ids.benefit, bankReferenceHash: digest("benefit-transfer") });

    await command(insurer, { operation: "advancePolicyLifecycle", id: ids.policy, asOfDate: "2026-03-03" });
    await command(insurer, { operation: "advancePolicyLifecycle", id: ids.policy, asOfDate: "2026-03-20" });
    const reinstatementOtpResponse = await policyholder.post("/api/banking/otp", { data: { policyId: ids.policy, sourceAccountId: ids.account } });
    expect(reinstatementOtpResponse.ok(), await reinstatementOtpResponse.text()).toBe(true);
    const reinstatementOtp = await reinstatementOtpResponse.json();
    const reinstatementPayment = await policyholder.post("/api/banking/premium-payment", { data: {
      challengeId: reinstatementOtp.challengeId, otp: reinstatementOtp.demoCode, transferId: ids.transfer3, paymentId: ids.payment3,
      policyId: ids.policy, sourceAccountId: ids.account, destinationAccountId: ids.insurerAccount,
      periodStartDate: "2026-03-02", periodEndDate: "2026-03-31", amountMinor: 10_000, externalReferenceHash: digest("reinstatement-receipt"),
    } });
    expect(reinstatementPayment.ok(), await reinstatementPayment.text()).toBe(true);
    await command(insurer, { operation: "advancePolicyLifecycle", id: ids.policy, asOfDate: "2026-12-31" });
    await command(policyholder, { operation: "renewPolicy", newId: ids.renewal, existingId: ids.policy, newEndDate: "2027-12-31" });
    await command(policyholder, { operation: "cancelPolicy", id: ids.renewal, reasonHash: digest("renewal-cancel") });

    const policyResponse = await policyholder.get(`/api/ledger/policy/${ids.policy}`);
    expect((await policyResponse.json()).result).toMatchObject({ id: ids.policy, status: "EXPIRED", paidThroughDate: "2026-03-31" });
    const renewalResponse = await policyholder.get(`/api/ledger/policy/${ids.renewal}`);
    expect((await renewalResponse.json()).result).toMatchObject({ id: ids.renewal, status: "CANCELLED", renewedFromPolicyId: ids.policy });
    const benefitResponse = await policyholder.get(`/api/ledger/benefit-request/${ids.benefit}`);
    expect((await benefitResponse.json()).result).toMatchObject({ id: ids.benefit, status: "PAID", amountMinor: 500_000 });
    const liabilityResponse = await policyholder.get(`/api/ledger/liability/liability-benefit-${ids.benefit}`);
    expect((await liabilityResponse.json()).result).toMatchObject({ sourceId: ids.benefit, status: "PAID" });
    const statementResponse = await policyholder.get(`/api/policies/${ids.policy}/statement`);
    expect(statementResponse.ok(), await statementResponse.text()).toBe(true);
    expect((await statementResponse.json()).summary).toMatchObject({ grossPremiumMinor: 30_000, adjustedPremiumMinor: 2_000, netPremiumMinor: 28_000 });
    const customerAccount = await (await policyholder.get(`/api/ledger/account/${ids.account}`)).json();
    const insurerAccount = await (await bank.get(`/api/ledger/account/${ids.insurerAccount}`)).json();
    expect(customerAccount.result.balanceMinor).toBe(12_000);
    expect(insurerAccount.result.balanceMinor).toBe(28_000);
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), bank.dispose()]);
  }
});
