import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { encryptEvidenceBytes, decryptEvidenceBytes } from "../lib/evidence/browser-crypto";

const sha = (x: string) => createHash("sha256").update(x).digest("hex");
const channel = "insurance-workflow-alignment-20261108", deployment = channel + "/insurance-contract";
function control(file: string, args: string[] = []) {
  // Explicit opt-in: only the locally owned isolated app/worker PID controls.
  if (process.env.ALLOW_ISOLATED_APP_RESTART !== "true" || process.env.FABRIC_CHANNEL_NAME !== channel) throw new Error("Recovery faults require the exact isolated channel and explicit owned-app restart permission");
  execFileSync("pwsh.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve(".local-reference/alignment-2026-11-08", file), ...args], { cwd: process.cwd(), stdio: "ignore", timeout: 30000 });
}
async function restart(deadline = "60") {
  control("stop-alignment-app.ps1"); control("start-alignment-app.ps1", ["-CommitStatusDeadlineSeconds", deadline]);
  await expect.poll(async () => { try { return (await fetch("http://127.0.0.1:3200/api/health/live")).status; } catch { return 0; } }, { timeout: 30000 }).toBe(200);
}
async function actor(accountId: string) {
  const client = await request.newContext({ baseURL: "http://127.0.0.1:3200", timeout: 120000 });
  expect((await client.post("/api/auth/demo-login", { data: { accountId } })).status()).toBe(200); return client;
}
async function send(client: APIRequestContext, data: Record<string, unknown>) {
  const response = await client.post("/api/workflows", { data }); expect(response.ok(), await response.text()).toBe(true); return (await response.json()).result;
}
async function asset(client: APIRequestContext, type: string, id: string) {
  const response = await client.get(`/api/ledger/${type}/${id}`); expect(response.ok(), await response.text()).toBe(true); return (await response.json()).result;
}
async function evidence(client: APIRequestContext, claimId: string, id: string, documentType: string, text: string) {
  const encrypted = await encryptEvidenceBytes(new TextEncoder().encode(text), "synthetic recovery evidence secret", { claimId, evidenceId: id });
  const response = await client.post("/api/evidence", { multipart: { claimId, evidenceId: id, documentType, contentHash: encrypted.contentHash, ciphertext: { name: "synthetic.enc", mimeType: "application/octet-stream", buffer: Buffer.from(encrypted.envelope) } } });
  expect(response.status(), await response.text()).toBe(200); return encrypted;
}

test("@alignment-recovery real browser response loss and app restart preserve claim, review, appeal and settlement identities", async ({ page }, info) => {
  test.setTimeout(600000);
  const insurer = await actor("insurer-admin"), holder = await actor("policyholder-1"), hospital = await actor("hospital-officer"), bank = await actor("bank-officer");
  const auditors = await Promise.all(["auditor", "auditor-2", "auditor-3", "auditor-4"].map(actor));
  const journal: unknown[] = []; let disturbed = false;
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`, today = new Date().toISOString().slice(0, 10), end = new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10);
  const claimId = `recovery-claim-${suffix}`, policyId = `recovery-policy-${suffix}`, invoiceId = `recovery-invoice-${suffix}`;
  async function uncertain(client: APIRequestContext, command: Record<string, unknown>) {
    disturbed = true; await restart("0.000001");
    const requestId = randomUUID(), headers = { "idempotency-key": requestId, "x-workflow-deployment": deployment };
    const response = await client.post("/api/workflows", { headers, data: command }), pending = await response.json();
    expect(response.status(), JSON.stringify(pending)).toBe(202); expect(pending.state).toBe("PENDING"); expect(pending.transactionId).toBeTruthy();
    await restart();
    const recovery = await client.post("/api/workflows", { headers: { ...headers, "x-workflow-recovery": "true" }, data: command }), recovered = await recovery.json();
    expect(recovery.status(), JSON.stringify(recovered)).toBe(200);
    expect(recovered).toMatchObject({ state: "COMMITTED", validationCode: 0, transactionId: pending.transactionId });
    const replay = await client.post("/api/workflows", { headers, data: command });
    expect(replay.status()).toBe(200); expect(await replay.json()).toMatchObject({ transactionId: pending.transactionId, recovered: true });
    journal.push({ operation: command.operation, requestId, pending, recovered }); return recovered.result;
  }
  async function invoice(id: string, review = false) {
    await send(hospital, { operation: "createHospitalInvoice", id, patientReferenceHash: sha("policyholder1"), invoiceReferenceHash: sha(id), treatmentHash: sha("synthetic recovery surgery"), amountMinor: 50000, admissionDate: today, dischargeDate: today, status: "FINALIZED" });
    await send(hospital, { operation: "recordHospitalModelFacts", invoiceId: id, treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: today, expectedMinMinor: review ? 1 : 25000, expectedMaxMinor: review ? 2 : 75000, licenseStatus: "ACTIVE" });
  }
  try {
    await send(insurer, { operation: "issuePolicy", id: policyId, packageId: "showcase-health-v1", policyholderId: "policyholder1", startDate: today, endDate: end });
    await invoice(invoiceId, true);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.request.post("/api/auth/demo-login", { data: { accountId: "policyholder-1" } });
    await page.goto("/workspace/policyholder");
    let accepted: { transactionId: string } | undefined;
    await page.route("**/api/workflows", async route => {
      const response = await route.fetch(); const body = await response.json();
      expect(response.status(), JSON.stringify(body)).toBe(200); expect(body).toMatchObject({ state: "COMMITTED", validationCode: 0 });
      accepted = body; await route.abort("connectionreset"); // discard a real valid committed response
    });
    const form = page.locator("#guided-workflow");
    await form.getByLabel("Workflow action").selectOption("submitClaim");
    for (const [name, value] of Object.entries({ id: claimId, policyId, hospitalInvoiceId: invoiceId, amountBdt: "250.00", incidentDate: today, descriptionText: "Synthetic lost response claim" })) await form.locator(`[name="${name}"]`).fill(value);
    await form.getByRole("button", { name: "Submit verified transaction" }).click();
    await expect.poll(() => Boolean(accepted), { timeout: 120000 }).toBe(true);
    const savedCard = page.getByRole("article", { name: "Saved workflow action" }); await expect(savedCard).toBeVisible();
    disturbed = true; await restart(); await page.unroute("**/api/workflows"); await page.reload();
    await savedCard.getByRole("button", { name: "Check saved action" }).click(); await expect(savedCard).toHaveCount(0);
    expect((await asset(holder, "claim", claimId)).version).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    journal.push({ point: "real committed HTTP response lost; browser reload and app restart recover original claim", accepted });
    const primaryId = `recovery-evidence-${suffix}`, primaryText = "Synthetic recovery primary invoice";
    await evidence(holder, claimId, primaryId, "INVOICE", primaryText);
    const oracle = await send(insurer, { operation: "startClaimProcessing", claimId });
    await expect.poll(async () => (await asset(holder, "claim", claimId)).status, { timeout: 180000, intervals: [1500] }).toBe("ORACLE_FAILED");
    for (let n = 0; n < 4; n++) await send(holder, { operation: "grantEvidenceAccess", id: `recovery-grant-${suffix}-${n}`, evidenceId: primaryId, granteeMsp: "AuditorMSP", granteeRole: "auditor", granteeSubject: `auditor${n + 1}`, purpose: "AUDIT", expiresAt: new Date(Date.now() + 3600000).toISOString(), maxAccesses: 20 });
    const reviewId = `recovery-review-${suffix}`;
    await uncertain(insurer, { operation: "routeOracleFailureToReview", requestId: oracle.id, reviewId, assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: 3, rejectionThreshold: 2, deadline: new Date(Date.now() + 1200000).toISOString() });
    expect((await asset(insurer, "review", reviewId)).assignedAuditorIds).toHaveLength(4);
    const downloaded = await auditors[0].post(`/api/evidence/${primaryId}`); expect(downloaded.status()).toBe(200);
    expect(await decryptEvidenceBytes(new Uint8Array(await downloaded.body()), "synthetic recovery evidence secret", { claimId, evidenceId: primaryId })).toEqual(new TextEncoder().encode(primaryText));
    await uncertain(auditors[0], { operation: "recordAuditorDecision", reviewId, decisionId: `recovery-vote-${suffix}-0`, outcome: "REJECT", reasonHash: sha("synthetic rejection") });
    expect((await asset(insurer, "review", reviewId)).votesCast).toBe(1);
    await send(auditors[1], { operation: "recordAuditorDecision", reviewId, decisionId: `recovery-vote-${suffix}-1`, outcome: "REJECT", reasonHash: sha("synthetic rejection two") });
    expect((await asset(holder, "claim", claimId)).status).toBe("REJECTED");
    const correctedInvoiceId = `recovery-corrected-${suffix}`, appealText = "Synthetic corrected appeal invoice"; await invoice(correctedInvoiceId);
    const appealId = `recovery-appeal-${suffix}`;
    await uncertain(holder, { operation: "submitClaimAppeal", appealId, claimId, reasonCategory: "AMOUNT_CORRECTION", reasonHash: sha("correction"), descriptionHash: sha("appeal"), evidenceHash: sha(appealText), proposedHospitalId: "hospital-demo", proposedAmountMinor: 25000, proposedIncidentDate: today, proposedDescriptionHash: sha("corrected description"), proposedClinicalReferenceHash: sha(correctedInvoiceId) });
    expect(await asset(holder, "claim", claimId)).toMatchObject({ version: 2, appealCount: 1 });
    const stale = await auditors[2].post("/api/workflows", { data: { operation: "recordAuditorDecision", reviewId, decisionId: `recovery-stale-${suffix}`, outcome: "APPROVE", reasonHash: sha("stale") } }); expect(stale.status()).toBe(409);
    await evidence(holder, claimId, `recovery-appeal-document-${suffix}`, "APPEAL_DOCUMENT", appealText);
    await send(insurer, { operation: "startClaimProcessing", claimId });
    await expect.poll(async () => (await asset(holder, "claim", claimId)).status, { timeout: 180000, intervals: [1500] }).toBe("APPROVED");
    const sourceAccountId = `recovery-source-${suffix}`, destinationAccountId = `recovery-dest-${suffix}`, settlementId = `recovery-settlement-${suffix}`;
    for (const [id, ownerId, accountType] of [[sourceAccountId, "insurer", "INSURER"], [destinationAccountId, "policyholder1", "CUSTOMER"]]) await send(bank, { operation: "openBankAccount", id, bankId: "bank-demo", ownerId, accountType, accountLabel: "Synthetic recovery", maskedAccount: "**** 6789", accountTokenHash: sha(id), openingBalanceMinor: 0 });
    await uncertain(insurer, { operation: "authorizeSettlement", settlementId, claimId, sourceAccountId, destinationAccountId });
    const bounced = await uncertain(bank, { operation: "confirmSettlement", settlementId, transferId: `recovery-bounced-${suffix}`, bankReferenceHash: sha(`bounce-${suffix}`) });
    expect(bounced.status).toBe("PAYMENT_FAILED"); expect((await asset(bank, "account", destinationAccountId)).balanceMinor).toBe(0);
    await send(bank, { operation: "adjustBankAccountBalance", transferId: `recovery-funded-${suffix}`, accountId: sourceAccountId, direction: "CREDIT", amountMinor: 100000, externalReferenceHash: sha(`funding-${suffix}`) });
    const payment = { operation: "confirmSettlement", settlementId, transferId: `recovery-paid-${suffix}`, bankReferenceHash: sha(`paid-${suffix}`) };
    expect((await insurer.post("/api/workflows", { data: payment })).status()).toBe(403);
    await uncertain(bank, payment);
    expect((await asset(bank, "account", destinationAccountId)).balanceMinor).toBe(25000);
    expect((await bank.post("/api/workflows", { data: payment })).status()).toBe(409);
    expect((await asset(bank, "account", destinationAccountId)).balanceMinor).toBe(25000);
    journal.push({ finalClaim: await asset(holder, "claim", claimId), finalSettlement: await asset(bank, "settlement", settlementId) });
  } finally {
    await info.attach("actual-recovery-journey", { body: JSON.stringify(journal, null, 2), contentType: "application/json" });
    if (disturbed) await restart();
    await Promise.all([insurer, holder, hospital, bank, ...auditors].map(client => client.dispose()));
  }
});
