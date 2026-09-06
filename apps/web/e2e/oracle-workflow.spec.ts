import { expect, request, test, type APIRequestContext } from "@playwright/test";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const registryRoot = "c6da6361115c611b091faa9f35836f9f5c8ee0fdbefb6bc0d8cc6fdde571ebcd";
const assignedAuditors = '["auditor1","auditor2","auditor3","auditor4"]';
const oracleScenario = process.env.ORACLE_E2E_SCENARIO ?? "baseline";

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
  await command(insurer, { operation: "createPolicyPackage", id: packageId, name: "Oracle Demonstration Cover", description: "Two-certificate adjudication", premiumMinor: 10_000, coverageLimitMinor: 500_000, termsHash: hashA });
  await command(insurer, { operation: "publishPolicyPackage", id: packageId });
  await command(insurer, { operation: "issuePolicy", id: policyId, packageId, policyholderId: "policyholder1", startDate: "2026-01-01", endDate: "2026-12-31" });
  await command(policyholder, { operation: "submitClaim", id: claimId, policyId, amountMinor: 50_000, incidentDate: "2026-06-15", descriptionHash });
  await command(hospital, { operation: "verifyClaim", claimId, verificationId: `oracle-verification-${suffix}`, outcome: "VERIFIED", clinicalReferenceHash });
  return claimId;
}

async function requestOracle(insurer: APIRequestContext, claimId: string, suffix: string) {
  const requestId = `oracle-request-${suffix}`;
  await command(insurer, {
    operation: "requestOracleVerification", requestId, claimId, snapshotId: "registry-demo-v1",
    modelVersion: "model-v1", modelHash: hashC, assignedOracleIdsJson: '["oracle1","oracle2"]',
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
  await command(insurer, { operation: "authorizeSettlement", settlementId, claimId });
  await command(bank, { operation: "confirmSettlement", settlementId, bankReferenceHash: hashB });
  await waitForClaimStatus(policyholder, claimId, "SETTLED");
  return reviewId;
}

test("two Oracle workers automatically approve an exact valid result and the bank settles it", async ({ baseURL }) => {
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
    expect(oracleRequest.result).toMatchObject({ status: "CONSENSUS", finalizationCode: "EXACT_CONSENSUS", verifiedResult: true, commitmentCount: 2, revealCount: 2, assignedOracleIds: ["oracle1", "oracle2"] });
    const commitments = await (await insurer.get("/api/ledger/oracle-commitment")).json();
    const results = await (await insurer.get("/api/ledger/oracle-result")).json();
    expect(commitments.result.filter((item: { requestId: string }) => item.requestId === requestId)).toHaveLength(2);
    expect(results.result.filter((item: { requestId: string }) => item.requestId === requestId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ oracleId: "oracle1", verified: true }),
      expect.objectContaining({ oracleId: "oracle2", verified: true }),
    ]));

    const settlementId = `oracle-settlement-${suffix}`;
    await command(insurer, { operation: "authorizeSettlement", settlementId, claimId });
    await command(bank, { operation: "confirmSettlement", settlementId, bankReferenceHash: hashB });
    await waitForClaimStatus(policyholder, claimId, "SETTLED");

    const dossier = await (await insurer.get(`/api/audit/claims/${claimId}`)).json();
    expect(dossier).toMatchObject({ schemaVersion: 4, claim: { status: "SETTLED", oracleOutcome: "EXACT_CONSENSUS" }, settlement: { status: "CONFIRMED" } });
    expect(dossier.oracleRequests).toEqual(expect.arrayContaining([expect.objectContaining({ id: requestId, registrySnapshotId: "registry-demo-v1", modelVersion: "model-v1" })]));
    expect(dossier.oracleCommitments).toHaveLength(2);
    expect(dossier.oracleResults).toHaveLength(2);
    const health = await insurer.get("/api/operations/oracles");
    expect(health.ok(), await health.text()).toBe(true);
    expect((await health.json()).workers).toEqual(expect.arrayContaining([
      expect.objectContaining({ oracleId: "oracle1" }), expect.objectContaining({ oracleId: "oracle2" }),
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
    expect(failed.result).toMatchObject({ status: "FAILED", finalizationCode: "NEGATIVE_RESULT", verifiedResult: false, commitmentCount: 2, revealCount: 2 });

    const reviewId = await settleThroughAuditorFallback(insurer, policyholder, bank, auditors, claimId, requestId, suffix);

    const dossier = await (await insurer.get(`/api/audit/claims/${claimId}`)).json();
    expect(dossier.claim).toMatchObject({ status: "SETTLED", oracleOutcome: "NEGATIVE_RESULT" });
    expect(dossier.reviewRounds).toEqual(expect.arrayContaining([expect.objectContaining({ id: reviewId, status: "APPROVED", kind: "INITIAL", votesCast: 3 })]));
    expect(dossier.oracleResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ oracleId: "oracle1", verified: false, verificationCode: "RECORD_INVALID" }),
      expect.objectContaining({ oracleId: "oracle2", verified: false, verificationCode: "RECORD_INVALID" }),
    ]));
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose(), bank.dispose(), ...auditors.map((item) => item.dispose())]);
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
    expect(failed.result).toMatchObject({ status: "FAILED", finalizationCode: "CONFLICT", commitmentCount: 2, revealCount: 2 });
    const results = await (await insurer.get("/api/ledger/oracle-result")).json();
    expect(results.result.filter((item: { requestId: string }) => item.requestId === requestId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ oracleId: "oracle1", verified: true, verificationCode: "VERIFIED" }),
      expect.objectContaining({ oracleId: "oracle2", verified: false, verificationCode: "REGISTRY_ROOT_MISMATCH" }),
    ]));
    const reviewId = await settleThroughAuditorFallback(insurer, policyholder, bank, auditors, claimId, requestId, suffix);
    const dossier = await (await insurer.get(`/api/audit/claims/${claimId}`)).json();
    expect(dossier.claim).toMatchObject({ status: "SETTLED", oracleOutcome: "CONFLICT" });
    expect(dossier.reviewRounds).toEqual(expect.arrayContaining([expect.objectContaining({ id: reviewId, status: "APPROVED", votesCast: 3 })]));
  } finally {
    await Promise.all([insurer.dispose(), policyholder.dispose(), hospital.dispose(), bank.dispose(), ...auditors.map((item) => item.dispose())]);
  }
});

test("@oracle-timeout unavailable Oracle 2 times out and falls back to auditor governance", async ({ baseURL }) => {
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
      modelVersion: "model-v1", modelHash: hashC, assignedOracleIdsJson: '["oracle1","oracle2"]',
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
