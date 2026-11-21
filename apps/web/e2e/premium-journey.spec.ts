import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Live dev-lite journey for the customer–Bank premium flows: account linking,
// first premium by OTP, EFT mandates, automatic collection, an
// insufficient-funds bounce, funding, retry, and the ledger-date guard.
const accounts = { insurer: "insurer-admin", holder: "policyholder-1", bank: "bank-officer" } as const;
const paths = { insurer: "insurer", holder: "policyholder", bank: "bank" } as const;
const headings = { insurer: "Insurer Administrator", holder: "Policyholder One", bank: "Bangladesh Demo Commercial Bank" } as const;
// Staging stops once both mandates are approved and due today, leaving one
// well-funded and one under-funded collection for a live demonstration.
const stageOnly = process.env.PREMIUM_STAGE_ONLY === "true";

function day(offset: number) {
  return new Date(Date.now() + 6 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

test("live bank linking, OTP and EFT premiums with a bounce and retry", async ({ page }, info) => {
  test.setTimeout(900_000);
  const health = await page.request.get("/api/fabric/health");
  expect(await health.json()).toMatchObject({ channel: "insurance-dev-lite-190", schemaVersion: 15 });
  const suffix = randomUUID().slice(0, 8);
  const id = (prefix: string) => `prem-${prefix}-${suffix}`;
  const digits = { rich: String(1000 + Math.floor(Math.random() * 4000)), poor: String(5000 + Math.floor(Math.random() * 4000)), rejected: String(9000 + Math.floor(Math.random() * 900)) };
  const masked = (key: keyof typeof digits) => `**** ${digits[key]}`;
  const start = day(-30), end = day(59), today = day(0);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let role: keyof typeof accounts | undefined;

  async function login(next: keyof typeof accounts) {
    if (role === next) return;
    const response = await page.request.post("/api/auth/demo-login", { data: { accountId: accounts[next] }, maxRetries: 2 });
    expect(response.ok(), await response.text()).toBe(true);
    await page.goto("/workspace/" + paths[next]);
    await expect(page.getByRole("heading", { name: headings[next], exact: true })).toBeVisible({ timeout: 45_000 });
    role = next;
  }
  async function clickAndWait(button: ReturnType<Page["getByRole"]>, pathname: string, status = 200) {
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === pathname && response.request().method() === "POST", { timeout: 150_000 });
    await button.click();
    const response = await pending;
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(status);
    return body.result;
  }
  async function form(operation: string, input: Record<string, string>) {
    const card = page.locator("#guided-workflow");
    const selector = card.getByLabel("Workflow action");
    if (await selector.inputValue() !== operation) await selector.selectOption(operation);
    for (const [name, value] of Object.entries(input)) {
      const field = card.locator(`[name="${name}"]`);
      if (await field.evaluate((element) => element.tagName === "SELECT")) await field.selectOption(value);
      else await field.fill(value);
    }
    return clickAndWait(card.getByRole("button", { name: /^(Submit verified transaction|Submit bank instruction)$/ }), "/api/workflows");
  }
  async function assets<T>(type: string): Promise<T[]> {
    const response = await page.request.get("/api/ledger/" + type);
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).result;
  }
  async function asset<T>(type: string, key: string): Promise<T> {
    const response = await page.request.get(`/api/ledger/${type}/${encodeURIComponent(key)}`);
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).result;
  }
  const center = page.locator("#premium-center");
  const desk = page.locator("#bank-desk");
  const operations = page.locator("#premium-operations");

  await test.step("publish a premium product with the contracted Bank", async () => {
    await login("insurer");
    const agreements = await assets<{ partnerId: string; status: string }>("partner-agreement");
    for (const [partnerType, partnerId, name] of [["HOSPITAL", "hospital-demo", "Synthetic Hospital"], ["BANK", "bank-demo", "Synthetic Bank"]]) {
      if (agreements.some((row) => row.partnerId === partnerId && row.status === "ACTIVE")) continue;
      await form("createPartnerAgreement", { id: id(partnerId), partnerType, partnerId, name, location: "Dhaka", tier: "Preferred", accessScope: "Synthetic premium journey", effectiveDate: day(-60), expiryDate: day(365) });
    }
    await form("createPolicyPackage", { id: id("package"), name: "Premium journey " + suffix, description: "Synthetic premium journey", premiumBdt: "1.00", coverageLimitBdt: "40.00", termsText: id("terms") });
    await form("configurePolicyPackagePartners", { id: id("package"), hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
    await form("configureMedicalRules", { packageId: id("package"), service: "SURGERY", sublimit: "80.00", deductibleBps: "1000", deductibleCap: "10.00", shareBps: "8000", waitingDays: "0", filingDays: "30", evidenceRequired: "No" });
    await form("publishPolicyPackage", { id: id("package") });
  });

  await test.step("the Bank opens the Insurer's premium account", async () => {
    await login("bank");
    await form("openBankAccount", { id: id("insurer-premium"), bankId: "bank-demo", ownerId: "insurer", accountType: "INSURER",
      accountLabel: "Premium journey premium " + suffix, maskedAccount: "**** 7001", openingBalanceBdt: "0.00", accountTokenText: id("token-insurer") });
  });

  await test.step("the customer asks the Bank to link three accounts", async () => {
    await login("holder");
    for (const [key, nickname] of [["rich", "Salary account"], ["poor", "Pocket account"], ["rejected", "Unknown account"]] as const) {
      await center.getByRole("combobox", { name: "Bank", exact: true }).selectOption("bank-demo");
      await center.getByLabel("Account nickname").fill(nickname + " " + suffix);
      await center.getByLabel("Last digits of the account").fill(digits[key]);
      await clickAndWait(center.getByRole("button", { name: "Request account link" }), "/api/workflows");
      await expect(center.getByText(`Link request · ${nickname} ${suffix} · ${masked(key)}`)).toBeVisible();
    }
  });

  await test.step("the Bank verifies two links and rejects one", async () => {
    await login("bank");
    for (const [key, balance] of [["rich", "5.00"], ["poor", "1.50"]] as const) {
      const item = desk.locator(".queueItem").filter({ hasText: masked(key) });
      await item.getByLabel("Verified balance (BDT)").fill(balance);
      await clickAndWait(item.getByRole("button", { name: "Verify and link" }), "/api/workflows");
      await expect(item).toHaveCount(0);
    }
    await clickAndWait(desk.locator(".queueItem").filter({ hasText: masked("rejected") }).getByRole("button", { name: "Reject" }), "/api/workflows");
    const links = await assets<{ maskedAccount: string; status: string; accountReferenceId: string }>("bank-link");
    expect(links.find((link) => link.maskedAccount === masked("rejected"))?.status).toBe("REJECTED");
  });

  const accountIds = { rich: "", poor: "" };
  const policies = { rich: id("policy-rich"), poor: id("policy-poor") };
  await test.step("the customer buys two policies and pays each first premium by OTP", async () => {
    await login("holder");
    const links = await assets<{ maskedAccount: string; status: string; accountReferenceId: string }>("bank-link");
    accountIds.rich = links.find((link) => link.maskedAccount === masked("rich"))!.accountReferenceId;
    accountIds.poor = links.find((link) => link.maskedAccount === masked("poor"))!.accountReferenceId;
    await expect(center.getByText(`Salary account ${suffix} · ${masked("rich")}`)).toBeVisible();
    await expect(center.getByText(`Unknown account ${suffix} · ${masked("rejected")}`)).toBeVisible();
    for (const key of ["rich", "poor"] as const) {
      const offer = page.locator("#guided-workflow");
      await offer.getByLabel("Workflow action").selectOption("acquireMedicalPolicy");
      await offer.getByRole("button", { name: "Load published packages" }).click();
      await offer.getByLabel("Medical package").selectOption(id("package"));
      await offer.getByLabel("I accept these published terms").check();
      const policy = await form("acquireMedicalPolicy", { id: policies[key], startDate: start, endDate: end });
      expect(policy).toMatchObject({ status: "PENDING_PAYMENT" });
      await center.getByRole("button", { name: "Refresh" }).click();
      const item = center.locator(".queueItem").filter({ hasText: policies[key] });
      await item.getByRole("combobox", { name: "Pay from" }).selectOption(accountIds[key]);
      await item.getByRole("button", { name: "Pay first premium now" }).click();
      const card = page.locator("#manual-premium");
      await expect(card.getByLabel("Policy ID", { exact: true })).toHaveValue(policies[key]);
      await expect(card.getByLabel("Customer account ID", { exact: true })).toHaveValue(accountIds[key]);
      await expect(card.getByLabel("Insurer account ID", { exact: true })).toHaveValue(id("insurer-premium"));
      await card.getByRole("button", { name: "Email OTP", exact: true }).click();
      await expect(card.locator(".evidenceWarning strong")).toHaveText(/^\d{6}$/);
      const result = await clickAndWait(card.getByRole("button", { name: "Authorize premium", exact: true }), "/api/banking/premium-payment");
      expect(result).toMatchObject({ status: "SETTLED", method: "OTP" });
      expect(await asset("policy", policies[key])).toMatchObject({ status: "ACTIVE", paidThroughDate: day(-1), nextPremiumDueDate: today });
    }
  });

  await test.step("the customer sets up EFT mandates and the Bank approves them", async () => {
    await center.getByRole("button", { name: "Refresh" }).click();
    for (const key of ["rich", "poor"] as const) {
      const item = center.locator(".queueItem").filter({ hasText: policies[key] });
      await item.getByRole("combobox", { name: "Pay from" }).selectOption(accountIds[key]);
      await clickAndWait(item.getByRole("button", { name: "Set up automatic EFT payment" }), "/api/workflows");
    }
    await login("bank");
    for (const key of ["rich", "poor"] as const) {
      const mandate = (await assets<{ id: string; policyId: string }>("mandate")).find((row) => row.policyId === policies[key])!;
      const item = desk.locator(".queueItem").filter({ hasText: `first debit ${today}` }).filter({ hasText: masked(key) });
      await clickAndWait(item.getByRole("button", { name: "Approve mandate" }), "/api/workflows");
      expect(await asset("mandate", mandate.id)).toMatchObject({ status: "ACTIVE", nextDebitDate: today });
    }
  });

  async function writeReceipt(mode: string) {
    const receipt = info.outputPath("premium-result.json");
    await writeFile(receipt, JSON.stringify({ mode, suffix, policies, accountIds, maskedAccounts: { rich: masked("rich"), poor: masked("poor") }, insurerAccount: id("insurer-premium"), package: id("package"), dueDate: today }, null, 2));
    await info.attach("premium-result", { path: receipt, contentType: "application/json" });
  }
  if (stageOnly) {
    await writeReceipt("staged");
    expect(errors).toEqual([]);
    return;
  }

  await test.step("the Insurer cannot schedule or lapse ahead of the ledger date", async () => {
    await login("insurer");
    const early = await page.request.post("/api/workflows", { data: { operation: "schedulePremiumCollections", asOfDate: day(1) }, headers: { origin: new URL(page.url()).origin } });
    expect(early.status()).toBe(409);
    expect((await early.json()).message).toContain("later than the ledger business date");
    const lapse = await page.request.post("/api/workflows", { data: { operation: "advancePolicyLifecycle", id: policies.rich, asOfDate: day(60) }, headers: { origin: new URL(page.url()).origin } });
    expect(lapse.status()).toBe(409);
    expect((await lapse.json()).message).toContain("later than the ledger business date");
  });

  await test.step("the automatic worker collects one premium and the other bounces", async () => {
    const secrets = JSON.parse(await readFile(path.resolve(info.project.testDir, "../../../data/dev-lite/app-secrets.json"), "utf8"));
    const run = await page.request.post("/api/internal/banking/collections", { data: { action: "run", asOfDate: today }, headers: { authorization: `Bearer ${secrets.BANKING_WORKER_SECRET}` } });
    const body = await run.json();
    expect(run.ok(), JSON.stringify(body)).toBe(true);
    const collections = await assets<{ id: string; policyId: string; status: string; failureCode: string; attemptCount: number }>("collection");
    expect(collections.find((row) => row.policyId === policies.rich)).toMatchObject({ status: "COMPLETED", attemptCount: 1 });
    expect(collections.find((row) => row.policyId === policies.poor)).toMatchObject({ status: "BOUNCED", failureCode: "INSUFFICIENT_FUNDS", attemptCount: 1 });
    expect(await asset("policy", policies.rich)).toMatchObject({ status: "ACTIVE", paidThroughDate: day(29) });
  });

  await test.step("the customer funds the account, the Insurer retries and the Bank collects", async () => {
    const bounced = (await assets<{ id: string; policyId: string }>("collection")).find((row) => row.policyId === policies.poor)!;
    await login("bank");
    const item = desk.locator(".queueItem").filter({ hasText: masked("poor") }).filter({ hasText: "bounced" });
    await item.getByLabel("Deposit (BDT)").fill("1.00");
    await clickAndWait(item.getByRole("button", { name: "Record customer deposit" }), "/api/workflows");
    await login("insurer");
    const open = operations.locator(".queueItem").filter({ hasText: bounced.id });
    await clickAndWait(open.getByRole("button", { name: "Retry collection" }), "/api/workflows");
    expect(await asset("collection", bounced.id)).toMatchObject({ status: "RETRY" });
    await login("bank");
    const retry = desk.locator(".queueItem").filter({ hasText: masked("poor") }).filter({ hasText: "attempts 1" });
    const processed = await clickAndWait(retry.getByRole("button", { name: "Collect premium" }), "/api/banking/bank-desk");
    expect(processed).toMatchObject({ status: "COMPLETED", attemptCount: 2 });
    // The Bank portal cannot read policies; confirm the effect as the Insurer.
    await login("insurer");
    expect(await asset("policy", policies.poor)).toMatchObject({ status: "ACTIVE", paidThroughDate: day(29) });
  });

  await test.step("the customer cancels automatic payment", async () => {
    await login("holder");
    const item = center.locator(".queueItem").filter({ hasText: policies.rich });
    await clickAndWait(item.getByRole("button", { name: "Cancel automatic payment" }), "/api/workflows");
    const mandate = (await assets<{ policyId: string; status: string }>("mandate")).find((row) => row.policyId === policies.rich);
    expect(mandate?.status).toBe("CANCELLED");
  });

  await writeReceipt("complete");
  expect(errors).toEqual([]);
});
