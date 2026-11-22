import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openOperation, openPage, workspaceIdentity } from "./workspace-pages";

// Live dev-lite journey for the customer–Bank premium flows with realistic
// taka amounts: account linking, a refused backdated purchase, a first premium
// by OTP, first premiums by EFT mandate, automatic collection, an
// insufficient-funds bounce, funding, retry, and the ledger-date guard.
const accounts = { insurer: "insurer-admin", holder: "policyholder-1", bank: "bank-officer" } as const;
const paths = { insurer: "insurer", holder: "policyholder", bank: "bank" } as const;
const headings = { insurer: "Insurer Administrator", holder: "Policyholder One", bank: "Bangladesh Demo Commercial Bank" } as const;
// Staging runs the day before a demonstration. Its policies start tomorrow and
// it stops once both mandates are approved, leaving one well-funded and one
// under-funded first debit due on demonstration day.
const stageOnly = process.env.PREMIUM_STAGE_ONLY === "true";

function day(offset: number, base?: string) {
  const from = base ? Date.parse(`${base}T00:00:00Z`) : Date.now() + 6 * 3_600_000;
  return new Date(from + offset * 86_400_000).toISOString().slice(0, 10);
}

test("live bank linking, OTP and EFT premiums with a bounce and retry", async ({ page }, info) => {
  test.setTimeout(900_000);
  const health = await page.request.get("/api/fabric/health");
  expect(await health.json()).toMatchObject({ channel: "insurance-dev-lite-190", schemaVersion: 15 });
  const suffix = randomUUID().slice(0, 8);
  const id = (prefix: string) => `prem-${prefix}-${suffix}`;
  const digits = { rich: String(1000 + Math.floor(Math.random() * 4000)), poor: String(5000 + Math.floor(Math.random() * 4000)), rejected: String(9000 + Math.floor(Math.random() * 900)) };
  const masked = (key: keyof typeof digits) => `**** ${digits[key]}`;
  // Cover is never backdated: policies start today, or tomorrow when staging.
  const today = day(0), start = stageOnly ? day(1) : today, end = day(364, start);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let role: keyof typeof accounts | undefined;

  async function login(next: keyof typeof accounts) {
    if (role === next) return;
    const response = await page.request.post("/api/auth/demo-login", { data: { accountId: accounts[next] }, maxRetries: 2 });
    expect(response.ok(), await response.text()).toBe(true);
    await page.goto("/workspace/" + paths[next]);
    await expect(workspaceIdentity(page, headings[next])).toBeVisible({ timeout: 45_000 });
    role = next;
  }
  async function clickAndWait(button: ReturnType<Page["getByRole"]>, pathname: string, status = 200) {
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === pathname && response.request().method() === "POST", { timeout: 150_000 });
    await button.click();
    const response = await pending;
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(status);
    return status === 200 ? body.result : body;
  }
  async function form(operation: string, input: Record<string, string>, status = 200) {
    const card = await openOperation(page, operation);
    for (const [name, value] of Object.entries(input)) {
      const field = card.locator(`[name="${name}"]`);
      if (await field.evaluate((element) => element.tagName === "SELECT")) await field.selectOption(value);
      else await field.fill(value);
    }
    return clickAndWait(card.getByRole("button", { name: /^(Submit verified transaction|Submit bank instruction)$/ }), "/api/workflows", status);
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
    await form("createPolicyPackage", { id: id("package"), name: "Family Surgical Care " + suffix, description: "Synthetic premium journey", premiumBdt: "1,250.00", coverageLimitBdt: "3,00,000.00", termsText: id("terms") });
    await form("configurePolicyPackagePartners", { id: id("package"), hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
    await form("configureMedicalRules", { packageId: id("package"), service: "SURGERY", sublimit: "150000.00", deductibleBps: "1000", deductibleCap: "5000.00", shareBps: "8000", waitingDays: "30", filingDays: "30", evidenceRequired: "No" });
    await form("publishPolicyPackage", { id: id("package") });
  });

  await test.step("the Bank opens the Insurer's premium account", async () => {
    await login("bank");
    await form("openBankAccount", { id: id("insurer-premium"), bankId: "bank-demo", ownerId: "insurer", accountType: "INSURER",
      accountLabel: "Premium journey premium " + suffix, maskedAccount: "**** 7001", openingBalanceBdt: "0.00", accountTokenText: id("token-insurer") });
  });

  await test.step("the customer asks the Bank to link three accounts", async () => {
    await login("holder");
    await openPage(page, "payments");
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
    await openPage(page, "accounts");
    // BDT 25,000 covers two installments; BDT 800 cannot pay one BDT 1,250 premium.
    for (const [key, balance] of [["rich", "25,000.00"], ["poor", "800.00"]] as const) {
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
  const policies = { otp: id("policy-otp"), rich: id("policy-rich"), poor: id("policy-poor") };
  async function buy(policyId: string, startDate: string, endDate: string, status = 200) {
    const offer = await openOperation(page, "acquireMedicalPolicy");
    await offer.getByRole("button", { name: "Load published packages" }).click();
    await offer.getByLabel("Medical package").selectOption(id("package"));
    await expect(offer.getByText(/^BDT 1,250\.00 per 30-day period/)).toBeVisible();
    await offer.getByLabel("I accept these published terms").check();
    return form("acquireMedicalPolicy", { id: policyId, startDate, endDate }, status);
  }
  await test.step("the ledger refuses a backdated purchase", async () => {
    await login("holder");
    const links = await assets<{ maskedAccount: string; status: string; accountReferenceId: string }>("bank-link");
    accountIds.rich = links.find((link) => link.maskedAccount === masked("rich"))!.accountReferenceId;
    accountIds.poor = links.find((link) => link.maskedAccount === masked("poor"))!.accountReferenceId;
    const refused = await buy(id("policy-backdated"), day(-1), day(363), 409);
    expect(refused.message).toContain("never backdated");
  });

  await test.step("the customer buys a policy and pays the first premium by OTP", async () => {
    await openPage(page, "payments");
    await expect(center.getByText(`Salary account ${suffix} · ${masked("rich")}`)).toBeVisible();
    await expect(center.getByText(`Unknown account ${suffix} · ${masked("rejected")}`)).toBeVisible();
    expect(await buy(policies.otp, start, end)).toMatchObject({ status: "PENDING_PAYMENT", coverStartDate: "" });
    await openPage(page, "payments");
    await center.getByRole("button", { name: "Refresh" }).click();
    const item = center.locator(".queueItem").filter({ hasText: policies.otp });
    await item.getByRole("combobox", { name: "Pay from" }).selectOption(accountIds.rich);
    await item.getByRole("button", { name: "Pay first premium now" }).click();
    const card = page.locator("#manual-premium");
    await expect(card.getByLabel("Policy ID", { exact: true })).toHaveValue(policies.otp);
    await expect(card.getByLabel("Customer account ID", { exact: true })).toHaveValue(accountIds.rich);
    await expect(card.getByLabel("Insurer account ID", { exact: true })).toHaveValue(id("insurer-premium"));
    await expect(card.getByLabel("Premium (BDT)", { exact: true })).toHaveValue("1250.00");
    await card.getByRole("button", { name: "Email OTP", exact: true }).click();
    await expect(card.locator(".evidenceWarning strong")).toHaveText(/^\d{6}$/);
    const result = await clickAndWait(card.getByRole("button", { name: "Authorize premium", exact: true }), "/api/banking/premium-payment");
    expect(result).toMatchObject({ status: "SETTLED", method: "OTP", amountMinor: 125_000 });
    expect(await asset("policy", policies.otp)).toMatchObject({ status: "ACTIVE", coverStartDate: start, paidThroughDate: day(29, start), nextPremiumDueDate: day(30, start) });
  });

  await test.step("two more policies take the first premium by EFT and the Bank approves the mandates", async () => {
    for (const key of ["rich", "poor"] as const) {
      expect(await buy(policies[key], start, end)).toMatchObject({ status: "PENDING_PAYMENT" });
    }
    await openPage(page, "payments");
    await center.getByRole("button", { name: "Refresh" }).click();
    for (const key of ["rich", "poor"] as const) {
      const item = center.locator(".queueItem").filter({ hasText: policies[key] });
      await item.getByRole("combobox", { name: "Pay from" }).selectOption(accountIds[key]);
      await clickAndWait(item.getByRole("button", { name: "Set up automatic EFT payment" }), "/api/workflows");
    }
    await login("bank");
    await openPage(page, "collections");
    for (const key of ["rich", "poor"] as const) {
      const mandate = (await assets<{ id: string; policyId: string }>("mandate")).find((row) => row.policyId === policies[key])!;
      const item = desk.locator(".queueItem").filter({ hasText: `first debit ${start}` }).filter({ hasText: masked(key) });
      await clickAndWait(item.getByRole("button", { name: "Approve mandate" }), "/api/workflows");
      expect(await asset("mandate", mandate.id)).toMatchObject({ status: "ACTIVE", nextDebitDate: start, amountMinor: 125_000 });
    }
  });

  async function writeReceipt(mode: string) {
    const receipt = info.outputPath("premium-result.json");
    await writeFile(receipt, JSON.stringify({ mode, suffix, policies, accountIds, maskedAccounts: { rich: masked("rich"), poor: masked("poor") }, insurerAccount: id("insurer-premium"), package: id("package"), dueDate: start }, null, 2));
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
    const lapse = await page.request.post("/api/workflows", { data: { operation: "advancePolicyLifecycle", id: policies.otp, asOfDate: day(60) }, headers: { origin: new URL(page.url()).origin } });
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
    expect(await asset("policy", policies.rich)).toMatchObject({ status: "ACTIVE", coverStartDate: today, paidThroughDate: day(29) });
    // A bounced first premium gives no cover.
    expect(await asset("policy", policies.poor)).toMatchObject({ status: "PENDING_PAYMENT", coverStartDate: "" });
  });

  await test.step("the customer funds the account, the Insurer retries and the Bank collects", async () => {
    const bounced = (await assets<{ id: string; policyId: string }>("collection")).find((row) => row.policyId === policies.poor)!;
    await login("bank");
    await openPage(page, "collections");
    const item = desk.locator(".queueItem").filter({ hasText: masked("poor") }).filter({ hasText: "bounced" });
    await item.getByLabel("Deposit (BDT)").fill("1,250.00");
    await clickAndWait(item.getByRole("button", { name: "Record customer deposit" }), "/api/workflows");
    await login("insurer");
    await openPage(page, "premiums");
    const open = operations.locator(".queueItem").filter({ hasText: bounced.id });
    await clickAndWait(open.getByRole("button", { name: "Retry collection" }), "/api/workflows");
    expect(await asset("collection", bounced.id)).toMatchObject({ status: "RETRY" });
    await login("bank");
    await openPage(page, "collections");
    const retry = desk.locator(".queueItem").filter({ hasText: masked("poor") }).filter({ hasText: "attempts 1" });
    const processed = await clickAndWait(retry.getByRole("button", { name: "Collect premium" }), "/api/banking/bank-desk");
    expect(processed).toMatchObject({ status: "COMPLETED", attemptCount: 2 });
    // The Bank portal cannot read policies; confirm the effect as the Insurer.
    await login("insurer");
    expect(await asset("policy", policies.poor)).toMatchObject({ status: "ACTIVE", coverStartDate: today, paidThroughDate: day(29) });
  });

  await test.step("the customer cancels automatic payment", async () => {
    await login("holder");
    await openPage(page, "payments");
    const item = center.locator(".queueItem").filter({ hasText: policies.rich });
    await clickAndWait(item.getByRole("button", { name: "Cancel automatic payment" }), "/api/workflows");
    const mandate = (await assets<{ policyId: string; status: string }>("mandate")).find((row) => row.policyId === policies.rich);
    expect(mandate?.status).toBe("CANCELLED");
  });

  await writeReceipt("complete");
  expect(errors).toEqual([]);
});
