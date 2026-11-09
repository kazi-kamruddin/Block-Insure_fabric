import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { decryptEvidenceBytes, encryptEvidenceBytes } from "../lib/evidence/browser-crypto";
import evaluator from "../lib/oracle/evaluator.json";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const today = new Date().toISOString().slice(0, 10);
const end = new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10);
const panel = '["auditor1","auditor2","auditor3","auditor4"]';
async function actor(baseURL: string, accountId: string) {
  const client = await request.newContext({ baseURL });
  const login = await client.post("/api/auth/demo-login", { data: { accountId } });
  expect(login.ok(), await login.text()).toBe(true);
  return client;
}
async function actors(baseURL: string) {
  const clients = await Promise.all(["insurer-admin", "policyholder-1", "hospital-officer", "bank-officer", "auditor", "auditor-2", "auditor-3", "auditor-4"].map(id => actor(baseURL, id)));
  return { insurer: clients[0], holder: clients[1], hospital: clients[2], bank: clients[3], auditors: clients.slice(4), close: () => Promise.all(clients.map(client => client.dispose())) };
}
type Actors = Awaited<ReturnType<typeof actors>>;
async function send(client: APIRequestContext, data: Record<string, unknown>) {
  const response = await client.post("/api/workflows", { data });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).result;
}
async function asset(client: APIRequestContext, kind: string, id: string) {
  const response = await client.get(`/api/ledger/${kind}/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).result;
}
async function invoice(ctx: Actors, id: string, modelReview = false) {
  const reference = sha(id);
  await send(ctx.hospital, { operation: "createHospitalInvoice", id, patientReferenceHash: sha("policyholder1"), invoiceReferenceHash: reference, treatmentHash: sha("synthetic surgery"), amountMinor: 50000, admissionDate: today, dischargeDate: today, status: "FINALIZED" });
  await send(ctx.hospital, { operation: "recordHospitalModelFacts", invoiceId: id, treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: today,
    expectedMinMinor: modelReview ? 1 : 25000, expectedMaxMinor: modelReview ? 2 : 75000, licenseStatus: "ACTIVE" });
  return reference;
}
async function evidence(holder: APIRequestContext, claimId: string, id: string, documentType: string, text: string) {
  const plaintext = new TextEncoder().encode(text), passphrase = "synthetic stage-b shared document secret";
  const encrypted = await encryptEvidenceBytes(plaintext, passphrase, { claimId, evidenceId: id });
  const upload = await holder.post("/api/evidence", { multipart: { claimId, evidenceId: id, documentType, contentHash: encrypted.contentHash,
    ciphertext: { name: "document.enc", mimeType: "application/octet-stream", buffer: Buffer.from(encrypted.envelope) } } });
  expect(upload.status(), await upload.text()).toBe(200);
  return { id, plaintext, passphrase, contentHash: encrypted.contentHash };
}
type Document = Awaited<ReturnType<typeof evidence>>;
async function claim(ctx: Actors, kind: "model-review" | "integrity-negative") {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`, id = `stage-b-claim-${suffix}`, policyId = `stage-b-policy-${suffix}`;
  await send(ctx.insurer, { operation: "issuePolicy", id: policyId, packageId: "showcase-health-v1", policyholderId: "policyholder1", startDate: today, endDate: end });
  await invoice(ctx, `stage-b-invoice-${suffix}`, kind === "model-review");
  await send(ctx.holder, { operation: "submitClaim", id, policyId, hospitalId: "hospital-demo", hospitalInvoiceId: `stage-b-invoice-${suffix}`, amountMinor: kind === "model-review" ? 25000 : 60000, incidentDate: today, descriptionHash: sha("synthetic stage-b claim") });
  const document = await evidence(ctx.holder, id, `stage-b-evidence-${suffix}`, "INVOICE", `Synthetic invoice ${suffix}`);
  return { id, suffix, document };
}
async function processing(ctx: Actors, claimId: string) {
  const current = await send(ctx.insurer, { operation: "startClaimProcessing", claimId });
  expect(current.modelVersion).toBe(evaluator.evaluatorVersion);
  expect(current.modelHash).toBe(evaluator.evaluatorHash);
  expect(current.assignedOracleIds).toHaveLength(3);
  expect(current.requiredConfirmations).toBe(2);
  return current;
}
async function failedOracle(ctx: Actors, claimId: string) {
  const current = await processing(ctx, claimId);
  await expect.poll(async () => (await asset(ctx.insurer, "claim", claimId)).status, { timeout: 180000, intervals: [1500] }).toBe("ORACLE_FAILED");
  return current;
}
async function review(ctx: Actors, claimId: string, requestId: string, documents: Document[], seconds = 600) {
  const grants: string[] = [];
  for (const document of documents) for (let n = 0; n < 4; n++) {
    const id = `stage-b-grant-${document.id}-${n}`;
    await send(ctx.holder, { operation: "grantEvidenceAccess", id, evidenceId: document.id, granteeMsp: "AuditorMSP", granteeRole: "auditor", granteeSubject: `auditor${n + 1}`, purpose: "AUDIT", expiresAt: new Date(Date.now() + 3600000).toISOString(), maxAccesses: 20 });
    grants.push(id);
  }
  const id = `stage-b-review-${randomUUID()}`, deadline = new Date(Date.now() + seconds * 1000).toISOString();
  const result = await send(ctx.insurer, { operation: "routeOracleFailureToReview", requestId, reviewId: id, assignedAuditorIdsJson: panel, approvalThreshold: 3, rejectionThreshold: 2, deadline });
  expect(result.assignedAuditorIds).toHaveLength(4);
  expect(result.approvalThreshold).toBe(3);
  expect(result.rejectionThreshold).toBe(2);
  expect((await asset(ctx.insurer, "claim", claimId)).currentReviewId).toBe(id);
  return { id, deadline, grants };
}
async function vote(ctx: Actors, reviewId: string, auditor: number, outcome: "APPROVE" | "REJECT") {
  return send(ctx.auditors[auditor], { operation: "recordAuditorDecision", reviewId, decisionId: `stage-b-vote-${randomUUID()}`, outcome, reasonHash: sha(`synthetic human decision ${outcome}`) });
}

async function premiumFixture(ctx: Actors) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`, packageId = `stage-b-package-${suffix}`, policyId = `stage-b-premium-policy-${suffix}`;
  const sourceAccountId = `stage-b-premium-source-${suffix}`, destinationAccountId = `stage-b-premium-dest-${suffix}`, mandateId = `stage-b-mandate-${suffix}`, collectionId = `stage-b-collection-${suffix}`;
  await send(ctx.insurer, { operation: "createPolicyPackage", id: packageId, name: "Synthetic coordinated premium", description: "Stage B isolated payment verification", premiumMinor: 10000, coverageLimitMinor: 1000000, termsHash: sha(packageId) });
  await send(ctx.insurer, { operation: "configurePolicyPackagePartners", id: packageId, hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
  await send(ctx.insurer, { operation: "publishPolicyPackage", id: packageId });
  for (const [id, ownerId, accountType, openingBalanceMinor] of [[sourceAccountId, "policyholder1", "CUSTOMER", 30000], [destinationAccountId, "insurer", "INSURER", 0]]) await send(ctx.bank, { operation: "openBankAccount", id, bankId: "bank-demo", ownerId, accountType, accountLabel: "Synthetic premium race", maskedAccount: "**** 6789", accountTokenHash: sha(String(id)), openingBalanceMinor });
  await send(ctx.holder, { operation: "acquirePolicy", id: policyId, packageId, startDate: "2026-01-01", endDate: "2026-12-31" });
  await send(ctx.holder, { operation: "requestBankMandate", id: mandateId, policyId, accountReferenceId: sourceAccountId, expiryDate: "2026-12-31" });
  await send(ctx.bank, { operation: "reviewBankMandate", id: mandateId, outcome: "APPROVE", decisionHash: sha(mandateId) });
  await send(ctx.insurer, { operation: "queuePremiumCollection", id: collectionId, mandateId, dueDate: "2026-01-01" });
  const intent = { policyId, sourceAccountId, destinationAccountId, transferId: `stage-b-otp-transfer-${suffix}`, paymentId: `stage-b-otp-payment-${suffix}`, amountMinor: 10000, periodStartDate: "2026-01-01", periodEndDate: "2026-01-30", externalReferenceHash: sha(`otp-${suffix}`) };
  const otpResponse = await ctx.holder.post("/api/banking/otp", { data: intent });
  expect(otpResponse.ok(), await otpResponse.text()).toBe(true);
  const otp = await otpResponse.json();
  const manual = { ...intent, challengeId: otp.challengeId, otp: otp.demoCode };
  const eft = { operation: "processPremiumCollection", collectionId, paymentId: `stage-b-eft-payment-${suffix}`, transferId: `stage-b-eft-transfer-${suffix}`, destinationAccountId, periodEndDate: "2026-01-30", externalReferenceHash: sha(`eft-${suffix}`) };
  return { suffix, policyId, collectionId, sourceAccountId, destinationAccountId, intent, manual, eft };
}

test("@alignment-model-only frozen model independently recommends review with clean integrity checks", async ({ baseURL }, info) => {
  test.setTimeout(240000);
  if (!baseURL) throw new Error("baseURL required");
  const ctx = await actors(baseURL), suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const packageId = `stage-b-model-package-${suffix}`, policyId = `stage-b-model-policy-${suffix}`, claimId = `stage-b-model-claim-${suffix}`;
  const currentInvoiceId = `stage-b-model-current-${suffix}`;
  try {
    // Reuse the owned paired baseline's dates, amounts and prior-history gap.
    // Later retained demonstration records cannot enter its June cutoff.
    await send(ctx.insurer, { operation: "createPolicyPackage", id: packageId, name: "Synthetic paired model-only fixture", description: "Frozen baseline units and dates", premiumMinor: 10000, coverageLimitMinor: 20000000, termsHash: sha(packageId) });
    await send(ctx.insurer, { operation: "configurePolicyPackagePartners", id: packageId, hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
    await send(ctx.insurer, { operation: "publishPolicyPackage", id: packageId });
    await send(ctx.insurer, { operation: "issuePolicy", id: policyId, packageId, policyholderId: "policyholder1", startDate: "2026-01-01", endDate: "2026-12-31" });
    for (const [id, admissionDate, dischargeDate, invoiceDate] of [[`stage-b-model-prior-${suffix}`, "2026-06-01", "2026-06-02", "2026-06-03"], [currentInvoiceId, "2026-06-10", "2026-06-11", "2026-06-12"]]) {
      await send(ctx.hospital, { operation: "createHospitalInvoice", id, patientReferenceHash: sha("policyholder1"), invoiceReferenceHash: sha(id), treatmentHash: sha("synthetic surgery"), amountMinor: 10000000, admissionDate, dischargeDate, status: "FINALIZED" });
      await send(ctx.hospital, { operation: "recordHospitalModelFacts", invoiceId: id, treatmentType: "SURGERY", diagnosisCode: "D1", invoiceDate, expectedMinMinor: 5000000, expectedMaxMinor: 20000000, licenseStatus: "ACTIVE" });
    }
    await send(ctx.holder, { operation: "submitClaim", id: claimId, policyId, hospitalId: "hospital-demo", hospitalInvoiceId: currentInvoiceId, amountMinor: 5000000, incidentDate: "2026-06-10", descriptionHash: sha("synthetic paired model baseline") });
    await evidence(ctx.holder, claimId, `stage-b-model-evidence-${suffix}`, "INVOICE", `Synthetic paired model invoice ${suffix}`);
    const current = await failedOracle(ctx, claimId);
    const response = await ctx.insurer.get("/api/ledger/oracle-result"); expect(response.ok(), await response.text()).toBe(true);
    const results = (await response.json()).result.filter((row: { requestId: string }) => row.requestId === current.id);
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const result of results) { expect(result.verified).toBe(false); expect(result.verificationCode).toMatch(/^XGB_REVIEW:[A-F0-9]{64}$/); }
    const oracleResult = results[0];
    expect(["oracle1", "oracle2", "oracle3"]).toContain(oracleResult.oracleId);
    const directory = path.resolve(process.env.ALIGNMENT_ORACLE_STATE_ROOT ?? "data/oracle-alignment-20261108", oracleResult.oracleId, "decisions");
    const decisions = await Promise.all((await readdir(directory)).map(async file => JSON.parse(await readFile(path.join(directory, file), "utf8"))));
    const decision = decisions.find(row => row.body.decision.resultHash === oracleResult.resultHash)?.body.decision;
    expect(decision, "actual persisted worker assessment required").toBeDefined();
    const model = decision.assessment.result;
    expect(model.prepared.observation.mandatory).toBe(false);
    expect(model.assessment.reasons).toEqual(["MODEL_THRESHOLD"]);
    expect(model.assessment.riskScoreUnits).toBeGreaterThanOrEqual(86932212);
    await info.attach("model-only-routing", { body: JSON.stringify({ requestId: current.id, results, observation: model.prepared.observation, assessment: model.assessment }, null, 2), contentType: "application/json" });
  } finally { await ctx.close(); }
});

test("@alignment-context unavailable required source context prevents automatic approval and stays request-pinned", async ({ baseURL }, info) => {
  test.setTimeout(240000);
  if (!baseURL) throw new Error("baseURL required");
  const ctx = await actors(baseURL), suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const policyId = `stage-b-context-policy-${suffix}`, invoiceId = `stage-b-context-invoice-${suffix}`, claimId = `stage-b-context-claim-${suffix}`;
  let invoiceCreated = false, factsRecorded = false;
  const facts = { operation: "recordHospitalModelFacts", invoiceId, treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: today, expectedMinMinor: 25000, expectedMaxMinor: 75000, licenseStatus: "ACTIVE" };
  try {
    await send(ctx.insurer, { operation: "issuePolicy", id: policyId, packageId: "showcase-health-v1", policyholderId: "policyholder1", startDate: today, endDate: end });
    await send(ctx.hospital, { operation: "createHospitalInvoice", id: invoiceId, patientReferenceHash: sha("policyholder1"), invoiceReferenceHash: sha(invoiceId), treatmentHash: sha("synthetic surgery"), amountMinor: 50000, admissionDate: today, dischargeDate: today, status: "FINALIZED" });
    invoiceCreated = true;
    await send(ctx.holder, { operation: "submitClaim", id: claimId, policyId, hospitalId: "hospital-demo", hospitalInvoiceId: invoiceId, amountMinor: 25000, incidentDate: today, descriptionHash: sha("synthetic unavailable context") });
    await evidence(ctx.holder, claimId, `stage-b-context-evidence-${suffix}`, "INVOICE", `Synthetic invoice ${suffix}`);
    const current = await processing(ctx, claimId);
    // New facts become available after the request pins its snapshot. They
    // cannot repair or silently replace the unavailable request context.
    await send(ctx.hospital, facts); factsRecorded = true;
    await expect.poll(async () => (await asset(ctx.insurer, "claim", claimId)).status, { timeout: 180000, intervals: [1500] }).toBe("ORACLE_FAILED");
    const final = await asset(ctx.insurer, "oracle-request", current.id);
    const response = await ctx.insurer.get("/api/ledger/oracle-result");
    expect(response.ok(), await response.text()).toBe(true);
    const results = (await response.json()).result.filter((row: { requestId: string }) => row.requestId === current.id);
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const result of results) expect(result).toMatchObject({ verified: false, verificationCode: "XGB_CONTEXT_OR_INFERENCE_UNAVAILABLE" });
    expect(final).toMatchObject({ status: "FAILED", finalizationCode: "NEGATIVE_RESULT", registrySnapshotId: current.registrySnapshotId, registryRootHash: current.registryRootHash });
    await info.attach("unavailable-context", { body: JSON.stringify({ current, final, results }, null, 2), contentType: "application/json" });
  } finally {
    // Keep retained Hospital history usable for subsequent independent cases.
    if (invoiceCreated && !factsRecorded) await send(ctx.hospital, facts);
    await ctx.close();
  }
});

test("@alignment-payments-race concurrent OTP and EFT collect one installment exactly once", async ({ baseURL }, info) => {
  test.setTimeout(240000);
  if (!baseURL) throw new Error("baseURL required");
  const ctx = await actors(baseURL);
  try {
    const fixture = await premiumFixture(ctx);
    const responses = await Promise.all([ctx.holder.post("/api/banking/premium-payment", { data: fixture.manual }), ctx.bank.post("/api/workflows", { data: fixture.eft })]);
    const outcomes = await Promise.all(responses.map(async response => ({ status: response.status(), body: await response.json() })));
    await info.attach("concurrent-outcomes", { body: JSON.stringify({ policyId: fixture.policyId, outcomes }), contentType: "application/json" });
    expect(outcomes.map(row => row.status).sort()).toEqual([200, 409]);
    expect((await asset(ctx.bank, "account", fixture.sourceAccountId)).balanceMinor).toBe(20000);
    expect((await asset(ctx.bank, "account", fixture.destinationAccountId)).balanceMinor).toBe(10000);
    const response = await ctx.holder.get("/api/ledger/premium-payment");
    expect(response.ok(), await response.text()).toBe(true);
    expect((await response.json()).result.filter((row: { policyId: string }) => row.policyId === fixture.policyId)).toHaveLength(1);
    const policy = await asset(ctx.holder, "policy", fixture.policyId);
    expect(policy.paidThroughDate).toBe("2026-01-30");
    expect(policy.nextPremiumDueDate).toBe("2026-01-31");
    const recovery = await ctx.holder.post("/api/banking/premium-payment", { data: { ...fixture.intent, recoverOnly: true } });
    expect(recovery.status()).toBe(outcomes[0].status === 200 ? 200 : 202);
  } finally { await ctx.close(); }
});

test("@alignment-payments-reconcile queued EFT reconciles an installment already collected by OTP", async ({ baseURL }, info) => {
  test.setTimeout(240000);
  if (!baseURL) throw new Error("baseURL required");
  const ctx = await actors(baseURL);
  try {
    const fixture = await premiumFixture(ctx);
    const manual = await ctx.holder.post("/api/banking/premium-payment", { data: fixture.manual });
    expect(manual.ok(), await manual.text()).toBe(true);
    const result = await ctx.bank.post("/api/workflows", { data: fixture.eft });
    await info.attach("already-paid-collection", { body: JSON.stringify({ policyId: fixture.policyId, collectionId: fixture.collectionId, responseStatus: result.status(), response: await result.json(), collection: await asset(ctx.bank, "collection", fixture.collectionId) }), contentType: "application/json" });
    expect(result.ok(), "The worker must retire an already-paid queued installment without another debit").toBe(true);
    const collection = await asset(ctx.bank, "collection", fixture.collectionId);
    expect(collection.status).toBe("COMPLETED");
    expect(collection.paymentId).toBe(fixture.intent.paymentId);
    expect(collection.transferId).toBe(fixture.intent.transferId);
    expect(collection.attemptCount).toBe(0);
    expect((await asset(ctx.bank, "account", fixture.sourceAccountId)).balanceMinor).toBe(20000);
    expect((await asset(ctx.bank, "account", fixture.destinationAccountId)).balanceMinor).toBe(10000);
  } finally { await ctx.close(); }
});

test("@alignment-stage-b XGBoost review permits human approval after three votes and one Bank settlement", async ({ baseURL }, info) => {
  test.setTimeout(300000);
  if (!baseURL) throw new Error("baseURL required");
  const ctx = await actors(baseURL), journal: unknown[] = [];
  try {
    const fixture = await claim(ctx, "model-review");
    const optional = await evidence(ctx.holder, fixture.id, `stage-b-optional-${fixture.suffix}`, "MEDICAL_REPORT", `Synthetic optional report ${fixture.suffix}`);
    const current = await failedOracle(ctx, fixture.id);
    const results = await ctx.insurer.get("/api/ledger/oracle-result");
    expect(results.ok(), await results.text()).toBe(true);
    const matching = (await results.json()).result.filter((row: { requestId: string }) => row.requestId === current.id);
    expect(matching.length).toBeGreaterThanOrEqual(2);
    for (const row of matching) expect(row.verificationCode).toMatch(/^XGB_REVIEW:[A-F0-9]{64}$/);
    journal.push({ claimId: fixture.id, request: current, results: matching });
    const pendingReview = { operation: "routeOracleFailureToReview", requestId: current.id, reviewId: `stage-b-unready-${fixture.suffix}`, assignedAuditorIdsJson: panel, approvalThreshold: 3, rejectionThreshold: 2, deadline: new Date(Date.now() + 600000).toISOString() };
    expect((await ctx.insurer.post("/api/workflows", { data: pendingReview })).status()).toBe(409);
    const opened = await review(ctx, fixture.id, current.id, [fixture.document, optional]);
    await ctx.holder.dispose();
    for (const document of [fixture.document, optional]) {
      const downloaded = await ctx.auditors[0].post(`/api/evidence/${document.id}`);
      expect(downloaded.ok(), await downloaded.text()).toBe(true);
      expect(await decryptEvidenceBytes(new Uint8Array(await downloaded.body()), document.passphrase, { claimId: fixture.id, evidenceId: document.id })).toEqual(document.plaintext);
    }
    for (let n = 0; n < 2; n++) await vote(ctx, opened.id, n, "APPROVE");
    expect((await asset(ctx.insurer, "review", opened.id)).status).toBe("OPEN");
    expect((await asset(ctx.insurer, "claim", fixture.id)).status).toBe("UNDER_REVIEW");
    await vote(ctx, opened.id, 2, "APPROVE");
    expect((await asset(ctx.insurer, "claim", fixture.id)).status).toBe("APPROVED");
    expect((await ctx.auditors[3].post("/api/workflows", { data: { operation: "recordAuditorDecision", reviewId: opened.id, decisionId: `stage-b-late-${fixture.suffix}`, outcome: "REJECT", reasonHash: sha("late") } })).status()).toBe(409);
    const sourceAccountId = `stage-b-source-${fixture.suffix}`, destinationAccountId = `stage-b-dest-${fixture.suffix}`;
    for (const [id, ownerId, accountType, openingBalanceMinor] of [[sourceAccountId, "insurer", "INSURER", 50000], [destinationAccountId, "policyholder1", "CUSTOMER", 0]]) await send(ctx.bank, { operation: "openBankAccount", id, bankId: "bank-demo", ownerId, accountType, accountLabel: "Synthetic stage-b", maskedAccount: "**** 5678", accountTokenHash: sha(String(id)), openingBalanceMinor });
    const settlementId = `stage-b-settlement-${fixture.suffix}`;
    await send(ctx.insurer, { operation: "authorizeSettlement", settlementId, claimId: fixture.id, sourceAccountId, destinationAccountId });
    const payment = { operation: "confirmSettlement", settlementId, transferId: `stage-b-transfer-${fixture.suffix}`, bankReferenceHash: sha(`synthetic transfer ${fixture.suffix}`) };
    expect((await ctx.insurer.post("/api/workflows", { data: payment })).status()).toBe(403);
    await send(ctx.bank, payment);
    expect((await asset(ctx.bank, "account", destinationAccountId)).balanceMinor).toBe(25000);
    expect((await ctx.bank.post("/api/workflows", { data: payment })).status()).toBe(409);
    journal.push({ review: await asset(ctx.insurer, "review", opened.id), settlement: await asset(ctx.bank, "settlement", settlementId) });
  } finally { await info.attach("human-review-journey", { body: JSON.stringify(journal, null, 2), contentType: "application/json" }); await ctx.close(); }
});

test("@alignment-stage-b corrected XGBoost appeal isolates versions, documents, grants and old votes", async ({ baseURL }, info) => {
  test.setTimeout(300000);
  if (!baseURL) throw new Error("baseURL required");
  const ctx = await actors(baseURL), journal: unknown[] = [];
  try {
    const fixture = await claim(ctx, "integrity-negative"), firstRequest = await failedOracle(ctx, fixture.id);
    const initial = await review(ctx, fixture.id, firstRequest.id, [fixture.document]);
    await vote(ctx, initial.id, 0, "REJECT"); await vote(ctx, initial.id, 1, "REJECT");
    const correctedInvoiceId = `stage-b-corrected-${fixture.suffix}`, reference = await invoice(ctx, correctedInvoiceId);
    const correctedText = `Synthetic corrected invoice ${fixture.suffix}`;
    const appealCommand = { operation: "submitClaimAppeal", appealId: `stage-b-appeal-${fixture.suffix}`, claimId: fixture.id, reasonCategory: "AMOUNT_CORRECTION", reasonHash: sha("correction"), descriptionHash: sha("appeal"), evidenceHash: sha(new TextEncoder().encode(correctedText)), proposedHospitalId: "hospital-demo", proposedAmountMinor: 25000, proposedIncidentDate: today, proposedDescriptionHash: sha("corrected description"), proposedClinicalReferenceHash: reference };
    const appeal = await send(ctx.holder, appealCommand);
    expect((await ctx.holder.post("/api/workflows", { data: appealCommand })).status()).toBe(409);
    expect((await asset(ctx.holder, "claim", fixture.id)).version).toBe(2);
    expect((await ctx.insurer.post("/api/workflows", { data: { operation: "startClaimProcessing", claimId: fixture.id } })).status()).toBe(409);
    const corrected = await evidence(ctx.holder, fixture.id, `stage-b-v2-${fixture.suffix}`, "APPEAL_DOCUMENT", correctedText);
    expect((await asset(ctx.holder, "evidence", fixture.document.id)).claimVersion).toBe(1);
    expect((await asset(ctx.holder, "evidence", corrected.id)).claimVersion).toBe(2);
    expect((await ctx.auditors[0].post(`/api/evidence/${corrected.id}`, { data: { grantId: initial.grants[0] } })).status()).toBe(403);
    expect((await ctx.auditors[2].post("/api/workflows", { data: { operation: "recordAuditorDecision", reviewId: initial.id, decisionId: `stage-b-stale-${fixture.suffix}`, outcome: "APPROVE", reasonHash: sha("stale vote") } })).status()).toBe(409);
    const second = await processing(ctx, fixture.id);
    expect(second.id).not.toBe(firstRequest.id);
    expect(second.claimVersion).toBe(2);
    expect(second.appealCommitmentHash).toBe(appeal.commitmentHash);
    await expect.poll(async () => (await asset(ctx.holder, "claim", fixture.id)).status, { timeout: 180000, intervals: [1500] }).toBe("APPROVED");
    const finalClaim = await asset(ctx.holder, "claim", fixture.id), finalAppeal = await asset(ctx.holder, "appeal", appeal.id);
    expect(finalClaim.appealCount).toBe(1);
    expect(finalClaim.hospitalInvoiceId).toBe(correctedInvoiceId);
    expect(finalAppeal.status).toBe("OVERTURNED");
    expect((await asset(ctx.insurer, "review", initial.id)).status).toBe("REJECTED");
    journal.push({ firstRequest, initialReview: initial.id, finalRequest: await asset(ctx.insurer, "oracle-request", second.id), finalClaim, finalAppeal });
  } finally { await info.attach("appeal-version-journey", { body: JSON.stringify(journal, null, 2), contentType: "application/json" }); await ctx.close(); }
});

test("@alignment-stage-b insufficient human review quorum rejects only after the real deadline", async ({ baseURL }, info) => {
  test.setTimeout(300000);
  if (!baseURL) throw new Error("baseURL required");
  const ctx = await actors(baseURL);
  try {
    const fixture = await claim(ctx, "model-review"), current = await failedOracle(ctx, fixture.id);
    const opened = await review(ctx, fixture.id, current.id, [fixture.document], 35);
    await vote(ctx, opened.id, 0, "APPROVE");
    const finalize = { operation: "finalizeExpiredReview", reviewId: opened.id };
    expect((await ctx.insurer.post("/api/workflows", { data: finalize })).status()).toBe(409);
    expect((await asset(ctx.holder, "claim", fixture.id)).status).toBe("UNDER_REVIEW");
    await expect.poll(() => Date.now() > Date.parse(opened.deadline) + 1000, { timeout: 60000, intervals: [1000] }).toBe(true);
    await send(ctx.insurer, finalize);
    expect((await asset(ctx.holder, "claim", fixture.id)).status).toBe("REJECTED");
    const finalReview = await asset(ctx.insurer, "review", opened.id);
    expect(finalReview.status).toBe("TIMED_OUT");
    expect(finalReview.votesCast).toBe(1);
    await info.attach("review-expiry", { body: JSON.stringify(finalReview), contentType: "application/json" });
  } finally { await ctx.close(); }
});
