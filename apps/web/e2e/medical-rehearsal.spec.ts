import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { invoicePDF } from "./invoice-pdf";

const roles = {
  insurer: ["Insurer Administrator", "insurer"],
  hospital: ["Dhaka Central Medical Hospital", "hospital"],
  holder: ["Policyholder One", "policyholder"],
  bank: ["Bangladesh Demo Commercial Bank", "bank"],
  auditor1: ["Independent Auditor One", "auditor"],
  auditor2: ["Independent Auditor Two", "auditor"],
  auditor3: ["Independent Auditor Three", "auditor"],
  auditor4: ["Independent Auditor Four", "auditor"],
} as const;
const demoAccountIDs = {
  insurer: "insurer-admin",
  hospital: "hospital-officer",
  holder: "policyholder-1",
  bank: "bank-officer",
  auditor1: "auditor",
  auditor2: "auditor-2",
  auditor3: "auditor-3",
  auditor4: "auditor-4",
} as const;

const deadlines = process.env.MEDICAL_DEADLINE_LIVE === "true";
const finalPayment = process.env.MEDICAL_FINAL_PAYMENT === "true";
const governed = deadlines || process.env.MEDICAL_REVIEW_LIVE === "true";
const devLite = process.env.FABRIC_CHANNEL_NAME === "insurance-dev-lite-190";
const duplicateOnly = devLite && process.env.DEV_LITE_DUPLICATE_REVIEW === "true";
// Leaves one Insurer-authorized payout for the separate-account Bank signer drill.
const stopBeforeBank = devLite && !finalPayment && process.env.MEDICAL_STOP_BEFORE_BANK === "true";

// Realistic synthetic taka amounts (minor units are poisha). The rehearsal
// package charges BDT 1,250 per 30 days with a BDT 300,000 limit; surgery is
// sublimited to BDT 150,000 with a 10% deductible capped at BDT 5,000 and an
// 80% insurer share. A routine BDT 85,000 stay therefore pays BDT 64,000; the
// out-of-range BDT 190,000 bill pays BDT 116,000 until its appeal corrects it.
const money = { premium: 125_000, coverage: 30_000_000, customerOpening: 2_500_000, reserveOpening: 10_000_000 };
const routineQuote = { billedMinor: 8_500_000, eligibleMinor: 8_500_000, deductibleMinor: 500_000, insurerShareMinor: 6_400_000, payableMinor: 6_400_000 };
const governedQuote = { billedMinor: 19_000_000, eligibleMinor: 15_000_000, deductibleMinor: 500_000, insurerShareMinor: 11_600_000, payableMinor: 11_600_000 };
const payout = routineQuote.payableMinor;
const grouped = new Intl.NumberFormat("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bdt = (minor: number) => "BDT " + grouped.format(minor / 100);
// Categories the frozen model scores in its pooled group, tried in order so a
// routine claim never overlaps an earlier stay claimed the same day. SURGERY is
// left out: its dev-lite benchmark is the immutable BDT 250-750 record from
// earlier sequences, so a realistic surgery bill would always be out of range.
const routineServices = ["INPATIENT", "OTHER", "CONSULTATION"];

function day(offset: number, base?: string) {
  const now = base ? Date.parse(base) : Date.now() + 6 * 3_600_000;
  return new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
}

const journey = duplicateOnly ? "live duplicate referral despite positive Oracle verification, then one Bank payout"
  : deadlines ? "live medical deadlines, single recovery, and PDF and JPEG OCR"
  : finalPayment ? "final medical association, concurrent claim, Oracle absence, payout recovery, and insurer findings"
  : governed ? "live medical clarification, review, appeal and OCR through one Bank payout" : "ordinary medical browser journey through one Bank payout";

test(journey, async ({ page }, info) => {
  test.setTimeout(900_000);
  const health = await page.request.get("/api/fabric/health");
  expect(health.ok(), await health.text()).toBe(true);
  expect(await health.json()).toMatchObject({ channel: process.env.FABRIC_CHANNEL_NAME ?? "insurance-medical-reimbursement", chaincode: "insurance-contract", schemaVersion: 15 });

  const resumeClarification = devLite && governed && !deadlines && process.env.DEV_LITE_RESUME_CLARIFICATION;
  const resumeApprovedAppeal = devLite && governed && !deadlines && process.env.DEV_LITE_RESUME_APPROVED_APPEAL;
  const resumeClaim = resumeClarification || resumeApprovedAppeal || (deadlines ? process.env.MEDICAL_DEADLINE_RESUME_CLAIM : finalPayment ? process.env.MEDICAL_FINAL_RESUME_CLAIM : undefined);
  const intakeCheckpoint: { suffix: string; service: string; episodeId: string; alternateId: string } | undefined =
    devLite && finalPayment && !resumeClaim && process.env.DEV_LITE_RESUME_ROUTINE_INTAKE
      ? JSON.parse(process.env.DEV_LITE_RESUME_ROUTINE_INTAKE) : undefined;
  const resumeSuffix = (resumeClarification || resumeApprovedAppeal) ? process.env.DEV_LITE_RESUME_SUFFIX
    : finalPayment ? process.env.MEDICAL_FINAL_RESUME_SUFFIX : process.env.MEDICAL_DEADLINE_RESUME_SUFFIX;
  if (resumeClaim && !resumeSuffix) throw new Error("Supply the interrupted fixture suffix");
  const suffix = resumeClaim && resumeSuffix ? resumeSuffix : intakeCheckpoint?.suffix ?? randomUUID().slice(0, 12);
  const id = (prefix: string) => "med-" + prefix + "-" + suffix;
  let start = day(0), service = day(0), firstEnd = day(29), end = day(364);
  let medicalService = "SURGERY";
  // A duplicate is the same stay claimed again on the same policy, so that
  // journey reuses the earlier claim's policy instead of buying a new one.
  let policyId = id("policy");
  let reusePolicy = false;
  const journal: unknown[] = [];
  const errors: string[] = [];
  const priorClaimId = process.env.MEDICAL_PRIOR_CLAIM_ID;
  if (duplicateOnly && !priorClaimId) throw new Error("Supply the routine settlement's claim ID");
  let role: keyof typeof roles | undefined;
  page.on("pageerror", error => errors.push(error.message));
  async function login(next: keyof typeof roles) {
    if (role === next) return;
    if (devLite) {
      const response = await page.request.post("/api/auth/demo-login", {
        data: { accountId: demoAccountIDs[next] },
        maxRetries: 2,
      });
      expect(response.ok(), await response.text()).toBe(true);
      await page.goto("/workspace/" + roles[next][1]);
    } else {
      if (role) await page.getByRole("button", { name: "Sign out", exact: true }).click();
      else await page.goto("/workspace");
      await page.getByRole("button", { name: "Sign in as " + roles[next][0], exact: true }).click();
    }
    await expect(page).toHaveURL(new RegExp("/workspace/" + roles[next][1] + "$"), { timeout: 45_000 });
    await expect(page.getByRole("heading", { name: roles[next][0], exact: true })).toBeVisible();
    role = next;
  }

  type Accept = number | ((status: number, body: { message?: string }) => boolean);
  async function postFromButton(button: ReturnType<typeof page.getByRole>, path = "/api/workflows", status: Accept = 200) {
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "POST", { timeout: 150_000 });
    await button.click();
    const response = await pending;
    const body = await response.json();
    journal.push({ actor: role, path, status: response.status(), result: body.result, message: body.message });
    if (typeof status === "number") expect(response.status(), JSON.stringify(body)).toBe(status);
    else expect(status(response.status(), body), JSON.stringify(body)).toBe(true);
    if (path === "/api/workflows" && await button.count()) await expect(button).toBeEnabled({ timeout: 120_000 });
    return body.result;
  }

  async function fillForm(operation: string, input: Record<string, string>) {
    console.log(role + " " + operation);
    const card = page.locator("#guided-workflow");
    if (role !== "hospital") {
      const selector = card.getByLabel("Workflow action");
      if (await selector.inputValue() !== operation) await selector.selectOption(operation);
    }
    for (const [name, value] of Object.entries(input)) {
      const field = card.locator('[name="' + name + '"]');
      await expect(field).toBeVisible();
      if (await field.evaluate(element => element.tagName === "SELECT")) await field.selectOption(value);
      else await field.fill(value);
    }
    return card.getByRole("button", { name: /^(Save intake|Submit verified transaction|Submit bank instruction)$/ });
  }

  async function form(operation: string, input: Record<string, string>, status: Accept = 200) {
    return postFromButton(await fillForm(operation, input), "/api/workflows", status);
  }

  async function assets(type: string) {
    const response = await page.request.get("/api/ledger/" + type);
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).result;
  }

  async function asset(type: string, key: string) {
    const response = await page.request.get("/api/ledger/" + type + "/" + encodeURIComponent(key));
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).result;
  }

  const reviewCard = page.locator("#medical-review");
  const timeline = page.getByRole("region", { name: "Medical claim timeline" });
  async function loadReview(claimId: string) {
    const input = reviewCard.getByLabel("Medical claim ID");
    const loadButton = reviewCard.getByRole("button", { name: "Load medical case" });
    // The server-rendered input may exist before React attaches after a role
    // switch. Only retry the local fill, never a ledger operation.
    await expect(async () => {
      await input.fill(claimId);
      await expect(loadButton).toBeEnabled({ timeout: 1_200 });
    }).toPass({ timeout: 45_000 });
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/medical/review" && response.request().method() === "GET");
    await loadButton.click();
    const response = await pending;
    expect(response.ok(), await response.text()).toBe(true);
    const detail = await response.json();
    await expect(reviewCard.getByText(`Claim version ${detail.claim.version} · ${detail.claim.status}`)).toBeVisible();
    return detail;
  }

  async function reviewAction(name: string, status = 200) {
    console.log(role + " " + name);
    const outcome = await postFromButton(reviewCard.getByRole("button", { name, exact: true }), "/api/medical/review", status);
    if (status === 200) await expect(reviewCard.getByRole("status")).toHaveText("Action confirmed.", { timeout: 80_000 });
    return outcome;
  }

  async function loadBankTimeline(settlementId: string) {
    const card = page.getByRole("article", { name: "Medical settlement timeline" });
    const button = card.getByRole("button", { name: "Load medical settlement" });
    await expect(async () => {
      await card.getByLabel("Medical settlement ID").fill(settlementId);
      await expect(button).toBeEnabled({ timeout: 1_200 });
    }).toPass({ timeout: 45_000 });
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/medical/settlement");
    await button.click();
    const response = await pending;
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }

  async function attestRegistry() {
    if (!devLite) return;
    await login("insurer");
    const registry = page.locator("#medical-registry");
    await registry.getByLabel("Hospital ID").fill("hospital-demo");
    const proposed = await postFromButton(registry.getByRole("button", { name: "Propose registry snapshot" }), "/api/medical/registry");
    await login("hospital");
    await registry.getByRole("button", { name: "Refresh registry proposals" }).click();
    const entry = registry.getByRole("listitem").filter({ hasText: proposed.id + " ·" });
    await expect(entry).toBeVisible({ timeout: 60_000 });
    if (!(await entry.innerText()).includes("ACTIVE")) {
      await postFromButton(entry.getByRole("button", { name: "Attest this snapshot" }), "/api/medical/registry");
    }
    await login("insurer");
  }

  async function freshVerification(claimId: string, version: number, appealId?: string) {
    await attestRegistry();
    const request = await form("startClaimProcessing", { claimId });
    expect(request).toMatchObject({ claimId, claimVersion: version, modelVersion: "fabric-xgb-synthetic-v1", requiredConfirmations: 2, expectedResponses: 3 });
    if (appealId) expect(request).toMatchObject({ appealId });
    await expect.poll(async () => (await asset("claim", claimId)).status, { timeout: 200_000, intervals: [2000] }).toMatch(/^(ORACLE_FAILED|MEDICAL_REVIEW_REQUIRED)$/);
    const results = (await assets("oracle-result") as { requestId: string; verificationCode: string; resultHash: string }[]).filter(result => result.requestId === request.id);
    expect(results.some((result, n) => results.slice(n + 1).some(other => other.resultHash === result.resultHash))).toBe(true);
    journal.push({ request, results });
    return results;
  }

  type FixtureFile = { name: string; mimeType: string; buffer: Buffer };
  const passphrase = "Live-synthetic-document-passphrase";
  async function uploadDocument(claimId: string, evidenceId: string, documentType: string, file: FixtureFile, version: number) {
    const upload = page.locator("article").filter({ has: page.getByRole("heading", { name: "Encrypt, store, and anchor evidence" }) });
    const fields = { "Claim ID": claimId, "Evidence ID": evidenceId, "Document type": documentType, "Evidence passphrase": passphrase, "Confirm passphrase": passphrase };
    for (const [label, value] of Object.entries(fields)) await upload.getByLabel(label, { exact: true }).fill(value);
    await upload.getByLabel("Original file").setInputFiles(file);
    await upload.getByRole("button", { name: "Encrypt in browser" }).click();
    await expect(upload.getByText("Ciphertext ready", { exact: true })).toBeVisible();
    const result = await postFromButton(upload.getByRole("button", { name: "Store ciphertext and record reference" }), "/api/evidence");
    expect(result).toMatchObject({ id: evidenceId, claimId, claimVersion: version, documentType });
  }

  const panel = ["auditor1", "auditor2", "auditor3", "auditor4"] as const;
  async function confirmReviewDocuments(claimId: string, documentIds: string[], ocr: Record<string, string> = {}, version = 2) {
    const retrieval = page.locator("article").filter({ has: page.getByRole("heading", { name: "Retrieve and decrypt evidence" }) });
    for (const auditor of panel) {
      await login(auditor);
      await loadReview(claimId);
      for (const evidenceId of documentIds) {
        await reviewCard.getByRole("listitem").filter({ hasText: evidenceId }).getByRole("button", { name: "Open granted evidence" }).click();
        await retrieval.getByLabel("Evidence passphrase", { exact: true }).fill(passphrase);
        const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/evidence/" + evidenceId);
        await retrieval.getByRole("button", { name: "Retrieve and decrypt" }).click();
        const response = await responsePromise;
        expect(response.status(), response.ok() ? evidenceId : await response.text()).toBe(200);
        await expect(retrieval.getByRole("link", { name: "Download verified plaintext" })).toBeVisible();
        const accessId = response.headers()["x-evidence-access-id"];
        const reviewId = response.headers()["x-evidence-medical-review-id"];
        expect(accessId).toBeTruthy();
        expect(reviewId).toBeTruthy();
        if (auditor === "auditor1" && ocr[evidenceId]) {
          await retrieval.getByRole("button", { name: "Extract invoice fields" }).click();
          await expect(retrieval.getByLabel("Invoice number", { exact: true })).toHaveValue(ocr[evidenceId], { timeout: 90_000 });
          await expect(retrieval.getByLabel("Documented service date")).toHaveValue(service);
          await expect(retrieval.getByLabel("Invoice total in BDT")).toHaveValue("190000.00");
          await retrieval.getByLabel("Invoice total in BDT").fill("190000.01");
          const downloaded = page.waitForEvent("download", { timeout: 120_000 });
          const confirmed = page.waitForResponse(r => new URL(r.url()).pathname === "/api/medical/review" && r.request().method() === "POST");
          await retrieval.getByRole("button", { name: "Confirm fields and download private receipt" }).click();
          const [receipt, confirmation] = await Promise.all([downloaded, confirmed]);
          expect(confirmation.status()).toBe(200);
          const sent = confirmation.request().postDataJSON();
          const source = { evidenceId, sourceHash: response.headers()["x-content-sha256"], engineVersion: "tesseract-7.0.0:eng-4.0.0-best-int" };
          expect(sent).toMatchObject({ action: "recordOCR", accessId, ...source });
          expect(sent.suggestionsHash).not.toBe(sent.confirmedHash);
          expect(receipt.suggestedFilename()).toBe(`ocr-review-${evidenceId}.json`);
          expect(JSON.parse(await readFile(await receipt.path(), "utf8"))).toMatchObject({
            ...source, suggestions: { totalBdt: "190000.00" }, confirmed: { totalBdt: "190000.01" },
          });
          const projectionPath = process.env.MEDICAL_EVENT_PROJECTION_PATH;
          if (projectionPath) {
            const committed = { id: sent.id, claimId, claimVersion: version, confirmedBy: auditor, ...source,
              suggestionsHash: sent.suggestionsHash, confirmedHash: sent.confirmedHash };
            await expect.poll(async () => {
              const projection = JSON.parse(await readFile(projectionPath, "utf8"));
              return projection.events.find((event: { eventName: string; payload: { id: string } }) =>
                event.eventName === "MedicalOCRConfirmed" && event.payload.id === sent.id);
            }, { timeout: 45_000 }).toMatchObject({ payload: committed });
          }
          journal.push({ actor: role, action: "recordOCR", ...source, receiptId: sent.id });
        }
        expect(await postFromButton(retrieval.getByRole("button", { name: "Confirm decryption for this review" }), "/api/medical/review"))
          .toMatchObject({ reviewId, evidenceId, auditorId: auditor, accessId });
      }
      if (auditor === "auditor3") {
        await login("insurer");
        await loadReview(claimId);
        await reviewAction("Open voting for 24 hours", 409);
        await expect(reviewCard.getByRole("status")).toContainText(/confirm decryption/i);
      }
    }
  }

  function hospitalFields(revision: number, billBdt: string) {
    return { episodeReference: id("episode"), expectedRevision: String(revision), patientReference: id("patient"),
      service: medicalService, admissionDate: service, dischargeDate: service, serviceDate: service, billBdt, invoiceDate: service, diagnosisCode: "" };
  }

  try {
    if (devLite && process.env.DEV_LITE_ACTIVATE === "true") {
      await login("insurer");
      await postFromButton(page.getByRole("button", { name: "Activate approval certificates" }), "/api/medical/registry");
    }
    if (governed || finalPayment || duplicateOnly) {
      await login("insurer");
      await expect(reviewCard.getByRole("heading", { name: "Medical review and appeal" })).toBeVisible();
      const episodeServices = async () => {
        const response = await page.request.get("/api/medical/intake");
        expect(response.ok(), await response.text()).toBe(true);
        return new Map(((await response.json()).episodes as { id: string; service: string }[]).map(row => [row.id, row.service]));
      };
      if (priorClaimId) {
        const prior = await asset("claim", priorClaimId);
        expect(prior).toMatchObject({ status: "SETTLED" });
        if (devLite && duplicateOnly) {
          service = prior.incidentDate;
          medicalService = (await episodeServices()).get(prior.episodeId) ?? "SURGERY";
          policyId = prior.policyId;
          reusePolicy = true;
        }
      }
      if (devLite && finalPayment && !resumeClaim && !intakeCheckpoint) {
        // Cover is never backdated, so a routine stay is today's. Choose a
        // category this patient has not claimed today to avoid an overlap.
        const services = await episodeServices();
        const today = day(0);
        const used = new Set((await assets("claim") as { episodeId?: string; claimantId: string; incidentDate: string }[])
          .filter(claim => claim.episodeId && claim.claimantId === "policyholder1" && claim.incidentDate === today)
          .map(claim => services.get(claim.episodeId!)));
        const unused = routineServices.find(candidate => !used.has(candidate));
        if (!unused) throw new Error("Every routine service category already has a claim today; run the routine rehearsal tomorrow");
        medicalService = unused;
        service = today;
      }
    }
    if (intakeCheckpoint) service = intakeCheckpoint.service;
    start = service;
    firstEnd = day(29, service);
    end = day(364, service);
    let claimId = resumeClaim ?? "";
    let episodeId = "";
    if (!resumeClaim && !intakeCheckpoint && !reusePolicy) await test.step("register partners and publish the medical policy", async () => {
      await login("insurer");
      const existing = await assets("partner-agreement") as { partnerId: string; status: string }[];
      for (const [partnerType, partnerId, name] of [
        ["HOSPITAL", "hospital-demo", "Synthetic Hospital"],
        ["BANK", "bank-demo", "Synthetic Bank"],
      ]) {
        if (existing.some(row => row.partnerId === partnerId && row.status === "ACTIVE")) continue;
        await form("createPartnerAgreement", { id: id(partnerId), partnerType, partnerId, name,
          location: "Dhaka", tier: "Preferred", accessScope: "Synthetic rehearsal only", effectiveDate: day(-30), expiryDate: day(365) });
      }
      await form("createPolicyPackage", { id: id("package"), name: "Accident and Emergency Care " + suffix,
        description: "Isolated synthetic reimbursement", premiumBdt: "1250.00", coverageLimitBdt: "300000.00", termsText: id("terms") });
      await form("configurePolicyPackagePartners", { id: id("package"), hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
      // Emergency care has no waiting period, so a stay on the purchase day qualifies.
      await form("configureMedicalRules", { packageId: id("package"), service: medicalService, sublimit: "150000.00",
        deductibleBps: "1000", deductibleCap: "5000.00", shareBps: "8000", waitingDays: "0", filingDays: "30", evidenceRequired: "No" });
      await form("publishPolicyPackage", { id: id("package") });
    });

    if (!resumeClaim && !intakeCheckpoint) await test.step("accept policy terms and pay the first installment with OTP", async () => {
      await login("bank");
      for (const [name, ownerId, accountType, openingBalanceBdt] of [
        ["customer", "policyholder1", "CUSTOMER", "25000.00"],
        ["premium", "insurer", "INSURER", "0.00"],
        ["reserve", "insurer", "INSURER", finalPayment ? "0.00" : "100000.00"],
      ]) await form("openBankAccount", { id: id(name), bankId: "bank-demo", ownerId, accountType,
        accountLabel: "Synthetic medical " + name, maskedAccount: "**** 1234", openingBalanceBdt, accountTokenText: id("token-" + name) });
      if (reusePolicy) {
        await login("insurer");
        expect(await asset("policy", policyId)).toMatchObject({ status: "ACTIVE", medicalRulesVersion: 1 });
        return;
      }
      await login("holder");
      const offer = page.locator("#guided-workflow");
      await offer.getByLabel("Workflow action").selectOption("acquireMedicalPolicy");
      await offer.getByRole("button", { name: "Load published packages" }).click();
      await offer.getByLabel("Medical package").selectOption(id("package"));
      await expect(offer.getByText(bdt(payout) + " is payable", { exact: false })).toBeVisible();
      await offer.getByLabel("I accept these published terms").check();
      const policy = await form("acquireMedicalPolicy", { id: id("policy"), startDate: start, endDate: end });
      expect(policy).toMatchObject({ status: "PENDING_PAYMENT", coverageLimitMinor: money.coverage, medicalRulesVersion: 1, coverStartDate: "" });
      const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Pay with one-time authorization", exact: true }) });
      for (const [label, value] of Object.entries({ "Policy ID": id("policy"), "Customer account ID": id("customer"),
        "Insurer account ID": id("premium"), "Transfer ID": id("otp-transfer"), "Payment ID": id("otp-payment"),
        "Period starts": start, "Period ends": firstEnd, "Premium (BDT)": "1250.00", "External bank receipt": id("otp-reference") })) {
        await card.getByLabel(label, { exact: true }).fill(value);
      }
      await card.getByRole("button", { name: "Email OTP", exact: true }).click();
      const code = card.locator(".evidenceWarning strong");
      await expect(code).toHaveText(/^\d{6}$/);
      await card.getByLabel("Six-digit OTP", { exact: true }).fill((await code.textContent())!);
      await postFromButton(card.getByRole("button", { name: "Authorize premium", exact: true }), "/api/banking/premium-payment");
      expect(await asset("policy", id("policy"))).toMatchObject({ status: "ACTIVE", paidThroughDate: firstEnd, coverStartDate: start });
    });

    if (!resumeClaim) await test.step("intake stays hidden until verified and the quote is pinned to the submitted claim", async () => {
      let alternate;
      if (intakeCheckpoint) {
        await login("insurer");
        expect(await asset("policy", id("policy"))).toMatchObject({ status: "ACTIVE", paidThroughDate: firstEnd });
        const response = await page.request.get("/api/medical/intake");
        expect(response.ok(), await response.text()).toBe(true);
        const { episodes } = await response.json();
        expect(episodes).toContainEqual(expect.objectContaining({ id: intakeCheckpoint.episodeId, revision: 1, serviceDate: service, billMinor: 8_500_000 }));
        expect(episodes).toContainEqual(expect.objectContaining({ id: intakeCheckpoint.alternateId, revision: 1, serviceDate: service, billMinor: 4_500_000 }));
        episodeId = intakeCheckpoint.episodeId;
        alternate = { id: intakeCheckpoint.alternateId };
      } else {
        await login("hospital");
        await expect(page.locator("#guided-workflow").getByLabel("Workflow action")).toHaveCount(0);
        const forbidden = await page.request.post("/api/workflows", { data: { operation: "recordHospitalModelFacts",
          invoiceId: id("hospital-model"), treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: service,
          expectedMinMinor: 1, expectedMaxMinor: 2, licenseStatus: "ACTIVE" } });
        expect(forbidden.status()).toBe(403);
        expect(await forbidden.json()).toMatchObject({ message: "Hospital accounts can only save factual episode intake." });
        episodeId = (await form("saveMedicalEpisode", hospitalFields(0, governed ? "190000.00" : "85000.00"))).id;
        if (finalPayment) {
          alternate = await form("saveMedicalEpisode", { ...hospitalFields(0, "45000.00"),
            episodeReference: id("alternate-episode"), patientReference: id("alternate-patient") });
          const payload = { operation: "saveMedicalEpisode", episodeReferenceHash: "a".repeat(64), expectedRevision: 0,
            patientReferenceHash: "b".repeat(64), service: medicalService, serviceDate: service, admissionDate: service,
            dischargeDate: service, billMinor: 4_500_000, invoiceDate: service, diagnosisCode: "", fraudLabel: true };
          const label = await page.request.post("/api/workflows", { data: payload });
          expect(label.status()).toBe(400);
        }
      }
      const episode = { id: episodeId };
      await login("holder");
      const discovery = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Your medical episodes", exact: true }) });
      await discovery.getByRole("button", { name: "Refresh episodes" }).click();
      await expect(discovery.getByLabel("Verified episode").locator('option[value="' + episode.id + '"]')).toHaveCount(0);
      const idOfPolicy = policyId;
      const rawQuote = (episode: string) => "/api/medical/intake?" + new URLSearchParams({ policy: idOfPolicy, episode, revision: "1" });
      if (finalPayment) {
        const denied = await page.request.get(rawQuote(episode.id));
        expect(denied.status(), await denied.text()).toBe(409);
      }
      await login("insurer");
      const queue = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Episode association queue", exact: true }) });
      const [intake] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === "/api/medical/intake"),
        queue.getByRole("button", { name: "Refresh episodes" }).click(),
      ]);
      expect(intake.ok(), await intake.text()).toBe(true);
      await expect(queue.getByRole("button", { name: "Resolve association" }).first()).toBeVisible({ timeout: 15_000 });
      if (alternate) {
        await form("verifyMedicalAssociation", { episodeId: alternate.id, revision: "1", beneficiaryId: "synthetic-other-patient",
          decisionBasis: id("alternate-clarified-match"), associationDecision: "VERIFY" });
      }
      await form("verifyMedicalAssociation", { episodeId: episode.id, revision: "1", beneficiaryId: "policyholder1",
        decisionBasis: id("verified-synthetic-match"), associationDecision: "VERIFY" });
      const registry = await page.request.get("/api/medical/intake");
      expect(registry.ok()).toBe(true);
      expect((await registry.json()).episodes.find((row: { id: string }) => row.id === episode.id)).toMatchObject({ associationStatus: "VERIFIED" });

      // Each hospital and service has one immutable synthetic benchmark on this
      // channel. This spec always records the same realistic range, so a range
      // an earlier run recorded is reused; any other refusal still fails.
      if (process.env.MEDICAL_BENCHMARK_EXISTS !== "true" || medicalService !== "SURGERY") {
        await form("registerMedicalOracleBenchmark", { hospitalId: "hospital-demo", service: medicalService, minimum: "50000.00", maximum: "120000.00",
          licenseStatus: "ACTIVE", sourceReference: "Synthetic benchmark range for a documented BDT 85,000 " + medicalService.toLowerCase() + " fixture" },
        (status, body) => status === 200 || (status === 409 && /private medicalOracleBenchmark [0-9a-f]{64} already exists/.test(body.message ?? "")));
      }
      await login("holder");
      await discovery.getByRole("button", { name: "Refresh episodes" }).click();
      await discovery.getByLabel("Medical policy").selectOption(policyId);
      await discovery.getByLabel("Verified episode").selectOption(episode.id);
      const receipt = await postFromButton(discovery.getByRole("button", { name: "Prepare claim and calculate reimbursement" }));
      const expected = governed ? governedQuote : routineQuote;
      await expect(discovery.getByText(`Eligible ${bdt(expected.eligibleMinor)} · Deductible ${bdt(expected.deductibleMinor)} · Insurer share ${bdt(expected.insurerShareMinor)}`, { exact: false })).toBeVisible();
      await expect(discovery.getByText("Payable " + bdt(expected.payableMinor), { exact: true })).toBeVisible();
      await info.attach("reimbursement-statement", { body: await discovery.innerText(), contentType: "text/plain" });
      let claim;
      if (finalPayment) {
        await expect(discovery.getByLabel("Verified episode").locator('option[value="' + alternate.id + '"]')).toHaveCount(0);
        const unauthorized = await page.request.get(rawQuote(alternate.id));
        expect(unauthorized.status(), await unauthorized.text()).toBe(409);
        const offer = await page.request.get(rawQuote(episode.id));
        expect(offer.ok(), await offer.text()).toBe(true);
        const { quote } = await offer.json();
        expect(quote).toMatchObject(routineQuote);
        const facts = { policyId, episodeId: episode.id, revision: 1 };
        const initial = { operation: "submitMedicalClaim", id: receipt.id, ...facts, statementHash: quote.statementHash };
        for (const malformed of [{ ...initial, amountMinor: 95000 }, { ...initial, revision: 2 }, { ...initial, statementHash: "0".repeat(64) }]) {
          const denial = await page.request.post("/api/workflows", { data: malformed });
          expect(denial.status(), await denial.text()).toBe("amountMinor" in malformed ? 400 : 409);
          journal.push({ scenario: "intake-input-perturbation", status: denial.status() });
        }
        const preparation = await page.request.post("/api/workflows", { data: { operation: "prepareMedicalClaim", id: id("concurrent"), ...facts } });
        expect(preparation.ok(), await preparation.text()).toBe(true);
        const competing = await Promise.all([initial, { ...initial, id: id("concurrent") }]
          .map(data => page.request.post("/api/workflows", { data })));
        expect(competing.map(response => response.status()).sort()).toEqual([200, 409]);
        claim = (await competing.find(response => response.ok())!.json()).result;
        expect((await assets("claim") as { episodeId?: string }[]).filter(row => row.episodeId === episode.id)).toHaveLength(1);
        journal.push({ scenario: "concurrent-medical-claims", winningClaimId: claim.id, status: competing.map(response => response.status()) });
      } else {
        claim = await postFromButton(discovery.getByRole("button", { name: "Accept statement and submit claim" }));
      }
      expect(claim).toMatchObject({ version: 1, amountMinor: (governed ? governedQuote : routineQuote).payableMinor, episodeId: episode.id, episodeRevision: 1, policyId });
      if (!finalPayment) expect(claim.id).toBe(receipt.id);
      claimId = claim.id;
      if (duplicateOnly) expect(claim).toMatchObject({ medicalDuplicateReview: true, version: 1, appealCount: 0 });
    });
    if (deadlines) {
      await test.step("expire preparation, recover once, commit OCR for both formats, and expire voting", async () => {
        const pdf = id("invoice-pdf"), jpeg = id("invoice-jpeg");
        if (!resumeClaim) {
          await uploadDocument(claimId, pdf, "INVOICE", {
            name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from(invoicePDF("MED-250", service, "190,000.00")),
          }, 1);
          const image = await page.evaluate(date => {
            const canvas = document.createElement("canvas");
            canvas.width = 1000;
            canvas.height = 330;
            const brush = canvas.getContext("2d")!;
            brush.fillStyle = "white";
            brush.fillRect(0, 0, 1000, 330);
            brush.fillStyle = "black";
            brush.font = "42px Arial";
            ["Invoice number: MED-251", "Service date: " + date, "Total due: BDT 190,000.00"].forEach((text, i) => brush.fillText(text, 50, 85 + i * 82));
            return canvas.toDataURL("image/jpeg", 0.94).split(",")[1];
          }, service);
          await uploadDocument(claimId, jpeg, "MEDICAL_REPORT", {
            name: "invoice-scan.jpg", mimeType: "image/jpeg", buffer: Buffer.from(image, "base64"),
          }, 1);
          await login("insurer");
          await freshVerification(claimId, 1);
        }
        const command = async (data: object, status = 200) => {
          const response = await page.request.post("/api/medical/review", { data });
          const body = await response.json();
          journal.push({ actor: role, status: response.status(), data, ...body });
          expect(response.status(), JSON.stringify(body)).toBe(status);
          return body.result;
        };
        const until = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
        const after = async (timestamp: string) => {
          await expect.poll(() => Date.now(), { timeout: 105_000, intervals: [1000] }).toBeGreaterThan(Date.parse(timestamp) + 1000);
        };

        let recovered;
        let oldGrants;
        if (resumeClaim) {
          await login("insurer");
          const view = await loadReview(claimId);
          const original = await asset("review", id("prepare-expiry"));
          expect(original).toMatchObject({ claimId, status: "ACCESS_FAILED", assignedAuditorIds: panel });
          expect(view.facts.serviceDate).toBe(service);
          expect(view.documents.map((doc: { id: string }) => doc.id).sort()).toEqual([pdf, jpeg].sort());
          expect(view.review).toMatchObject({ status: "PREPARING", assignedAuditorIds: panel, medicalVersion: 1 });
          recovered = view.review;
          const grants = await assets("evidence-grant");
          oldGrants = grants.filter((grant: { medicalReviewId: string }) => grant.medicalReviewId === original.id);
        } else {
          const initial = await command({ action: "prepare", claimId, reviewId: id("prepare-expiry"), prepareBy: until(60) });
          expect(initial.assignedAuditorIds).toEqual(panel);
          await command({ action: "expire", reviewId: initial.id }, 409);
          await login("holder");
          oldGrants = await command({ action: "share", reviewId: initial.id, expiresAt: until(3600) });
          expect(oldGrants).toHaveLength(8);
          await login("insurer");
          await after(initial.prepareBy);
          await loadReview(claimId);
          expect(await reviewAction("Finalize expired review")).toMatchObject({ id: initial.id, status: "ACCESS_FAILED" });
          recovered = await reviewAction("Use one procedural recovery");
          expect(recovered).toMatchObject({ assignedAuditorIds: panel, medicalVersion: 1, status: "PREPARING" });
          expect(recovered.id).not.toBe(initial.id);
        }
        expect(oldGrants).toHaveLength(8);
        expect((await loadReview(claimId)).claim).toMatchObject({ medicalRecoveryUsed: true, amountMinor: governedQuote.payableMinor });

        await login("auditor1");
        const old = oldGrants.find((grant: { granteeSubject: string; evidenceId: string }) => grant.granteeSubject === "auditor1" && grant.evidenceId === pdf);
        const stale = await page.request.post("/api/evidence/" + pdf, { data: { grantId: old.id } });
        expect(stale.status(), await stale.text()).toBe(403);
        await login("holder");
        await loadReview(claimId);
        expect(await reviewAction("Grant listed evidence to these four reviewers")).toHaveLength(8);
        const remote: string[] = [];
        const applicationOrigin = new URL(page.url()).origin;
        page.context().on("request", request => {
          const url = new URL(request.url());
          if (url.protocol.startsWith("http") && url.origin !== applicationOrigin) remote.push(url.hostname);
        });
        await confirmReviewDocuments(claimId, [pdf, jpeg], { [pdf]: "MED-250", [jpeg]: "MED-251" }, 1);
        expect(remote).toEqual([]);

        await login("insurer");
        const voting = await command({ action: "open", reviewId: recovered.id, deadline: until(60) });
        expect(voting.status).toBe("OPEN");
        await login("auditor1");
        await loadReview(claimId);
        await reviewCard.getByLabel("Reason reference").fill("Synthetic sample vote before absence of quorum.");
        await reviewAction("Record reasoned vote");
        await login("insurer");
        await after(voting.deadline);
        await loadReview(claimId);
        expect(await reviewAction("Finalize expired review")).toMatchObject({ id: recovered.id, status: "TIMED_OUT" });
        await command({ action: "recover", reviewId: recovered.id, newId: id("prohibited"), prepareBy: until(3600) }, 409);
        expect((await loadReview(claimId)).claim).toMatchObject({ status: "REJECTED", medicalRecoveryUsed: true });
        expect(errors).toEqual([]);
      });
      return;
    }

    if (resumeApprovedAppeal) await test.step("verify retained corrected appeal approval", async () => {
      await login("insurer");
      const retained = await loadReview(claimId);
      expect(retained.claim).toMatchObject({ policyId: id("policy"), version: 3, status: "APPROVED", medicalDuplicateReview: true });
      expect(retained.appeal).toMatchObject({ status: "OVERTURNED" });
      expect(retained.review).toMatchObject({ medicalVersion: 3, status: "APPROVED" });
      expect(retained.decisions.filter((decision: { outcome: string }) => decision.outcome === "APPROVE")).toHaveLength(3);
    });

    if (governed && !resumeApprovedAppeal) await test.step("clarification, four-auditor decryption, OCR and corrected appeal", async () => {
      await login("insurer");
      let initial;
      if (resumeClarification) {
        const retained = await loadReview(claimId);
        expect(retained.claim).toMatchObject({ version: 1, status: "MEDICAL_REVIEW_PREPARING", policyId: id("policy") });
        expect(retained.clarification).toMatchObject({ status: "PENDING" });
        episodeId = retained.claim.episodeId;
        initial = retained.review;
      } else {
        const initialResults = await freshVerification(claimId, 1);
        expect(initialResults.some(result => result.verificationCode.startsWith("XGB_REVIEW:"))).toBe(true);
        await loadReview(claimId);
        initial = await reviewAction("Prepare four-auditor review");
        await reviewCard.getByLabel("Clarification question and requested evidence").fill("Please provide the itemized synthetic invoice.");
        await reviewAction("Send clarification");
      }
      expect(initial).toMatchObject({ assignedAuditorIds: panel, approvalThreshold: 3, rejectionThreshold: 2 });
      await expect(reviewCard.getByRole("button", { name: "Open voting for 24 hours" })).toBeDisabled();

      await login("holder");
      await loadReview(claimId);
      await expect(reviewCard.getByText(/Please provide the itemized synthetic invoice/)).toBeVisible();
      if (devLite) await expect(timeline.getByText(/Policyholder answers the clarification request/)).toBeVisible();
      const image = await page.evaluate(date => {
        const canvas = document.createElement("canvas");
        canvas.width = 1000;
        canvas.height = 330;
        const brush = canvas.getContext("2d")!;
        brush.fillStyle = "white";
        brush.fillRect(0, 0, canvas.width, canvas.height);
        brush.fillStyle = "black";
        brush.font = "42px Arial";
        ["Invoice number: MED-250", "Service date: " + date, "Total due: BDT 190,000.00"].forEach((text, i) => brush.fillText(text, 50, 85 + i * 82));
        return canvas.toDataURL("image/png").split(",")[1];
      }, service);
      const invoice = { name: "itemized-invoice.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") };
      await reviewCard.getByLabel("Response type").selectOption("MATERIAL");
      await reviewCard.getByLabel("Clarification response", { exact: true }).fill("The itemized invoice is attached.");
      await reviewCard.getByLabel("New clarification document").setInputFiles(invoice);
      expect(await reviewAction("Send response")).toMatchObject({ id: claimId, version: 2, status: "SUBMITTED" });
      const invoiceId = id("clarification");
      await uploadDocument(claimId, invoiceId, "CLARIFICATION_DOCUMENT", invoice, 2);

      await login("insurer");
      const clarificationResults = await freshVerification(claimId, 2);
      expect(clarificationResults.some(result => result.verificationCode.startsWith("XGB_REVIEW:"))).toBe(true);
      await loadReview(claimId);
      const returned = await reviewAction("Prepare four-auditor review");
      expect(returned).toMatchObject({ assignedAuditorIds: panel, medicalVersion: 2 });
      expect(await asset("review", initial.id)).toMatchObject({ status: "SUPERSEDED" });
      await expect(reviewCard.getByRole("button", { name: "Send clarification" })).toHaveCount(0);
      await login("holder");
      await loadReview(claimId);
      const initialGrants = await reviewAction("Grant listed evidence to these four reviewers");
      expect(initialGrants).toHaveLength(4);
      await confirmReviewDocuments(claimId, [invoiceId], { [invoiceId]: "MED-250" });
      await login("insurer");
      await loadReview(claimId);
      await reviewAction("Open voting for 24 hours");

      let disputed = "";
      for (const auditor of panel.slice(0, 2)) {
        await login(auditor);
        await loadReview(claimId);
        await reviewCard.getByLabel("Decision reason").selectOption("INSUFFICIENT_REQUIRED_EVIDENCE");
        await reviewCard.getByLabel("Reason reference").fill("The itemization does not substantiate the out-of-range synthetic bill.");
        const rejected = await reviewAction("Record reasoned vote");
        disputed = rejected.id;
      }
      expect(await asset("claim", claimId)).toMatchObject({ status: "REJECTED" });

      await login("hospital");
      expect(await form("saveMedicalEpisode", hospitalFields(1, "85000.00"))).toMatchObject({ id: episodeId, revision: 2 });
      await login("insurer");
      await form("verifyMedicalAssociation", { episodeId, revision: "2", beneficiaryId: "policyholder1",
        decisionBasis: id("verified-corrected-source"), associationDecision: "VERIFY" });

      await login("holder");
      await loadReview(claimId);
      await reviewCard.getByLabel("Disputed rejection").selectOption(disputed);
      await reviewCard.getByLabel("What changed?").fill("The hospital corrected the billed amount to BDT 85,000.00 in episode revision 2.");
      const newFile = { name: "corrected-supplement.txt", mimeType: "text/plain", buffer: Buffer.from(`Synthetic corrected BDT 85,000.00 itemization ${service} · ${suffix}`) };
      await reviewCard.getByLabel("New appeal document").setInputFiles(newFile);
      await reviewCard.getByLabel("Corrected episode revision (optional)").fill("2");
      await reviewCard.getByRole("button", { name: "Calculate corrected reimbursement" }).click();
      await expect(reviewCard.getByText("Corrected payable amount " + bdt(payout), { exact: false })).toBeVisible();
      const appeal = await reviewAction("File medical appeal");
      expect(appeal).toMatchObject({ claimVersion: 3, disputedDecisionId: disputed, medicalPriorReviewId: returned.id });
      if (devLite && priorClaimId) {
        expect(await asset("claim", claimId)).toMatchObject({ medicalDuplicateReview: true });
      }
      const appealDocument = id("appeal-document");
      await uploadDocument(claimId, appealDocument, "APPEAL_DOCUMENT", newFile, 3);

      await login("insurer");
      const appealResults = await freshVerification(claimId, 3, appeal.id);
      expect(appealResults.some(result => /^XGB_(AUTO|REVIEW):/.test(result.verificationCode))).toBe(true);
      await loadReview(claimId);
      const reopened = await reviewAction("Prepare four-auditor review");
      expect(reopened).toMatchObject({ assignedAuditorIds: panel, medicalVersion: 3 });
      await login("auditor1");
      const oldGrant = initialGrants.find((grant: { granteeSubject: string }) => grant.granteeSubject === "auditor1");
      expect(oldGrant).toBeDefined();
      const stale = await page.request.post(`/api/evidence/${invoiceId}`, { data: { grantId: oldGrant.id } });
      expect(stale.status(), await stale.text()).toBe(403);
      await login("holder");
      const detail = await loadReview(claimId);
      if (devLite) await expect(timeline.getByText(/Policyholder grants evidence access/)).toBeVisible();
      const currentIds = detail.documents.map((doc: { id: string }) => doc.id);
      expect(currentIds).toContain(appealDocument);
      expect(await reviewAction("Grant listed evidence to these four reviewers")).toHaveLength(4 * currentIds.length);
      await confirmReviewDocuments(claimId, currentIds);
      await login("insurer");
      await loadReview(claimId);
      await reviewAction("Open voting for 24 hours");
      for (const auditor of panel.slice(0, 3)) {
        await login(auditor);
        await loadReview(claimId);
        await reviewCard.getByLabel("Reason reference").fill("Verified corrected amount, decrypted evidence and issued terms.");
        await reviewAction("Record reasoned vote");
      }
      expect(await asset("claim", claimId)).toMatchObject({ version: 3, status: "APPROVED", amountMinor: payout });
    });

    if (duplicateOnly) await test.step("refer a similar episode with a positive Oracle result", async () => {
      await login("insurer");
      const results = await freshVerification(claimId, 1);
      expect(results.some(result => result.verificationCode.startsWith("XGB_AUTO:")), JSON.stringify(results)).toBe(true);
      const referred = await loadReview(claimId);
      expect(referred.claim).toMatchObject({ status: "MEDICAL_REVIEW_REQUIRED", medicalDuplicateReview: true, version: 1 });
      await expect(timeline.getByText(/similar episode or a crowded matching window/)).toBeVisible();
      await expect(timeline.getByText(/Insurer prepares panel review/)).toBeVisible();
      await expect(timeline.getByText("Pinned Oracle inputs")).toBeVisible();
      await info.attach("duplicate-referral-timeline", { body: await timeline.screenshot(), contentType: "image/png" });
      await reviewAction("Prepare four-auditor review");
      await reviewAction("Open voting for 24 hours");
      for (const auditor of panel.slice(0, 3)) {
        await login(auditor);
        await loadReview(claimId);
        await expect(timeline.getByText(/Assigned auditors review and vote/)).toBeVisible();
        await reviewCard.getByLabel("Reason reference").fill("The similar synthetic episode is a separate eligible visit.");
        await reviewAction("Record reasoned vote");
      }
      await login("insurer");
      expect(await asset("claim", claimId)).toMatchObject({ version: 1, status: "APPROVED", appealCount: 0 });
    });

    await test.step("pinned matching Oracle results and exactly one committed payout", async () => {
      if (!governed && !duplicateOnly) await attestRegistry();
      await login("insurer");
      if (!governed && !duplicateOnly && !resumeClaim) {
      const request = await form("startClaimProcessing", { claimId });
      expect(request).toMatchObject({ claimId, claimVersion: 1, modelVersion: "fabric-xgb-synthetic-v1", requiredConfirmations: 2, expectedResponses: 3 });
      await expect.poll(async () => (await asset("claim", claimId)).status, { timeout: 240_000, intervals: [2000] }).toMatch(/^(APPROVED|ORACLE_FAILED)$/);
      const results = (await assets("oracle-result") as { requestId: string; verificationCode: string; resultHash: string }[]).filter(result => result.requestId === request.id);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some((result, n) => results.slice(n + 1).some(other => other.resultHash === result.resultHash))).toBe(true);
      journal.push({ request, results });
      const claim = await asset("claim", claimId);
      if (finalPayment) {
        expect(results).toHaveLength(2);
        expect(results.map(result => (result as { oracleId?: string }).oracleId).sort()).toEqual(["oracle1", "oracle2"]);
        expect(claim.status).toBe("APPROVED");
      }
      if (claim.status === "ORACLE_FAILED") {
        expect(results.some(result => result.verificationCode.startsWith("XGB_REVIEW:")), JSON.stringify(results)).toBe(true);
        await form("routeOracleFailureToReview", { requestId: request.id, reviewId: id("review"),
          assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: "3", rejectionThreshold: "2",
          deadline: new Date(Date.now() + 3_600_000).toISOString() });
        for (const auditor of ["auditor1", "auditor2", "auditor3"] as const) {
          await login(auditor);
          await form("recordAuditorDecision", { reviewId: id("review"), decisionId: id(auditor), outcome: "APPROVE",
            reasonText: "Synthetic structured record confirms the published reimbursement basis" });
        }
        await login("insurer");
        expect((await asset("claim", claimId)).status).toBe("APPROVED");
      } else {
        expect(results.some(result => result.verificationCode.startsWith("XGB_AUTO:")), JSON.stringify(results)).toBe(true);
      }
      }
      if (finalPayment && resumeClaim) {
        expect(await asset("claim", claimId)).toMatchObject({ id: claimId, policyId: id("policy"), status: "SETTLEMENT_AUTHORIZED", amountMinor: payout });
        expect(await asset("settlement", id("settlement"))).toMatchObject({ claimId, sourceAccountId: id("reserve"),
          destinationAccountId: id("customer"), status: "PAYMENT_FAILED", amountMinor: payout });
      } else {
        if (devLite) {
          const approved = await loadReview(claimId);
          expect(approved.timeline.approval).toMatchObject({ path: governed || duplicateOnly ? "PANEL" : "ORACLE_AUTO" });
          await expect(timeline.getByText(/Insurer authorizes settlement/)).toBeVisible();
        }
        await form("authorizeSettlement", { settlementId: id("settlement"), claimId, sourceAccountId: id("reserve"), destinationAccountId: id("customer") });
      }
      await login("bank");
      if (devLite) {
        const bank = await loadBankTimeline(id("settlement"));
        expect(bank).toMatchObject({ claimId, approval: { path: governed || duplicateOnly ? "PANEL" : "ORACLE_AUTO" },
          payout: { status: finalPayment && resumeClaim ? "PAYMENT_FAILED" : "AUTHORIZED", amountMinor: payout } });
        expect(Object.keys(bank).sort()).toEqual(["approval", "claimId", "claimVersion", "payout"]);
        expect((await page.request.get("/api/medical/review?" + new URLSearchParams({ claim: claimId }))).status()).toBe(403);
        await expect(page.getByRole("region", { name: "Medical settlement result" }).getByText(bank.approval.hash)).toBeVisible();
      }
      // The customer paid the first premium from this account unless the policy was reused.
      const customerBefore = money.customerOpening - (reusePolicy ? 0 : money.premium);
      expect((await asset("account", id("customer"))).balanceMinor).toBe(customerBefore);
      if (stopBeforeBank) {
        const receipt = info.outputPath("authorized-result.json");
        await writeFile(receipt, JSON.stringify({ claimId, settlementId: id("settlement"), transferId: id("payout") }));
        await info.attach("dev-lite-authorized-result", { path: receipt, contentType: "application/json" });
        expect(errors).toEqual([]);
        return;
      }
      const instruction = { settlementId: id("settlement"), transferId: id("payout"), bankReferenceText: id("bank-receipt") };
      if (finalPayment) {
        if (resumeClaim) {
          // The interrupted case used the routine receipt for its bounce.
          instruction.bankReferenceText = id("bank-receipt-recovered");
        } else {
          expect(await form("confirmSettlement", { ...instruction, transferId: id("underfunded"), bankReferenceText: id("bounced-receipt") }))
            .toMatchObject({ status: "PAYMENT_FAILED", amountMinor: payout });
          expect((await asset("account", id("customer"))).balanceMinor).toBe(customerBefore);
          await form("adjustBankAccountBalance", { transferId: id("funding"), accountId: id("reserve"),
            direction: "CREDIT", amountBdt: "1,00,000.00", externalReferenceText: id("funding-receipt") });
        }
        expect((await asset("account", id("reserve"))).balanceMinor).toBe(money.reserveOpening);
        const capture = page.waitForEvent("requestfailed", { predicate: request => request.url().endsWith("/api/workflows"), timeout: 150_000 });
        let committed;
        const endpoint = "**/api/workflows";
        await page.route(endpoint, async route => {
          const command = route.request().postDataJSON();
          if (command?.operation !== "confirmSettlement" || command.transferId !== id("payout")) return route.continue();
          const response = await route.fetch({ timeout: 120_000, maxRetries: 0 });
          committed = { httpStatus: response.status(), ...await response.json() };
          await route.abort("failed");
        });
        await (await fillForm("confirmSettlement", instruction)).click();
        await capture;
        await page.unroute(endpoint);
        expect(committed, JSON.stringify(committed)).toMatchObject({ httpStatus: 200, state: "COMMITTED", result: { status: "CONFIRMED", amountMinor: payout } });
        await page.reload();
        const recovered = await postFromButton(page.getByRole("button", { name: "Check saved action" }));
        expect(recovered).toMatchObject({ status: "CONFIRMED", amountMinor: payout, id: id("settlement") });
        journal.push({ scenario: "valid-commit-lost-response", committed, recovered });
      } else {
        expect(await form("confirmSettlement", instruction)).toMatchObject({ status: "CONFIRMED", amountMinor: payout });
      }
      await form("confirmSettlement", { ...instruction, transferId: id("duplicate") }, 409);
      expect((await asset("account", id("customer"))).balanceMinor).toBe(customerBefore + payout);
      expect((await asset("account", id("reserve"))).balanceMinor).toBe(money.reserveOpening - payout);
      const transfers = (await assets("bank-transfer") as { settlementId: string; status: string; id: string }[]).filter(row => row.settlementId === id("settlement"));
      expect(transfers.filter(row => row.status === "SETTLED")).toEqual([expect.objectContaining({ id: id("payout"), status: "SETTLED" })]);
      expect(transfers).toHaveLength(finalPayment ? 2 : 1);
      await login("holder");
      expect(await asset("claim", claimId)).toMatchObject({ status: "SETTLED", amountMinor: payout });
      if (devLite) {
        const settled = await asset("settlement", id("settlement"));
        expect(settled.approvalCertificateHash).toMatch(/^[a-f0-9]{64}$/);
        const final = await loadReview(claimId);
        expect(final.timeline).toMatchObject({ approval: { hash: settled.approvalCertificateHash },
          payout: { id: id("settlement"), status: "CONFIRMED", transferId: id("payout"), amountMinor: payout } });
        await expect(timeline.getByText(/Payout complete/)).toBeVisible();
        await expect(timeline.getByText(id("payout"), { exact: true })).toBeVisible();
        expect((await page.request.get("/api/medical/settlement?" + new URLSearchParams({ settlement: id("settlement") }))).status()).toBe(403);
        await login("insurer");
        const audit = await page.request.get("/api/audit/claims/" + claimId);
        expect(audit.ok(), await audit.text()).toBe(true);
        expect(await audit.json()).toMatchObject({ approvalCertificate: { hash: settled.approvalCertificateHash, claimVersion: final.claim.version },
          settlement: { id: id("settlement"), status: "CONFIRMED" } });
        await login("holder");
        await loadReview(claimId);
      }
      if (governed && priorClaimId) expect(await asset("claim", priorClaimId)).toMatchObject({ status: "SETTLED" });
      if (finalPayment) {
        const reference = id("independent-review");
        const data = { claimId, version: 1, outcome: "DISMISSED", basisHash: createHash("sha256").update(reference).digest("hex") };
        for (const outsider of ["holder", "hospital"] as const) {
          await login(outsider);
          const denial = await page.request.post("/api/medical/investigation", { data });
          expect(denial.status(), await denial.text()).toBe(403);
        }
        await login("insurer");
        await loadReview(claimId);
        await reviewCard.getByLabel("Investigation outcome").selectOption("DISMISSED");
        await reviewCard.getByLabel("Independent investigation reference").fill(reference);
        const finding = await postFromButton(reviewCard.getByRole("button", { name: "Record research finding" }), "/api/medical/investigation");
        expect(finding).toMatchObject({ outcome: "DISMISSED", version: 1 });
        const restored = await page.request.post("/api/medical/investigation", { data });
        expect(restored.status(), await restored.text()).toBe(200);
        expect((await restored.json()).result).toEqual(finding);
        const replacement = await page.request.post("/api/medical/investigation", { data: { ...data, outcome: "SUBSTANTIATED" } });
        expect(replacement.status(), await replacement.text()).toBe(409);
        expect(await asset("claim", claimId)).toMatchObject({ status: "SETTLED", amountMinor: payout, version: 1 });
      }
      await info.attach("settled-workspace", { body: await page.screenshot(), contentType: "image/png" });
      expect(errors).toEqual([]);
      if (devLite && finalPayment) {
        const receipt = info.outputPath("routine-result.json");
        await writeFile(receipt, JSON.stringify({ claimId, settlementId: id("settlement") }));
        await info.attach("dev-lite-routine-result", { path: receipt, contentType: "application/json" });
      }
    });
  } finally {
    await info.attach("fabric-rehearsal-journal", { body: JSON.stringify({ suffix, start, service, medicalService, policyId, reusePolicy, end, journal, errors }, null, 2), contentType: "application/json" });
  }
});
