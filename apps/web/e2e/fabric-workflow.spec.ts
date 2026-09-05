import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { decryptEvidenceBytes, encryptEvidenceBytes } from "../lib/evidence/browser-crypto";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);

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
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const ids = {
    package: `e2e-package-${suffix}`,
    policy: `e2e-policy-${suffix}`,
    claim: `e2e-claim-${suffix}`,
    evidence: `e2e-evidence-${suffix}`,
    verification: `e2e-verification-${suffix}`,
    decision: `e2e-decision-${suffix}`,
    settlement: `e2e-settlement-${suffix}`,
  };

  const insurer = await actor(baseURL, "insurer-admin");
  const policyholder = await actor(baseURL, "policyholder-1");
  const hospital = await actor(baseURL, "hospital-officer");
  const auditor = await actor(baseURL, "auditor");
  const bank = await actor(baseURL, "bank-officer");

  try {
    await command(insurer, {
      operation: "createPolicyPackage", id: ids.package, name: "Browser Regression Plan",
      description: "Playwright multi-organization workflow", premiumMinor: 10_000,
      coverageLimitMinor: 1_000_000, termsHash: hashA,
    });
    await command(insurer, { operation: "publishPolicyPackage", id: ids.package });
    await command(insurer, {
      operation: "issuePolicy", id: ids.policy, packageId: ids.package,
      policyholderId: "policyholder1", startDate: "2026-01-01", endDate: "2026-12-31",
    });
    await command(insurer, { operation: "retirePolicyPackage", id: ids.package });
    await command(policyholder, {
      operation: "submitClaim", id: ids.claim, policyId: ids.policy, amountMinor: 250_000,
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

    const accessLog = await insurer.get("/api/ledger/access");
    expect(accessLog.ok(), await accessLog.text()).toBe(true);
    expect((await accessLog.json()).result.some((item: { evidenceId: string; accessorRole: string }) =>
      item.evidenceId === ids.evidence && item.accessorRole === "policyholder",
    )).toBe(true);

    const hospitalBefore = await hospital.get("/api/dashboard");
    expect((await hospitalBefore.json()).dashboard.queue.some((item: { id: string }) => item.id === ids.claim)).toBe(true);
    await command(hospital, {
      operation: "verifyClaim", claimId: ids.claim, verificationId: ids.verification,
      outcome: "VERIFIED", clinicalReferenceHash: hashC,
    });
    const verification = await policyholder.get(`/api/ledger/verification/${ids.verification}`);
    expect(verification.ok(), await verification.text()).toBe(true);
    expect((await verification.json()).result).toMatchObject({ id: ids.verification, claimId: ids.claim, outcome: "VERIFIED" });
    await command(insurer, { operation: "startClaimReview", claimId: ids.claim });

    const auditorBefore = await auditor.get("/api/dashboard");
    expect((await auditorBefore.json()).dashboard.queue.some((item: { id: string }) => item.id === ids.claim)).toBe(true);
    await command(auditor, {
      operation: "recordAuditorDecision", claimId: ids.claim, decisionId: ids.decision,
      outcome: "APPROVE", reasonHash: hashA,
    });
    const decision = await policyholder.get(`/api/ledger/decision/${ids.decision}`);
    expect(decision.ok(), await decision.text()).toBe(true);
    expect((await decision.json()).result).toMatchObject({ id: ids.decision, claimId: ids.claim, outcome: "APPROVE" });
    await command(insurer, {
      operation: "authorizeSettlement", settlementId: ids.settlement, claimId: ids.claim,
    });

    const bankBefore = await bank.get("/api/dashboard");
    expect((await bankBefore.json()).dashboard.queue.some((item: { id: string }) => item.id === ids.settlement)).toBe(true);
    await command(bank, {
      operation: "confirmSettlement", settlementId: ids.settlement, bankReferenceHash: hashB,
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
      schemaVersion: 1,
      claim: { id: ids.claim, status: "SETTLED" },
      hospitalVerification: { id: ids.verification, outcome: "VERIFIED" },
      auditorDecision: { id: ids.decision, outcome: "APPROVE" },
      settlement: { id: ids.settlement, status: "CONFIRMED" },
    });
    expect(dossier.history.length).toBeGreaterThanOrEqual(6);
    expect(dossier.evidence.some((item: { id: string }) => item.id === ids.evidence)).toBe(true);
    expect(dossier.evidenceAccess.some((item: { evidenceId: string }) => item.evidenceId === ids.evidence)).toBe(true);

    const forbiddenDossier = await bank.get(`/api/audit/claims/${ids.claim}`);
    expect(forbiddenDossier.status()).toBe(403);

    const forbidden = await bank.post("/api/workflows", {
      data: { operation: "startClaimReview", claimId: ids.claim },
    });
    expect(forbidden.status()).toBe(403);
  } finally {
    await Promise.all([
      insurer.dispose(), policyholder.dispose(), hospital.dispose(), auditor.dispose(), bank.dispose(),
    ]);
  }
});
