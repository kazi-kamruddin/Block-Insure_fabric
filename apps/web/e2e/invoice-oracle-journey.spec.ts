import { createHash } from "node:crypto";
import { expect, request, test, type APIRequestContext } from "@playwright/test";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const coverageEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 366 * 86_400_000).toISOString().slice(0, 10);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
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

test("hospital invoice reaches Oracle consensus and a partial claim succeeds", async ({ baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const hospital = await actor(baseURL, "hospital-officer");
  const holder = await actor(baseURL, "policyholder-1");
  try {
    const policyId = `workflow-policy-${id}`;
    const invoiceId = `workflow-invoice-${id}`;
    const claimId = `workflow-claim-${id}`;
    await send(insurer, { operation: "issuePolicy", id: policyId, packageId: "showcase-health-v1", policyholderId: "policyholder1", startDate: today, endDate: coverageEnd });
    const invoice = await send(hospital, { operation: "createHospitalInvoice", id: invoiceId, patientReferenceHash: sha("policyholder1"), invoiceReferenceHash: sha(invoiceId), treatmentHash: sha("hospital treatment"), amountMinor: 50000, admissionDate: today, dischargeDate: today, status: "FINALIZED" });
    expect(invoice.invoice.privacyCredentialId).toMatch(/^invoice-credential-/);
    expect((await asset(hospital, "hospital-invoice", invoiceId)).status).toBe("FINALIZED");
    await send(holder, { operation: "submitClaim", id: claimId, policyId, hospitalId: "hospital-demo", hospitalInvoiceId: invoiceId, amountMinor: 25000, incidentDate: today, descriptionHash: sha("my own narrative") });
    const requestRecord = await send(insurer, { operation: "startClaimProcessing", claimId });
    expect(requestRecord.hospitalVerificationId).toMatch(/^oracle-invoice-/);
    expect((await asset(insurer, "verification", requestRecord.hospitalVerificationId)).outcome).toBe("SOURCE_BOUND");
    await waitFor(holder, claimId, "APPROVED");
    expect((await asset(insurer, "oracle-request", requestRecord.id)).verifiedResult).toBe(true);
  } finally {
    await Promise.all([insurer.dispose(), hospital.dispose(), holder.dispose()]);
  }
});

test("an over-invoice claim receives Oracle failure, auditor rejection, and a corrected appeal", async ({ baseURL }) => {
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
