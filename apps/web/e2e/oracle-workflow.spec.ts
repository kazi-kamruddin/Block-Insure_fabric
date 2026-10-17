import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { createHash } from "node:crypto";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const registryRoot = "c6da6361115c611b091faa9f35836f9f5c8ee0fdbefb6bc0d8cc6fdde571ebcd";
const assignedAuditors = '["auditor1","auditor2","auditor3","auditor4"]';
const oracleScenario = process.env.ORACLE_E2E_SCENARIO ?? "baseline";

test.beforeEach(() => {
  test.skip(process.env.FABRIC_CHANNEL_NAME?.startsWith("insurance-workflow-") === true, "Historical Oracle fixture cases run on the Phase 2 channel; schema-15 invoice cases use invoice-oracle-journey.spec.ts.");
});

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

async function ensureRegistry(insurer: APIRequestContext) {
  const existing = await insurer.get("/api/ledger/oracle-snapshot/registry-demo-v1");
  if (existing.ok()) return;
  await command(insurer, {
    operation: "publishOracleRegistrySnapshot", id: "registry-demo-v1", version: 1,
    rootHash: registryRoot, rulesVersion: "rules-v1", rulesHash: hashA, recordCount: 3,
  });
}

async function createHospitalVerifiedClaim(
  insurer: APIRequestContext,
  policyholder: APIRequestContext,
  hospital: APIRequestContext,
  suffix: string,
  descriptionHash: string,
  clinicalReferenceHash: string,
) {
  const packageId = `oracle-package-${suffix}`;
  const policyId = `oracle-policy-${suffix}`;
  const claimId = `oracle-claim-${suffix}`;
  const invoiceId = `oracle-invoice-${suffix}`;
  await command(insurer, { operation: "createPolicyPackage", id: packageId, name: "Oracle Demonstration Cover", description: "Threshold Oracle adjudication", premiumMinor: 10_000, coverageLimitMinor: 500_000, termsHash: hashA });
  await command(insurer, { operation: "configurePolicyPackagePartners", id: packageId, hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
  await command(insurer, { operation: "publishPolicyPackage", id: packageId });
  await command(insurer, { operation: "issuePolicy", id: policyId, packageId, policyholderId: "policyholder1", startDate: "2026-01-01", endDate: "2026-12-31" });
  await command(hospital, { operation: "createHospitalInvoice", id: invoiceId, patientReferenceHash: hashA, invoiceReferenceHash: clinicalReferenceHash, treatmentHash: hashB, amountMinor: 50_000, admissionDate: "2026-06-10", dischargeDate: "2026-06-20", status: "FINALIZED" });
  const credentialExpiry = new Date(Date.now() + 86_400_000).toISOString();
  const invoiceCredentialId = `oracle-invoice-credential-${suffix}`;
  const policyCredentialId = `oracle-policy-credential-${suffix}`;
  await command(hospital, { operation: "issueInvoicePrivacyCredential", id: invoiceCredentialId, invoiceId, expiresAt: credentialExpiry });
  await command(insurer, { operation: "issuePolicyPrivacyCredential", id: policyCredentialId, policyId, expiresAt: credentialExpiry });
  await command(policyholder, { operation: "submitClaim", id: claimId, policyId, hospitalId: "hospital-demo", hospitalInvoiceId: invoiceId, amountMinor: 50_000, incidentDate: "2026-06-15", descriptionHash });
  await command(insurer, { operation: "crossCheckClaimInvoice", claimId, verificationId: `oracle-verification-${suffix}` });
  await command(policyholder, {
    operation: "registerClaimPrivacyPresentation", id: `oracle-presentation-${suffix}`, claimId,
    invoiceCredentialId, policyCredentialId, challenge: `oracle-challenge-${suffix}`,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  return claimId;
}

async function requestOracle(insurer: APIRequestContext, claimId: string, suffix: string) {
  const requestId = `oracle-request-${suffix}`;
  await command(insurer, {
    operation: "requestOracleVerification", requestId, claimId, snapshotId: "registry-demo-v1",
    modelVersion: "model-v1", modelHash: hashC, assignedOracleIdsJson: '["oracle1","oracle2","oracle3"]', requiredConfirmations: 2,
    commitDeadline: new Date(Date.now() + 60_000).toISOString(),
    revealDeadline: new Date(Date.now() + 120_000).toISOString(),
  });
  return requestId;
}

async function waitForClaimStatus(context: APIRequestContext, claimId: string, status: string) {
  await expect.poll(async () => {
    const response = await context.get(`/api/ledger/claim/${claimId}`);
    if (!response.ok()) return `HTTP_${response.status()}`;
    return (await response.json()).result.status;
  }, { timeout: 90_000, intervals: [500, 1_000, 2_000] }).toBe(status);
}

async function createFundedSettlementAccount(bank: APIRequestContext, suffix: string) {
  const accountId = `oracle-insurer-account-${suffix}`;
  await command(bank, {
    operation: "openBankAccount", id: accountId, bankId: "bank-demo", ownerId: "insurer",
    accountType: "INSURER", accountLabel: "Oracle scenario reserve", maskedAccount: "**** **** 9002",
    accountTokenHash: createHash("sha256").update(`oracle-insurer-vault-${suffix}`).digest("hex"),
    openingBalanceMinor: 200_000,
  });
  return accountId;
}

async function settleThroughAuditorFallback(
  insurer: APIRequestContext,
  policyholder: APIRequestContext,
  bank: APIRequestContext,
  auditors: APIRequestContext[],
  claimId: string,
  requestId: string,
  suffix: string,
) {
  const reviewId = `oracle-fallback-review-${suffix}`;
  await command(insurer, { operation: "routeOracleFailureToReview", requestId, reviewId, assignedAuditorIdsJson: assignedAuditors, approvalThreshold: 3, rejectionThreshold: 2, deadline: new Date(Date.now() + 3 * 86_400_000).toISOString() });
  for (let index = 0; index < auditors.length; index += 1) {
    await command(auditors[index], { operation: "recordAuditorDecision", reviewId, decisionId: `oracle-fallback-decision-${index + 1}-${suffix}`, outcome: "APPROVE", reasonHash: hashA });
  }
  await waitForClaimStatus(policyholder, claimId, "APPROVED");
  const settlementId = `oracle-fallback-settlement-${suffix}`;
  const sourceAccountId = await createFundedSettlementAccount(bank, suffix);
  await command(insurer, { operation: "authorizeSettlement", settlementId, claimId, sourceAccountId, destinationAccountId: "showcase-customer-account" });
  const bankReferenceHash = createHash("sha256").update(`fallback-settlement-${suffix}`).digest("hex");
  await command(bank, { operation: "confirmSettlement", settlementId, transferId: `payout-${settlementId}`, bankReferenceHash });
  await waitForClaimStatus(policyholder, claimId, "SETTLED");
  return reviewId;
}

test("a 2-of-3 Oracle quorum automatically approves an exact valid result and the bank settles it", async ({ baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const suffix = `success-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  const bank = await actor(baseURL, "bank-officer");
  try {
    await ensureRegistry(insurer);
    const claimId = await createHospitalVerifiedClaim(insurer, policyholder, hospital, suffix, hashA, "1".repeat(64));
    const requestId = await requestOracle(insurer, claimId, suffix);
    await waitForClaimStatus(policyholder, claimId, "APPROVED");

    const oracleRequest = await (await insurer.get(`/api/ledger/oracle-request/${requestId}`)).json();
    expect(oracleRequest.result).toMatchObject({ status: "CONSENSUS", finalizationCode: "EXACT_CONSENSUS", verifiedResult: true, assignedOracleIds: ["oracle1", "oracle2", "oracle3"], requiredConfirmations: 2, privacyProtocolVersion: "block-insure-selective-disclosure-v1" });
    expect(oracleRequest.result.privacyPresentationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(oracleRequest.result.commitmentCount).toBeGreaterThanOrEqual(2);
    expect(oracleRequest.result.revealCount).toBeGreaterThanOrEqual(2);
    const commitments = await (await insurer.get("/api/ledger/oracle-commitment")).json();
    const results = await (await insurer.get("/api/ledger/oracle-result")).json();
    expect(commitments.result.filter((item: { requestId: string }) => item.requestId === requestId).length).toBeGreaterThanOrEqual(2);
    const requestResults = results.result.filter((item: { requestId: string }) => item.requestId === requestId);
    expect(requestResults.length).toBeGreaterThanOrEqual(2);
    expect(requestResults.every((item: { verified: boolean }) => item.verified)).toBe(true);

    const settlementId = `oracle-settlement-${suffix}`;
    const sourceAccountId = await createFundedSettlementAccount(bank, suffix);
    await command(insurer, { operation: "authorizeSettlement", settlementId, claimId, sourceAccountId, destinationAccountId: "showcase-customer-account" });
    const bankReferenceHash = createHash("sha256").update(`oracle-settlement-${suffix}`).digest("hex");
    await command(bank, { operation: "confirmSettlement", settlementId, transferId: `payout-${settlementId}`, bankReferenceHash });
    await waitForClaimStatus(policyholder, claimId, "SETTLED");

    const dossier = await (await insurer.get(`/api/audit/claims/${claimId}`)).json();
    expect(dossier).toMatchObject({ schemaVersion: 6, claim: { status: "SETTLED", oracleOutcome: "EXACT_CONSENSUS" }, settlement: { status: "CONFIRMED" } });
    expect(dossier.oracleRequests).toEqual(expect.arrayContaining([expect.objectContaining({ id: requestId, registrySnapshotId: "registry-demo-v1", modelVersion: "model-v1" })]));
    expect(dossier.oracleCommitments.length).toBeGreaterThanOrEqual(2);
    expect(dossier.oracleResults.length).toBeGreaterThanOrEqual(2);
    const health = await insurer.get("/api/operations/oracles");
    expect(health.ok(), await health.text()).toBe(true);
    expect((await health.json()).workers).toEqual(expect.arrayContaining([
      expect.objectContaining({ oracleId: "oracle1" }), expect.objectContaining({ oracleId: "oracle2" }), expect.objectContaining({ oracleId: "oracle3" }),
    ]));
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose(), bank.dispose()]);
  }
});

test("matching negative Oracle results fall back to fixed four-auditor governance", async ({ baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const suffix = `negative-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  const bank = await actor(baseURL, "bank-officer");
  const auditors = await Promise.all(["auditor", "auditor-2", "auditor-3"].map((id) => actor(baseURL, id)));
  try {
    await ensureRegistry(insurer);
    const claimId = await createHospitalVerifiedClaim(insurer, policyholder, hospital, suffix, hashB, "2".repeat(64));
    const requestId = await requestOracle(insurer, claimId, suffix);
    await waitForClaimStatus(policyholder, claimId, "ORACLE_FAILED");
    const failed = await (await insurer.get(`/api/ledger/oracle-request/${requestId}`)).json();
    expect(failed.result).toMatchObject({ status: "FAILED", finalizationCode: "NEGATIVE_RESULT", verifiedResult: false, requiredConfirmations: 2 });
    expect(failed.result.commitmentCount).toBeGreaterThanOrEqual(2);
    expect(failed.result.revealCount).toBeGreaterThanOrEqual(2);

    const reviewId = await settleThroughAuditorFallback(insurer, policyholder, bank, auditors, claimId, requestId, suffix);

    const dossier = await (await insurer.get(`/api/audit/claims/${claimId}`)).json();
    expect(dossier.claim).toMatchObject({ status: "SETTLED", oracleOutcome: "NEGATIVE_RESULT" });
    expect(dossier.reviewRounds).toEqual(expect.arrayContaining([expect.objectContaining({ id: reviewId, status: "APPROVED", kind: "INITIAL", votesCast: 3 })]));
    expect(dossier.oracleResults.length).toBeGreaterThanOrEqual(2);
    expect(dossier.oracleResults.every((item: { verified: boolean; verificationCode: string }) => !item.verified && item.verificationCode === "RECORD_INVALID")).toBe(true);
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose(), bank.dispose(), ...auditors.map((item) => item.dispose())]);
  }
});

test("a revoked credential invalidates an already registered presentation for new Oracle requests", async ({ baseURL }) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const suffix = `revoked-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  try {
    await ensureRegistry(insurer);
    const claimId = await createHospitalVerifiedClaim(insurer, policyholder, hospital, suffix, hashA, "1".repeat(64));
    const presentationId = `oracle-presentation-${suffix}`;
    const before = await (await policyholder.get(`/api/ledger/privacy-presentation/${presentationId}`)).json();
    expect(before.result.status).toBe("VERIFIED");
    await command(hospital, { operation: "revokeInvoicePrivacyCredential", id: `oracle-invoice-credential-${suffix}` });
    const revoked = await (await hospital.get(`/api/ledger/privacy-credential/oracle-invoice-credential-${suffix}`)).json();
    expect(revoked.result.status).toBe("REVOKED");
    const blocked = await insurer.post("/api/workflows", { data: {
      operation: "requestOracleVerification", requestId: `oracle-request-${suffix}`, claimId,
      snapshotId: "registry-demo-v1", modelVersion: "model-v1", modelHash: hashC,
      assignedOracleIdsJson: '["oracle1","oracle2","oracle3"]', requiredConfirmations: 2,
      commitDeadline: new Date(Date.now() + 60_000).toISOString(),
      revealDeadline: new Date(Date.now() + 120_000).toISOString(),
    } });
    expect(blocked.status(), await blocked.text()).toBe(409);
    const after = await (await policyholder.get(`/api/ledger/privacy-presentation/${presentationId}`)).json();
    expect(after.result.status).toBe("VERIFIED"); // Historical registration remains an audit fact.
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose()]);
  }
});

test("an insufficient settlement balance records a bounce and can be retried after funding", async ({ baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const suffix = `settlement-retry-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  const bank = await actor(baseURL, "bank-officer");
  try {
    await ensureRegistry(insurer);
    const claimId = await createHospitalVerifiedClaim(insurer, policyholder, hospital, suffix, hashA, "1".repeat(64));
    await requestOracle(insurer, claimId, suffix);
    await waitForClaimStatus(policyholder, claimId, "APPROVED");
    const sourceAccountId = `oracle-insurer-account-${suffix}`;
    await command(bank, {
      operation: "openBankAccount", id: sourceAccountId, bankId: "bank-demo", ownerId: "insurer",
      accountType: "INSURER", accountLabel: "Settlement retry reserve", maskedAccount: "**** **** 9002",
      accountTokenHash: createHash("sha256").update(`oracle-insurer-vault-${suffix}`).digest("hex"), openingBalanceMinor: 10_000,
    });
    const settlementId = `oracle-settlement-${suffix}`;
    await command(insurer, { operation: "authorizeSettlement", settlementId, claimId, sourceAccountId, destinationAccountId: "showcase-customer-account" });
    await command(bank, { operation: "confirmSettlement", settlementId, transferId: `payout-failed-${suffix}`, bankReferenceHash: createHash("sha256").update(`failed-${suffix}`).digest("hex") });
    const failed = await (await insurer.get(`/api/ledger/settlement/${settlementId}`)).json();
    expect(failed.result).toMatchObject({ status: "PAYMENT_FAILED", failureCode: "INSUFFICIENT_FUNDS" });
    await waitForClaimStatus(policyholder, claimId, "SETTLEMENT_AUTHORIZED");
    await command(bank, { operation: "adjustBankAccountBalance", transferId: `fund-retry-${suffix}`, accountId: sourceAccountId,
      direction: "CREDIT", amountMinor: 50_000, externalReferenceHash: createHash("sha256").update(`fund-retry-${suffix}`).digest("hex") });
    await command(bank, { operation: "confirmSettlement", settlementId, transferId: `payout-retry-${suffix}`, bankReferenceHash: createHash("sha256").update(`retry-${suffix}`).digest("hex") });
    await waitForClaimStatus(policyholder, claimId, "SETTLED");
    const settled = await (await insurer.get(`/api/ledger/settlement/${settlementId}`)).json();
    expect(settled.result).toMatchObject({ status: "CONFIRMED", transferId: `payout-retry-${suffix}`, failureCode: "" });
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose(), bank.dispose()]);
  }
});

test("@oracle-majority-wrong two workers sharing a divergent source can reject a valid synthetic claim", async ({ baseURL }) => {
  test.skip(oracleScenario !== "majority-wrong", "requires two workers with the same divergent source");
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const suffix = `majority-wrong-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  try {
    await ensureRegistry(insurer);
    const claimId = await createHospitalVerifiedClaim(insurer, policyholder, hospital, suffix, hashA, "1".repeat(64));
    const requestId = await requestOracle(insurer, claimId, suffix);
    await waitForClaimStatus(policyholder, claimId, "ORACLE_FAILED");
    const oracleRequest = await (await insurer.get(`/api/ledger/oracle-request/${requestId}`)).json();
    expect(oracleRequest.result).toMatchObject({ status: "FAILED", finalizationCode: "NEGATIVE_RESULT", verifiedResult: false, requiredConfirmations: 2 });
    const results = await (await insurer.get("/api/ledger/oracle-result")).json();
    const requestResults = results.result.filter((item: { requestId: string }) => item.requestId === requestId);
    expect(requestResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ oracleId: "oracle2", verified: false, verificationCode: "REGISTRY_ROOT_MISMATCH" }),
      expect.objectContaining({ oracleId: "oracle3", verified: false, verificationCode: "REGISTRY_ROOT_MISMATCH" }),
    ]));
    expect(requestResults.filter((item: { verificationCode: string }) => item.verificationCode === "REGISTRY_ROOT_MISMATCH").length).toBe(2);
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose()]);
  }
});

test("@oracle-common-source an anchored but externally mislabelled source can yield automatic approval", async ({ baseURL }) => {
  test.skip(oracleScenario !== "common-source", "requires the common-source counterexample profile");
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const suffix = `common-source-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  try {
    await ensureRegistry(insurer);
    // This external INVALID label is a synthetic test premise, not a clinical finding.
    const externalTruth = { lookupHash: "1".repeat(64), status: "INVALID" };
    const claimId = await createHospitalVerifiedClaim(insurer, policyholder, hospital, suffix, hashA, externalTruth.lookupHash);
    const requestId = await requestOracle(insurer, claimId, suffix);
    await waitForClaimStatus(policyholder, claimId, "APPROVED");
    const oracleRequest = await (await insurer.get(`/api/ledger/oracle-request/${requestId}`)).json();
    expect(oracleRequest.result).toMatchObject({ status: "CONSENSUS", finalizationCode: "EXACT_CONSENSUS", verifiedResult: true });
    expect(externalTruth.status).toBe("INVALID");
    const results = await (await insurer.get("/api/ledger/oracle-result")).json();
    expect(results.result.filter((item: { requestId: string }) => item.requestId === requestId).filter((item: { verified: boolean }) => item.verified).length).toBeGreaterThanOrEqual(2);
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose()]);
  }
});

test("@oracle-one-unavailable a 2-of-3 quorum succeeds while one Oracle is unavailable", async ({ baseURL }) => {
  test.skip(oracleScenario !== "one-unavailable", "requires the isolated two-worker availability profile");
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const suffix = `available-quorum-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  try {
    await ensureRegistry(insurer);
    const claimId = await createHospitalVerifiedClaim(insurer, policyholder, hospital, suffix, hashA, "1".repeat(64));
    const requestId = `oracle-request-${suffix}`;
    await command(insurer, {
      operation: "requestOracleVerification", requestId, claimId, snapshotId: "registry-demo-v1",
      modelVersion: "model-v1", modelHash: hashC, assignedOracleIdsJson: '["oracle1","oracle2","oracle3"]', requiredConfirmations: 2,
      commitDeadline: new Date(Date.now() + 20_000).toISOString(),
      revealDeadline: new Date(Date.now() + 60_000).toISOString(),
    });
    await waitForClaimStatus(policyholder, claimId, "APPROVED");
    const oracleRequest = await (await insurer.get(`/api/ledger/oracle-request/${requestId}`)).json();
    expect(oracleRequest.result).toMatchObject({
      status: "CONSENSUS", finalizationCode: "EXACT_CONSENSUS", requiredConfirmations: 2,
      commitmentCount: 2, revealCount: 2, assignedOracleIds: ["oracle1", "oracle2", "oracle3"],
    });
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose()]);
  }
});

test("@oracle-conflict divergent registry snapshots fall back to auditor governance", async ({ baseURL }) => {
  test.skip(oracleScenario !== "conflict", "requires the isolated conflict worker profile");
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const suffix = `conflict-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  const bank = await actor(baseURL, "bank-officer");
  const auditors = await Promise.all(["auditor", "auditor-2", "auditor-3"].map((id) => actor(baseURL, id)));
  try {
    await ensureRegistry(insurer);
    const claimId = await createHospitalVerifiedClaim(insurer, policyholder, hospital, suffix, hashA, "1".repeat(64));
    const requestId = await requestOracle(insurer, claimId, suffix);
    await waitForClaimStatus(policyholder, claimId, "ORACLE_FAILED");
    const failed = await (await insurer.get(`/api/ledger/oracle-request/${requestId}`)).json();
    expect(failed.result).toMatchObject({ status: "FAILED", finalizationCode: "CONFLICT", commitmentCount: 3, revealCount: 3, requiredConfirmations: 2 });
    const results = await (await insurer.get("/api/ledger/oracle-result")).json();
    expect(results.result.filter((item: { requestId: string }) => item.requestId === requestId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ oracleId: "oracle1", verified: true, verificationCode: "VERIFIED" }),
      expect.objectContaining({ oracleId: "oracle2", verified: false, verificationCode: "REGISTRY_ROOT_MISMATCH" }),
      expect.objectContaining({ oracleId: "oracle3", verified: false, verificationCode: "MODEL_VERSION_MISMATCH" }),
    ]));
    const reviewId = await settleThroughAuditorFallback(insurer, policyholder, bank, auditors, claimId, requestId, suffix);
    const dossier = await (await insurer.get(`/api/audit/claims/${claimId}`)).json();
    expect(dossier.claim).toMatchObject({ status: "SETTLED", oracleOutcome: "CONFLICT" });
    expect(dossier.reviewRounds).toEqual(expect.arrayContaining([expect.objectContaining({ id: reviewId, status: "APPROVED", votesCast: 3 })]));
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose(), bank.dispose(), ...auditors.map((item) => item.dispose())]);
  }
});

test("@oracle-timeout loss of Oracle quorum times out and falls back to auditor governance", async ({ baseURL }) => {
  test.skip(oracleScenario !== "timeout", "requires the isolated one-Oracle worker profile");
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const suffix = `timeout-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  const bank = await actor(baseURL, "bank-officer");
  const auditors = await Promise.all(["auditor", "auditor-2", "auditor-3"].map((id) => actor(baseURL, id)));
  try {
    await ensureRegistry(insurer);
    const claimId = await createHospitalVerifiedClaim(insurer, policyholder, hospital, suffix, hashA, "1".repeat(64));
    const requestId = `oracle-request-${suffix}`;
    const revealDeadline = new Date(Date.now() + 15_000);
    await command(insurer, {
      operation: "requestOracleVerification", requestId, claimId, snapshotId: "registry-demo-v1",
      modelVersion: "model-v1", modelHash: hashC, assignedOracleIdsJson: '["oracle1","oracle2","oracle3"]', requiredConfirmations: 2,
      commitDeadline: new Date(Date.now() + 5_000).toISOString(), revealDeadline: revealDeadline.toISOString(),
    });
    await expect.poll(async () => {
      const response = await insurer.get(`/api/ledger/oracle-request/${requestId}`);
      if (!response.ok()) return 0;
      return (await response.json()).result.revealCount;
    }, { timeout: 30_000, intervals: [500, 1_000] }).toBe(1);
    const remaining = revealDeadline.getTime() - Date.now() + 1_500;
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    await command(insurer, { operation: "finalizeOracleTimeout", requestId });
    await waitForClaimStatus(policyholder, claimId, "ORACLE_FAILED");
    const failed = await (await insurer.get(`/api/ledger/oracle-request/${requestId}`)).json();
    expect(failed.result).toMatchObject({ status: "FAILED", finalizationCode: "TIMEOUT", commitmentCount: 1, revealCount: 1 });
    const reviewId = await settleThroughAuditorFallback(insurer, policyholder, bank, auditors, claimId, requestId, suffix);
    const dossier = await (await insurer.get(`/api/audit/claims/${claimId}`)).json();
    expect(dossier.claim).toMatchObject({ status: "SETTLED", oracleOutcome: "TIMEOUT" });
    expect(dossier.reviewRounds).toEqual(expect.arrayContaining([expect.objectContaining({ id: reviewId, status: "APPROVED", votesCast: 3 })]));
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose(), bank.dispose(), ...auditors.map((item) => item.dispose())]);
  }
});
