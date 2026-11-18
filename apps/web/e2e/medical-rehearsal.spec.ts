import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const roles = {
  insurer: ["Insurer Administrator", "insurer"],
  hospital: ["Dhaka Central Medical Hospital", "hospital"],
  holder: ["Policyholder One", "policyholder"],
  bank: ["Bangladesh Demo Commercial Bank", "bank"],
  auditor1: ["Independent Auditor One", "auditor"],
  auditor2: ["Independent Auditor Two", "auditor"],
  auditor3: ["Independent Auditor Three", "auditor"],
} as const;

function day(offset: number) {
  return new Date(Date.now() + 6 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

test("ordinary medical browser journey through one Bank payout", async ({ page }, info) => {
  test.setTimeout(900_000);
  const health = await page.request.get("/api/fabric/health");
  expect(health.ok(), await health.text()).toBe(true);
  expect(await health.json()).toMatchObject({ channel: "insurance-medical-reimbursement", chaincode: "insurance-contract", schemaVersion: 15 });

  const suffix = randomUUID().slice(0, 12);
  const id = (prefix: string) => "med-" + prefix + "-" + suffix;
  const start = day(-1), service = day(0), firstEnd = day(28), end = day(59);
  const journal: unknown[] = [];
  const errors: string[] = [];
  let role: keyof typeof roles | undefined;
  page.on("pageerror", error => errors.push(error.message));
  async function login(next: keyof typeof roles) {
    if (role === next) return;
    if (role) await page.getByRole("button", { name: "Sign out", exact: true }).click();
    else await page.goto("/workspace");
    await page.getByRole("button", { name: "Sign in as " + roles[next][0], exact: true }).click();
    await expect(page).toHaveURL(new RegExp("/workspace/" + roles[next][1] + "$"));
    await expect(page.getByRole("heading", { name: roles[next][0], exact: true })).toBeVisible();
    role = next;
  }

  async function postFromButton(button: ReturnType<typeof page.getByRole>, path = "/api/workflows", status = 200) {
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "POST", { timeout: 150_000 });
    await button.click();
    const response = await pending;
    const body = await response.json();
    journal.push({ actor: role, path, status: response.status(), result: body.result, message: body.message });
    expect(response.status(), JSON.stringify(body)).toBe(status);
    if (path === "/api/workflows" && await button.count()) await expect(button).toBeEnabled({ timeout: 120_000 });
    return body.result;
  }

  async function form(operation: string, input: Record<string, string>, status = 200) {
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
    return postFromButton(card.getByRole("button", { name: /^(Save intake|Submit verified transaction|Submit bank instruction)$/ }), "/api/workflows", status);
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

  try {
    await test.step("register partners and publish the medical policy", async () => {
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
      await form("createPolicyPackage", { id: id("package"), name: "Medical Reimbursement " + suffix,
        description: "Isolated synthetic reimbursement", premiumBdt: "1.00", coverageLimitBdt: "40.00", termsText: id("terms") });
      await form("configurePolicyPackagePartners", { id: id("package"), hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
      await form("configureMedicalRules", { packageId: id("package"), service: "SURGERY", sublimit: "80.00",
        deductibleBps: "1000", deductibleCap: "10.00", shareBps: "8000", waitingDays: "0", filingDays: "30", evidenceRequired: "No" });
      await form("publishPolicyPackage", { id: id("package") });
    });

    await test.step("accept policy terms and pay the first installment with OTP", async () => {
      await login("bank");
      for (const [name, ownerId, accountType, openingBalanceBdt] of [
        ["customer", "policyholder1", "CUSTOMER", "100.00"],
        ["premium", "insurer", "INSURER", "0.00"],
        ["reserve", "insurer", "INSURER", "100.00"],
      ]) await form("openBankAccount", { id: id(name), bankId: "bank-demo", ownerId, accountType,
        accountLabel: "Synthetic medical " + name, maskedAccount: "**** 1234", openingBalanceBdt, accountTokenText: id("token-" + name) });
      await login("holder");
      const offer = page.locator("#guided-workflow");
      await offer.getByLabel("Workflow action").selectOption("acquireMedicalPolicy");
      await offer.getByRole("button", { name: "Load published packages" }).click();
      await offer.getByLabel("Medical package").selectOption(id("package"));
      await expect(offer.getByText(/BDT 40.00 is payable/)).toBeVisible();
      await offer.getByLabel("I accept these published terms").check();
      const policy = await form("acquireMedicalPolicy", { id: id("policy"), startDate: start, endDate: end });
      expect(policy).toMatchObject({ status: "PENDING_PAYMENT", coverageLimitMinor: 4000, medicalRulesVersion: 1 });
      const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Pay with one-time authorization", exact: true }) });
      for (const [label, value] of Object.entries({ "Policy ID": id("policy"), "Customer account ID": id("customer"),
        "Insurer account ID": id("premium"), "Transfer ID": id("otp-transfer"), "Payment ID": id("otp-payment"),
        "Period starts": start, "Period ends": firstEnd, "Premium (BDT)": "1.00", "External bank receipt": id("otp-reference") })) {
        await card.getByLabel(label, { exact: true }).fill(value);
      }
      await card.getByRole("button", { name: "Email OTP", exact: true }).click();
      const code = card.locator(".evidenceWarning strong");
      await expect(code).toHaveText(/^\d{6}$/);
      await card.getByLabel("Six-digit OTP", { exact: true }).fill((await code.textContent())!);
      await postFromButton(card.getByRole("button", { name: "Authorize premium", exact: true }), "/api/banking/premium-payment");
      expect(await asset("policy", id("policy"))).toMatchObject({ status: "ACTIVE", paidThroughDate: firstEnd });
    });

    let claimId = "";
    await test.step("intake stays hidden until verified and the quote is pinned to the submitted claim", async () => {
      await login("hospital");
      const intakeFields = { episodeReference: id("episode"), expectedRevision: "0", patientReference: id("patient"),
        service: "SURGERY", admissionDate: service, dischargeDate: service, serviceDate: service, billBdt: "500.00",
        invoiceDate: service, diagnosisCode: "" };
      await expect(page.locator("#guided-workflow").getByLabel("Workflow action")).toHaveCount(0);
      const forbidden = await page.request.post("/api/workflows", { data: { operation: "recordHospitalModelFacts",
        invoiceId: id("hospital-model"), treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: service,
        expectedMinMinor: 1, expectedMaxMinor: 2, licenseStatus: "ACTIVE" } });
      expect(forbidden.status()).toBe(403);
      expect(await forbidden.json()).toMatchObject({ message: "Hospital accounts can only save factual episode intake." });
      const episode = await form("saveMedicalEpisode", intakeFields);
      await login("holder");
      const discovery = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Your medical episodes", exact: true }) });
      await discovery.getByRole("button", { name: "Refresh episodes" }).click();
      await expect(discovery.getByLabel("Verified episode").locator('option[value="' + episode.id + '"]')).toHaveCount(0);
      await login("insurer");
      const queue = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Episode association queue", exact: true }) });
      await queue.getByRole("button", { name: "Refresh episodes" }).click();
      await expect(queue.getByRole("button", { name: "Resolve association" }).first()).toBeVisible();
      await form("verifyMedicalAssociation", { episodeId: episode.id, revision: "1", beneficiaryId: "policyholder1",
        decisionBasis: id("verified-synthetic-match"), associationDecision: "VERIFY" });
      const registry = await page.request.get("/api/medical/intake");
      expect(registry.ok()).toBe(true);
      expect((await registry.json()).episodes.find((row: { id: string }) => row.id === episode.id)).toMatchObject({ associationStatus: "VERIFIED" });

      // The benchmark is an immutable synthetic fixture local to this channel.
      if (process.env.MEDICAL_BENCHMARK_EXISTS !== "true") {
        await form("registerMedicalOracleBenchmark", { hospitalId: "hospital-demo", service: "SURGERY", minimum: "250.00", maximum: "750.00",
          licenseStatus: "ACTIVE", sourceReference: "Synthetic benchmark range for documented BDT 500 surgery fixture" });
      }
      await login("holder");
      await discovery.getByRole("button", { name: "Refresh episodes" }).click();
      await discovery.getByLabel("Medical policy").selectOption(id("policy"));
      await discovery.getByLabel("Verified episode").selectOption(episode.id);
      const receipt = await postFromButton(discovery.getByRole("button", { name: "Prepare claim and calculate reimbursement" }));
      await expect(discovery.getByText(/Eligible BDT 80.00 · Deductible BDT 8.00 · Insurer share BDT 57.60/)).toBeVisible();
      await expect(discovery.getByText("Payable BDT 40.00", { exact: true })).toBeVisible();
      await info.attach("reimbursement-statement", { body: await discovery.innerText(), contentType: "text/plain" });
      const claim = await postFromButton(discovery.getByRole("button", { name: "Accept statement and submit claim" }));
      expect(claim).toMatchObject({ id: receipt.id, version: 1, amountMinor: 4000, episodeId: episode.id, episodeRevision: 1 });
      claimId = claim.id;
    });

    await test.step("pinned matching Oracle results and exactly one committed payout", async () => {
      await login("insurer");
      const request = await form("startClaimProcessing", { claimId });
      expect(request).toMatchObject({ claimId, claimVersion: 1, modelVersion: "fabric-xgb-synthetic-v1", requiredConfirmations: 2, expectedResponses: 3 });
      await expect.poll(async () => (await asset("claim", claimId)).status, { timeout: 240_000, intervals: [2000] }).toMatch(/^(APPROVED|ORACLE_FAILED)$/);
      const results = (await assets("oracle-result") as { requestId: string; verificationCode: string; resultHash: string }[]).filter(result => result.requestId === request.id);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some((result, n) => results.slice(n + 1).some(other => other.resultHash === result.resultHash))).toBe(true);
      journal.push({ request, results });
      const claim = await asset("claim", claimId);
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
      await form("authorizeSettlement", { settlementId: id("settlement"), claimId, sourceAccountId: id("reserve"), destinationAccountId: id("customer") });
      await login("bank");
      expect((await asset("account", id("customer"))).balanceMinor).toBe(9900);
      const payout = { settlementId: id("settlement"), transferId: id("payout"), bankReferenceText: id("bank-receipt") };
      expect(await form("confirmSettlement", payout)).toMatchObject({ status: "CONFIRMED", amountMinor: 4000 });
      await form("confirmSettlement", { ...payout, transferId: id("duplicate") }, 409);
      expect((await asset("account", id("customer"))).balanceMinor).toBe(13900);
      expect((await asset("account", id("reserve"))).balanceMinor).toBe(6000);
      const transfers = (await assets("bank-transfer") as { settlementId: string; status: string; id: string }[]).filter(row => row.settlementId === id("settlement"));
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({ id: id("payout"), status: "SETTLED" });
      await login("holder");
      expect(await asset("claim", claimId)).toMatchObject({ status: "SETTLED", amountMinor: 4000 });
      await info.attach("settled-workspace", { body: await page.screenshot(), contentType: "image/png" });
      expect(errors).toEqual([]);
    });
  } finally {
    await info.attach("fabric-rehearsal-journal", { body: JSON.stringify({ suffix, start, service, end, journal, errors }, null, 2), contentType: "application/json" });
  }
});
