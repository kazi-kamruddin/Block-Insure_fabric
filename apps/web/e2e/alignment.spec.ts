import { createHash } from "node:crypto";
import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { decryptEvidenceBytes, encryptEvidenceBytes } from "../lib/evidence/browser-crypto";
import evaluator from "../lib/oracle/evaluator.json";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const today = new Date().toISOString().slice(0, 10);
const end = new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10);
async function actor(baseURL: string, id: string) {
  const ctx = await request.newContext({ baseURL });
  const response = await ctx.post("/api/auth/demo-login", { data: { accountId: id } });
  expect(response.ok(), await response.text()).toBe(true);
  return ctx;
}
async function send(ctx: APIRequestContext, data: Record<string, unknown>) {
  const response = await ctx.post("/api/workflows", { data });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).result;
}
async function asset(ctx: APIRequestContext, type: string, id: string) {
  const response = await ctx.get(`/api/ledger/${type}/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).result;
}

test("@alignment frozen routing, owner-offline decryption, review governance and bank finality", async ({ baseURL }, testInfo) => {
  test.skip(Boolean(process.env.ALIGNMENT_FAULT_SCENARIO), "fault scenarios use the bounded availability journey");
  test.setTimeout(600_000);
  if (!baseURL) throw new Error("baseURL required");
  const insurer = await actor(baseURL, "insurer-admin");
  let holder = await actor(baseURL, "policyholder-1");
  const bank = await actor(baseURL, "bank-officer");
  const hospital = await actor(baseURL, "hospital-officer");
  const auditors = await Promise.all(["auditor", "auditor-2", "auditor-3", "auditor-4"].map((id) => actor(baseURL, id)));
  const journal: unknown[] = [];
  try {
    // Seed invoices are retained in this NEW channel. Supply explicit facts for
    // all of them instead of treating missing source history as empty history.
    for (let n = 1; n <= 5; n++) {
      const staff = await actor(baseURL, n === 1 ? "hospital-officer" : `hospital-officer-${n}`);
      try {
        const subject = n === 1 ? "hospital-demo" : `hospital-${n}`;
        const invoiceId = `showcase-invoice-${subject}`;
        const response = await send(staff, { operation: "recordHospitalModelFacts", invoiceId, treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: today,
          expectedMinMinor: 1, expectedMaxMinor: 300000, licenseStatus: "ACTIVE" });
        journal.push({ seedFacts: response });
      } finally { await staff.dispose(); }
    }
    for (const negative of [false, true]) {
      const suffix = `${Date.now()}-${negative ? "review" : "auto"}`;
      const policyId = `align-policy-${suffix}`, invoiceId = `align-invoice-${suffix}`, claimId = `align-claim-${suffix}`, evidenceId = `align-evidence-${suffix}`;
      await send(insurer, { operation: "issuePolicy", id: policyId, packageId: "showcase-health-v1", policyholderId: "policyholder1", startDate: today, endDate: end });
      await send(hospital, { operation: "createHospitalInvoice", id: invoiceId, patientReferenceHash: sha("policyholder1"), invoiceReferenceHash: sha(invoiceId), treatmentHash: sha("synthetic surgery"), amountMinor: 50000, admissionDate: today, dischargeDate: today, status: "FINALIZED" });
      await send(hospital, { operation: "recordHospitalModelFacts", invoiceId, treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: today, expectedMinMinor: 25000, expectedMaxMinor: 75000, licenseStatus: "ACTIVE" });
      await send(holder, { operation: "submitClaim", id: claimId, policyId, hospitalId: "hospital-demo", hospitalInvoiceId: invoiceId, amountMinor: negative ? 60000 : 25000, incidentDate: today, descriptionHash: sha("synthetic claim") });
      const plaintext = new TextEncoder().encode(`original synthetic invoice ${suffix}`);
      const passphrase = "synthetic owner shared secret";
      const encrypted = await encryptEvidenceBytes(plaintext, passphrase, { claimId, evidenceId });
      const upload = await holder.post("/api/evidence", { multipart: { claimId, evidenceId, documentType: "INVOICE", contentHash: encrypted.contentHash,
        ciphertext: { name: "invoice.enc", mimeType: "application/octet-stream", buffer: Buffer.from(encrypted.envelope) } } });
      expect(upload.status(), await upload.text()).toBe(200);
      const verification = await send(insurer, { operation: "startClaimProcessing", claimId });
      expect(verification.modelVersion).toBe(evaluator.evaluatorVersion);
      expect(verification.modelHash).toBe(evaluator.evaluatorHash);
      expect(verification.assignedOracleIds).toHaveLength(3);
      expect(verification.requiredConfirmations).toBe(2);
      await expect.poll(async () => (await asset(holder, "claim", claimId)).status, { timeout: 180_000, intervals: [2000] }).toBe(negative ? "ORACLE_FAILED" : "APPROVED");
      const result = await asset(insurer, "oracle-request", verification.id);
      journal.push({ claimId, request: result });
      expect(result.revealCount).toBeGreaterThanOrEqual(2);
      if (negative) {
        const reviewId = `align-review-${suffix}`;
        const reviewDeadline = new Date(Date.now() + 600000).toISOString();
        const review = { operation: "routeOracleFailureToReview", requestId: verification.id, reviewId, assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: 3, rejectionThreshold: 2, deadline: reviewDeadline };
        const notReady = await insurer.post("/api/workflows", { data: review });
        expect(notReady.status()).toBe(409);
        for (let i = 0; i < 4; i++) await send(holder, { operation: "grantEvidenceAccess", id: `align-grant-${suffix}-${i}`, evidenceId, granteeMsp: "AuditorMSP", granteeRole: "auditor", granteeSubject: `auditor${i + 1}`, purpose: "AUDIT", expiresAt: new Date(Date.now() + 900000).toISOString(), maxAccesses: 10 });
        await send(insurer, review);
        // Close the owner's client before reviewer decryption; its session or
        // active browser is not used to retrieve or decrypt the original file.
        await holder.dispose();
        const download = await auditors[0].post(`/api/evidence/${evidenceId}`);
        expect(download.ok(), await download.text()).toBe(true);
        expect(await decryptEvidenceBytes(new Uint8Array(await download.body()), passphrase, { claimId, evidenceId })).toEqual(plaintext);
        for (let i = 0; i < 2; i++) await send(auditors[i], { operation: "recordAuditorDecision", reviewId, decisionId: `align-vote-${suffix}-${i}`, outcome: "REJECT", reasonHash: sha("invoice exceeds source") });
        holder = await actor(baseURL, "policyholder-1");
        expect((await asset(holder, "claim", claimId)).status).toBe("REJECTED");
      } else {
        const sourceAccountId = `align-bank-source-${suffix}`, destinationAccountId = `align-bank-holder-${suffix}`, settlementId = `align-settlement-${suffix}`;
        for (const [id, ownerId, accountType] of [[sourceAccountId, "insurer", "INSURER"], [destinationAccountId, "policyholder1", "CUSTOMER"]]) await send(bank, { operation: "openBankAccount", id, bankId: "bank-demo", ownerId, accountType, accountLabel: "Synthetic alignment", maskedAccount: "**** 1234", accountTokenHash: sha(id), openingBalanceMinor: 0 });
        await send(insurer, { operation: "authorizeSettlement", settlementId, claimId, sourceAccountId, destinationAccountId });
        await send(bank, { operation: "confirmSettlement", settlementId, transferId: `align-bounce-${suffix}`, bankReferenceHash: sha(`bounce-${suffix}`) });
        expect((await asset(bank, "settlement", settlementId)).status).toBe("PAYMENT_FAILED");
        await send(bank, { operation: "adjustBankAccountBalance", transferId: `align-fund-${suffix}`, accountId: sourceAccountId, direction: "CREDIT", amountMinor: 100000, externalReferenceHash: sha(`fund-${suffix}`) });
        const confirm = { operation: "confirmSettlement", settlementId, transferId: `align-pay-${suffix}`, bankReferenceHash: sha(`pay-${suffix}`) };
        await send(bank, confirm);
        expect((await asset(bank, "account", destinationAccountId)).balanceMinor).toBe(25000);
        expect((await bank.post("/api/workflows", { data: confirm })).status()).toBe(409);
      }
    }
  } finally {
    await testInfo.attach("alignment-journal", { body: JSON.stringify(journal, null, 2), contentType: "application/json" });
    await Promise.all([insurer, holder, bank, hospital, ...auditors].map((ctx) => ctx.dispose()));
  }
});

test("@alignment-fault selected missing-worker and timeout journeys preserve the XGBoost quorum", async ({ baseURL }, testInfo) => {
  const scenario = process.env.ALIGNMENT_FAULT_SCENARIO;
  test.skip(!["one-unavailable", "timeout"].includes(scenario ?? ""), "requires an explicitly selected local worker fault");
  test.setTimeout(300_000);
  if (!baseURL) throw new Error("baseURL required");
  const insurer = await actor(baseURL, "insurer-admin"), holder = await actor(baseURL, "policyholder-1"), hospital = await actor(baseURL, "hospital-officer");
  try {
    const suffix = `${Date.now()}-${scenario}`;
    const policyId = `fault-policy-${suffix}`, invoiceId = `fault-invoice-${suffix}`, claimId = `fault-claim-${suffix}`, evidenceId = `fault-evidence-${suffix}`;
    await send(insurer, { operation: "issuePolicy", id: policyId, packageId: "showcase-health-v1", policyholderId: "policyholder1", startDate: today, endDate: end });
    await send(hospital, { operation: "createHospitalInvoice", id: invoiceId, patientReferenceHash: sha("policyholder1"), invoiceReferenceHash: sha(invoiceId), treatmentHash: sha("synthetic surgery"), amountMinor: 50000, admissionDate: today, dischargeDate: today, status: "FINALIZED" });
    await send(hospital, { operation: "recordHospitalModelFacts", invoiceId, treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: today, expectedMinMinor: 25000, expectedMaxMinor: 75000, licenseStatus: "ACTIVE" });
    await send(holder, { operation: "submitClaim", id: claimId, policyId, hospitalId: "hospital-demo", hospitalInvoiceId: invoiceId, amountMinor: 25000, incidentDate: today, descriptionHash: sha("synthetic claim") });
    const encrypted = await encryptEvidenceBytes(new TextEncoder().encode(`fault synthetic invoice ${suffix}`), "synthetic fault evidence secret", { claimId, evidenceId });
    const upload = await holder.post("/api/evidence", { multipart: { claimId, evidenceId, documentType: "INVOICE", contentHash: encrypted.contentHash, ciphertext: { name: "invoice.enc", mimeType: "application/octet-stream", buffer: Buffer.from(encrypted.envelope) } } });
    expect(upload.status(), await upload.text()).toBe(200);
    const current = await send(insurer, { operation: "startClaimProcessing", claimId });
    if (scenario === "one-unavailable") {
      await expect.poll(async () => (await asset(holder, "claim", claimId)).status, { timeout: 130000, intervals: [2000] }).toBe("APPROVED");
      const result = await asset(insurer, "oracle-request", current.id);
      expect(result.revealCount).toBe(2);
      expect(result.verifiedResult).toBe(true);
      await testInfo.attach("fault-outcome", { body: JSON.stringify(result), contentType: "application/json" });
    } else {
      // The automatic request has a three-minute deadline, so retain its identity
      // and wait for its real expiry rather than create replacement work.
      await expect.poll(async () => (await asset(insurer, "oracle-request", current.id)).commitmentCount, { timeout: 20000 }).toBe(1);
      expect((await asset(holder, "claim", claimId)).status).toBe("ORACLE_PENDING");
      const early = await insurer.post("/api/workflows", { data: { operation: "finalizeOracleTimeout", requestId: current.id } });
      expect(early.status()).toBe(409);
      await expect.poll(() => Date.now() > Date.parse(current.revealDeadline) + 1000, { timeout: 190000, intervals: [2000] }).toBe(true);
      await send(insurer, { operation: "finalizeOracleTimeout", requestId: current.id });
      expect((await asset(holder, "claim", claimId)).status).toBe("ORACLE_FAILED");
      const finalRequest = await asset(insurer, "oracle-request", current.id);
      expect(finalRequest.status).toBe("FAILED");
      expect(finalRequest.revealCount).toBe(1);
      await testInfo.attach("timeout-outcome", { body: JSON.stringify(finalRequest), contentType: "application/json" });
    }
  } finally { await Promise.all([insurer, holder, hospital].map((ctx) => ctx.dispose())); }
});

test("@alignment-boundaries hospital isolation and unassigned evidence denial", async ({ baseURL }) => {
  if (!baseURL) throw new Error("baseURL required");
  const hospital = await actor(baseURL, "hospital-officer-2"), auditor = await actor(baseURL, "auditor"), insurer = await actor(baseURL, "insurer-admin");
  try {
    expect((await hospital.get("/api/ledger/hospital-invoice/showcase-invoice-hospital-demo")).status()).toBe(403);
    const response = await insurer.get("/api/ledger/evidence");
    expect(response.ok(), await response.text()).toBe(true);
    const evidence = (await response.json()).result.find((row: { id: string }) => /^align-evidence-.*-auto$/.test(row.id));
    expect(evidence, "requires the completed automatic-routing fixture").toBeTruthy();
    expect((await auditor.post(`/api/evidence/${evidence.id}`)).status()).toBe(403);
    expect((await hospital.post(`/api/evidence/${evidence.id}`)).status()).toBe(403);
    const denied = await hospital.post("/api/workflows", { data: { operation: "recordHospitalModelFacts", invoiceId: "showcase-invoice-hospital-demo", treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: today, expectedMinMinor: 1, expectedMaxMinor: 300000, licenseStatus: "ACTIVE" } });
    expect(denied.status(), await denied.text()).toBe(409);
  } finally { await Promise.all([hospital, auditor, insurer].map(ctx => ctx.dispose())); }
});

test("@alignment-mobile essential role forms and navigation at 320px", async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 320, height: 780 });
  for (const [accountId, workspace, heading] of [
    ["insurer-admin", "insurer", "Portfolio oversight"],
    ["policyholder-1", "policyholder", "Coverage and claims overview"],
    ["hospital-officer", "hospital", "Independent Hospital billing register"],
    ["auditor", "auditor", "Independent claim audit"],
    ["bank-officer", "bank", "Banking operations desk"],
  ]) {
    expect((await page.request.post("/api/auth/demo-login", { data: { accountId } })).ok()).toBe(true);
    await page.goto(`/workspace/${workspace}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByLabel("Workflow action")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const foreign = workspace === "insurer" ? "bank" : "insurer";
    await page.goto(`/workspace/${foreign}`);
    await expect(page).toHaveURL(new RegExp(`/workspace/${workspace}$`));
  }
});
