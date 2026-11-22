import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { openOperation, openPage, workspaceIdentity } from "./workspace-pages";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const accounts = {
  insurer: ["Insurer Administrator", "insurer"], holder: ["Policyholder One", "policyholder"],
  hospital: ["Dhaka Central Medical Hospital", "hospital"], hospital2: ["Chattogram Metropolitan Hospital", "hospital"],
  bank: ["Bangladesh Demo Commercial Bank", "bank"], auditor1: ["Independent Auditor One", "auditor"],
  auditor2: ["Independent Auditor Two", "auditor"], auditor3: ["Independent Auditor Three", "auditor"],
  auditor4: ["Independent Auditor Four", "auditor"],
} as const;

test("@rehearsal ordinary forms complete premiums, automatic routing, review, appeal, decryption and financial finality", async ({ page }, info) => {
  test.setTimeout(1_500_000);
  if (process.env.FABRIC_CHANNEL_NAME !== "insurance-workflow-alignment-20261108") throw new Error("Exact isolated channel required");
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`, id = (name: string) => `ui-${name}-${suffix}`;
  const journal: unknown[] = [], browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  let current: keyof typeof accounts | null = null;
  let modelYear = "";
  const modelDate = (monthDay: string) => `${modelYear}-${monthDay}`;
  async function login(role: keyof typeof accounts) {
    if (current === role) return;
    if (current) await page.getByRole("button", { name: "Sign out", exact: true }).click();
    else await page.goto("/workspace");
    await page.getByRole("button", { name: `Sign in as ${accounts[role][0]}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/workspace/${accounts[role][1]}$`));
    await expect(workspaceIdentity(page, accounts[role][0])).toBeVisible();
    current = role;
  }
  async function form(operation: string, values: Record<string, string>, expectedStatus = 200) {
    console.log(`UI ${current}: ${operation}`);
    const card = await openOperation(page, operation);
    for (const [name, value] of Object.entries(values)) {
      const field = card.locator(`[name="${name}"]`);
      if (await field.evaluate(element => element.tagName) === "SELECT") await field.selectOption(value);
      else await field.fill(value);
    }
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/workflows") && response.request().method() === "POST", { timeout: 120000 });
    await card.getByRole("button", { name: /^(Submit verified transaction|Submit bank instruction|Save invoice record)$/ }).click();
    const response = await responsePromise, body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(expectedStatus);
    journal.push({ actor: current, operation, input: values, httpStatus: response.status(), outcome: body });
    await expect(card.getByRole("button", { name: /^(Submit verified transaction|Submit bank instruction|Save invoice record)$/ })).toBeEnabled();
    if (expectedStatus !== 200) {
      const failed = page.getByRole("article", { name: "Saved workflow action" });
      if (await failed.count()) await failed.getByRole("button", { name: "Review failed action for a new attempt" }).click();
    }
    return body.result;
  }
  async function asset(type: string, identifier: string) {
    const response = await page.request.get(`/api/ledger/${type}/${encodeURIComponent(identifier)}`);
    expect(response.status(), await response.text()).toBe(200); return (await response.json()).result;
  }
  async function screenshot(name: string) {
    const file = info.outputPath(`${name}.png`); await page.screenshot({ path: file, fullPage: true });
    await info.attach(name, { path: file, contentType: "image/png" });
  }
  const passphrase = "synthetic browser rehearsal evidence key";
  async function upload(claimId: string, evidenceId: string, documentType: string, text: string, expectedStatus = 200) {
    await openPage(page, "documents");
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Encrypt, store, and anchor evidence", exact: true }) });
    await card.getByLabel("Claim ID", { exact: true }).fill(claimId);
    await card.getByLabel("Evidence ID", { exact: true }).fill(evidenceId);
    await card.getByLabel("Document type", { exact: true }).fill(documentType);
    await card.getByLabel("Original file", { exact: true }).setInputFiles({ name: `${evidenceId}.txt`, mimeType: "text/plain", buffer: Buffer.from(text) });
    await card.getByLabel("Evidence passphrase", { exact: true }).fill(passphrase);
    await card.getByLabel("Confirm passphrase", { exact: true }).fill(passphrase);
    await card.getByRole("button", { name: "Encrypt in browser", exact: true }).click();
    await expect(card.getByText("Ciphertext ready", { exact: true })).toBeVisible();
    await expect(card.getByLabel("Original content SHA-256")).toHaveValue(sha(text));
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/evidence") && response.request().method() === "POST", { timeout: 120000 });
    await card.getByRole("button", { name: "Store ciphertext and record reference", exact: true }).click();
    const response = await responsePromise; expect(response.status(), await response.text()).toBe(expectedStatus);
    if (expectedStatus === 409) await expect(card.getByRole("status")).toContainText("APPEAL_DOCUMENT");
    await expect(card.getByRole("button", { name: "Encrypt in browser", exact: true })).toBeEnabled();
    journal.push({ actor: current, point: "UI browser encryption and ciphertext upload", claimId, evidenceId, documentType, httpStatus: response.status(), plaintextSha256: sha(text) });
  }
  async function decrypt(evidenceId: string, text: string) {
    await openPage(page, current === "holder" ? "documents" : "evidence");
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Retrieve and decrypt evidence", exact: true }) });
    await card.getByLabel("Evidence ID", { exact: true }).fill(evidenceId);
    await card.getByLabel("Grant ID (optional)", { exact: true }).fill("");
    await card.getByLabel("Evidence passphrase", { exact: true }).fill(passphrase);
    await card.getByRole("button", { name: "Retrieve and decrypt", exact: true }).click();
    const link = card.getByRole("link", { name: "Download verified plaintext", exact: true });
    await expect(link).toBeVisible({ timeout: 120000 });
    const downloadPromise = page.waitForEvent("download"); await link.click(); const download = await downloadPromise;
    const file = await download.path(); if (!file) throw new Error("Verified plaintext download unavailable");
    expect(await readFile(file, "utf8")).toBe(text);
    journal.push({ actor: current, point: "actual UI decryption and verified plaintext download", evidenceId, plaintextSha256: sha(text), ownerSignedOut: current !== "holder" });
  }
  async function invoice(invoiceId: string, admissionDate: string, dischargeDate: string, invoiceDate: string, amountBdt: string, minimum: string, maximum: string, diagnosisCode = "") {
    await login("hospital");
    await form("createHospitalInvoice", { id: invoiceId, patientReferenceText: "policyholder1", invoiceReferenceText: invoiceId, treatmentText: "Synthetic surgery", amountBdt, admissionDate, dischargeDate, status: "FINALIZED" });
    await form("recordHospitalModelFacts", { invoiceId, treatmentType: "SURGERY", diagnosisCode, invoiceDate, expectedMinBdt: minimum, expectedMaxBdt: maximum, licenseStatus: "ACTIVE" });
  }
  async function shares(evidenceIds: string[], round: string) {
    await login("holder");
    for (const evidenceId of evidenceIds) for (let n = 1; n <= 4; n++) await form("grantEvidenceAccess", {
      id: id(`grant-${round}-${evidenceId.includes("optional") ? "optional" : "primary"}-${n}`), evidenceId,
      granteeMsp: "AuditorMSP", granteeRole: "auditor", granteeSubject: `auditor${n}`, purpose: "AUDIT",
      expiresAt: new Date(Date.now() + 4 * 3600000).toISOString(), maxAccesses: "20",
    });
  }
  async function openReview(requestId: string, reviewId: string) {
    await login("insurer");
    await form("routeOracleFailureToReview", { requestId, reviewId, assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: "3", rejectionThreshold: "2", deadline: new Date(Date.now() + 3600000).toISOString() });
    expect(await asset("review", reviewId)).toMatchObject({ assignedAuditorIds: ["auditor1", "auditor2", "auditor3", "auditor4"], approvalThreshold: 3, rejectionThreshold: 2, status: "OPEN" });
  }
  try {
    await test.step("published terms, OTP and EFT refer to the same collectible installments", async () => {
      await login("insurer");
      await form("createPolicyPackage", { id: id("package"), name: "Browser rehearsal synthetic coverage", description: "Synthetic thesis demonstration", premiumBdt: "100.00", coverageLimitBdt: "200000.00", termsText: id("terms-v1") });
      await form("configurePolicyPackagePartners", { id: id("package"), hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
      await form("publishPolicyPackage", { id: id("package") });
      await login("bank");
      for (const [name, ownerId, accountType, amount] of [["customer", "policyholder1", "CUSTOMER", "3000.00"], ["premium", "insurer", "INSURER", "0.00"], ["reserve", "insurer", "INSURER", "0.00"]]) await form("openBankAccount", {
        id: id(name), bankId: "bank-demo", ownerId, accountType, accountLabel: "Synthetic browser rehearsal", maskedAccount: "**** 2468", openingBalanceBdt: amount, accountTokenText: id(`vault-${name}`),
      });
      await login("holder");
      await form("acquirePolicy", { id: id("policy"), packageId: id("package"), startDate: "2026-01-01", endDate: "2026-12-31" });
      expect(await asset("policy", id("policy"))).toMatchObject({ premiumMinor: 10000, coverageLimitMinor: 20000000 });
      await form("requestBankMandate", { id: id("mandate"), policyId: id("policy"), accountReferenceId: id("customer"), expiryDate: "2026-12-31" });
      await login("bank"); await form("reviewBankMandate", { id: id("mandate"), outcome: "APPROVE", decisionText: id("mandate-review") });
      await login("insurer"); await form("queuePremiumCollection", { id: id("queued-first"), mandateId: id("mandate"), dueDate: "2026-01-01" });
      await login("holder");
      await openPage(page, "payments");
      const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Pay with one-time authorization", exact: true }) });
      for (const [label, value] of Object.entries({ "Policy ID": id("policy"), "Customer account ID": id("customer"), "Insurer account ID": id("premium"), "Transfer ID": id("otp-transfer"), "Payment ID": id("otp-payment"), "Period starts": "2026-01-01", "Period ends": "2026-01-30", "Premium (BDT)": "100.00", "External bank receipt": id("otp-bank-reference") })) await card.getByLabel(label, { exact: true }).fill(value);
      await card.getByRole("button", { name: "Email OTP", exact: true }).click();
      const code = card.locator(".evidenceWarning strong"); await expect(code).toHaveText(/^\d{6}$/);
      await card.getByLabel("Six-digit OTP", { exact: true }).fill((await code.textContent())!);
      const paid = page.waitForResponse(response => response.url().endsWith("/api/banking/premium-payment") && response.request().method() === "POST", { timeout: 120000 });
      await card.getByRole("button", { name: "Authorize premium", exact: true }).click();
      const paymentResponse = await paid; expect(paymentResponse.status(), await paymentResponse.text()).toBe(200);
      await login("bank"); expect((await asset("account", id("customer"))).balanceMinor).toBe(290000);
      await form("processPremiumCollection", { collectionId: id("queued-first"), paymentId: id("unused-payment"), transferId: id("unused-transfer"), destinationAccountId: id("premium"), periodEndDate: "2026-01-30", externalReferenceText: id("reconcile") });
      expect((await asset("account", id("customer"))).balanceMinor).toBe(290000);
      await login("insurer"); await form("queuePremiumCollection", { id: id("queued-second"), mandateId: id("mandate"), dueDate: "2026-01-31" });
      await login("bank"); await form("processPremiumCollection", { collectionId: id("queued-second"), paymentId: id("eft-payment"), transferId: id("eft-transfer"), destinationAccountId: id("premium"), periodEndDate: "2026-02-28", externalReferenceText: id("eft") });
      expect((await asset("account", id("customer"))).balanceMinor).toBe(280000);
      expect((await asset("account", id("premium"))).balanceMinor).toBe(20000);
      await login("holder");
      await openPage(page, "policies");
      const statement = page.locator("article").filter({ has: page.getByRole("heading", { name: "Export coverage and payment history", exact: true }) });
      await statement.getByLabel("Policy ID", { exact: true }).fill(id("policy"));
      const downloadPromise = page.waitForEvent("download"); await statement.getByRole("link", { name: "Download statement JSON" }).click();
      const file = await (await downloadPromise).path(); if (!file) throw new Error("Statement download missing");
      const result = JSON.parse(await readFile(file, "utf8"));
      expect(result.policy.id).toBe(id("policy")); expect(result.payments).toHaveLength(2); expect(result.summary.netPremiumMinor).toBe(20000);
      journal.push({ point: "UI statement download reconciles OTP and EFT", statement: result });
    });
    await test.step("Hospital forms, institution isolation, encrypted invoice and automatic Oracle route", async () => {
      await invoice(id("auto-invoice"), "2026-01-15", "2026-01-15", "2026-01-15", "500.00", "250.00", "750.00");
      await login("hospital2");
      await form("updateHospitalInvoice", { id: id("auto-invoice"), patientReferenceText: "policyholder1", invoiceReferenceText: id("auto-invoice"), treatmentText: "Synthetic surgery", amountBdt: "500.00", admissionDate: "2026-01-15", dischargeDate: "2026-01-15", status: "VOID" }, 409);
      await login("hospital"); expect((await asset("hospital-invoice", id("auto-invoice"))).status).toBe("FINALIZED");
      await login("holder");
      await form("submitClaim", { id: id("auto-claim"), policyId: id("policy"), hospitalInvoiceId: id("auto-invoice"), amountBdt: "250.00", incidentDate: "2026-01-15", descriptionText: "Synthetic automatic browser claim" });
      await upload(id("auto-claim"), id("auto-evidence"), "INVOICE", "Synthetic browser automatic invoice");
      await decrypt(id("auto-evidence"), "Synthetic browser automatic invoice");
      await login("insurer"); await form("startClaimProcessing", { claimId: id("auto-claim") });
      await expect.poll(async () => (await asset("claim", id("auto-claim"))).status, { timeout: 180000, intervals: [2000] }).toBe("APPROVED");
      await screenshot("automatic-oracle-route");
    });
    await test.step("model-only review, four-person panel and rejected first round", async () => {
      await login("insurer");
      const archiveResponse = await page.request.get("/api/ledger/hospital-invoice"); expect(archiveResponse.status()).toBe(200);
      const archive = (await archiveResponse.json()).result as Array<{ id: string; admissionDate: string; dischargeDate: string }>;
      const years = new Set(archive.flatMap(row => [row.admissionDate.slice(0, 4), row.dischargeDate.slice(0, 4)]));
      // Select the cohort before inference, without inspecting scores. Existing
      // dates/history remain intact; this is a synthetic business-date fixture.
      for (let year = 2025; year >= 2000; year--) if (!years.has(String(year))) { modelYear = String(year); break; }
      expect(modelYear, "No unused synthetic cohort; preserve history and review fixture allocation").not.toBe("");
      journal.push({ point: "synthetic-ui-context-v1 allocation before inference", modelYear, existingArchiveSha256: sha(JSON.stringify(archive)), intendedPriorCount: 1, intendedProviderLagDays: 9 });
      await form("issuePolicy", { id: id("review-policy"), packageId: id("package"), policyholderId: "policyholder1", startDate: modelDate("01-01"), endDate: modelDate("12-31") });
      await invoice(id("prior-invoice"), modelDate("06-01"), modelDate("06-02"), modelDate("06-03"), "100000.00", "50000.00", "200000.00", "D1");
      await invoice(id("review-invoice"), modelDate("06-10"), modelDate("06-11"), modelDate("06-12"), "100000.00", "50000.00", "200000.00", "D1");
      await login("holder"); await form("submitClaim", { id: id("review-claim"), policyId: id("review-policy"), hospitalInvoiceId: id("review-invoice"), amountBdt: "50000.00", incidentDate: modelDate("06-10"), descriptionText: "Synthetic model-only browser claim" });
      await upload(id("review-claim"), id("v1-primary"), "INVOICE", "Synthetic review primary v1");
      await upload(id("review-claim"), id("v1-optional"), "DISCHARGE_SUMMARY", "Synthetic review optional v1");
      await login("insurer"); const request = await form("startClaimProcessing", { claimId: id("review-claim") });
      await expect.poll(async () => ["ORACLE_FAILED", "APPROVED"].includes((await asset("claim", id("review-claim"))).status), { timeout: 180000, intervals: [2000] }).toBe(true);
      const resultsResponse = await page.request.get("/api/ledger/oracle-result"); expect(resultsResponse.status()).toBe(200);
      const results = (await resultsResponse.json()).result.filter((row: { requestId: string }) => row.requestId === request.id);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].verificationCode).toMatch(/^XGB_REVIEW:[A-F0-9]{64}$/);
      const directory = path.resolve(process.env.ALIGNMENT_ORACLE_STATE_ROOT ?? "data/oracle-alignment-20261108", results[0].oracleId, "decisions");
      const decisions = await Promise.all((await readdir(directory)).map(async file => JSON.parse(await readFile(path.join(directory, file), "utf8"))));
      const model = decisions.find(row => row.body.decision.resultHash === results[0].resultHash)?.body.decision.assessment.result;
      expect(model.prepared.observation.providerLags).toEqual([9]);
      expect(model.prepared.observation.features.history_patient14).toBe(Math.log(2));
      expect(model.assessment.riskScoreUnits).toBe(90846555); // Fabric-owned paired frozen baseline.
      expect(model.prepared.observation.mandatory).toBe(false); expect(model.assessment.reasons).toEqual(["MODEL_THRESHOLD"]);
      expect((await asset("claim", id("review-claim"))).status).toBe("ORACLE_FAILED");
      journal.push({ point: "actual request-pinned model-only recommendation", requestId: request.id, results, model });
      await shares([id("v1-primary"), id("v1-optional")], "v1"); await openReview(request.id, id("review-v1"));
      await login("auditor1"); await decrypt(id("v1-optional"), "Synthetic review optional v1");
      await form("recordAuditorDecision", { reviewId: id("review-v1"), decisionId: id("reject-1"), outcome: "REJECT", reasonText: "Synthetic document correction needed" });
      await login("auditor2"); await form("recordAuditorDecision", { reviewId: id("review-v1"), decisionId: id("reject-2"), outcome: "REJECT", reasonText: "Synthetic document correction corroborated" });
      await login("holder"); expect((await asset("claim", id("review-claim"))).status).toBe("REJECTED");
      await screenshot("rejected-first-review");
    });
    await test.step("corrected appeal isolates documents and votes; three human approvals authorize review outcome", async () => {
      await invoice(id("corrected-invoice"), modelDate("06-10"), modelDate("06-11"), modelDate("06-12"), "100000.00", "50000.00", "200000.00", "D1");
      await login("holder"); await form("submitClaimAppeal", { appealId: id("appeal"), claimId: id("review-claim"), reasonCategory: "DOCUMENT_ERROR", reasonText: "Synthetic corrected invoice supplied", descriptionText: "Synthetic correction preserves recorded amount", evidenceText: "Synthetic corrected appeal primary v2", proposedClinicalReferenceHash: sha(id("corrected-invoice")) });
      expect(await asset("claim", id("review-claim"))).toMatchObject({ version: 2, appealCount: 1 });
      await upload(id("review-claim"), id("v2-primary"), "APPEAL_DOCUMENT", "Synthetic corrected appeal primary v2");
      // Retain Fabric's committed APPEAL_DOCUMENT-only rule. The original run
      // exposed this unsupported fixture plus a real API pending/rejection bug.
      await upload(id("review-claim"), id("v2-optional"), "DISCHARGE_SUMMARY", "Synthetic corrected optional v2", 409);
      expect((await asset("claim", id("review-claim"))).evidenceIds).not.toContain(id("v2-optional"));
      await shares([id("v2-primary")], "v2");
      await login("auditor4");
      const stale = await page.request.post(`/api/evidence/${id("v2-primary")}`, { data: { grantId: id("grant-v1-primary-4") } });
      expect(stale.status()).toBe(403);
      journal.push({ point: "old grant cannot authorize the corrected document before workflow assignment", evidenceId: id("v2-primary"), grantId: id("grant-v1-primary-4"), httpStatus: stale.status() });
      await login("insurer"); const request = await form("startClaimProcessing", { claimId: id("review-claim") });
      await expect.poll(async () => (await asset("claim", id("review-claim"))).status, { timeout: 180000, intervals: [2000] }).toBe("ORACLE_FAILED");
      await openReview(request.id, id("review-v2"));
      await login("auditor4"); await form("recordAuditorDecision", { reviewId: id("review-v1"), decisionId: id("stale-vote"), outcome: "APPROVE", reasonText: "Synthetic stale version must fail" }, 409);
      expect((await asset("evidence", id("v1-primary"))).claimVersion).toBe(1);
      expect((await asset("evidence", id("v2-primary"))).claimVersion).toBe(2);
      // Current assigned reviewers retain access to the case's original history;
      // those documents do not become the new version's primary evidence.
      await decrypt(id("v1-primary"), "Synthetic review primary v1");
      for (const role of ["auditor1", "auditor2", "auditor3"] as const) {
        await login(role); await decrypt(id("v2-primary"), "Synthetic corrected appeal primary v2");
        await form("recordAuditorDecision", { reviewId: id("review-v2"), decisionId: id(`approve-${role}`), outcome: "APPROVE", reasonText: `Synthetic independent ${role} assessment` });
        if (role === "auditor2") { await login("insurer"); expect((await asset("claim", id("review-claim"))).status).toBe("UNDER_REVIEW"); }
      }
      await login("insurer"); expect((await asset("claim", id("review-claim"))).status).toBe("APPROVED");
      await screenshot("three-approval-appeal-review");
    });
    await test.step("Bank bounces underfunding, later funding settles once, all essential role pages fit320px", async () => {
      await login("insurer"); await form("authorizeSettlement", { settlementId: id("settlement"), claimId: id("review-claim"), sourceAccountId: id("reserve"), destinationAccountId: id("customer") });
      await login("bank");
      const bounced = await form("confirmSettlement", { settlementId: id("settlement"), transferId: id("bounced-transfer"), bankReferenceText: id("bounced-bank-reference") });
      expect(bounced.status).toBe("PAYMENT_FAILED"); expect((await asset("account", id("customer"))).balanceMinor).toBe(280000);
      await form("adjustBankAccountBalance", { transferId: id("funding"), accountId: id("reserve"), direction: "CREDIT", amountBdt: "50000.00", externalReferenceText: id("funding-reference") });
      const payout = { settlementId: id("settlement"), transferId: id("paid-transfer"), bankReferenceText: id("paid-bank-reference") };
      await form("confirmSettlement", payout); expect((await asset("account", id("customer"))).balanceMinor).toBe(5280000);
      await form("confirmSettlement", payout, 409); expect((await asset("account", id("customer"))).balanceMinor).toBe(5280000);
      journal.push({ point: "exactly one settled payout", settlement: await asset("settlement", id("settlement")), account: await asset("account", id("customer")) });
      await page.setViewportSize({ width: 320, height: 800 });
      for (const role of ["bank", "holder", "hospital", "insurer", "auditor1"] as const) {
        await login(role); await expect(page.getByRole("navigation", { name: "Workspace pages" })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${role} horizontal overflow`).toBe(true);
        await screenshot(`mobile-${role}`);
      }
      expect(browserErrors).toEqual([]);
    });
  } finally {
    await info.attach("rehearsal-identity-and-outcomes", { body: JSON.stringify({ channel: process.env.FABRIC_CHANNEL_NAME, fixtureSuffix: suffix, mutationBoundary: "business mutations through visible forms; passive reads and one stale-evidence denial use authenticated API", journal, browserErrors }, null, 2), contentType: "application/json" });
  }
});
