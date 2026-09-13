import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const accounts = [
  "Insurer Administrator",
  "Policyholder One",
  "Hospital Officer",
  "Independent Auditor One",
  "Bank Officer",
] as const;

async function expectWcagAA(page: Page, surface: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(result.violations, `${surface}: ${result.violations.map((item) => `${item.id} (${item.nodes.length})`).join(", ")}`)
    .toEqual([]);
}

test("public and sign-in surfaces pass automated WCAG 2.1 AA checks", async ({ page }) => {
  await page.goto("/");
  await expectWcagAA(page, "landing page");
  await page.goto("/workspace");
  await expectWcagAA(page, "account selection");
});

for (const account of accounts) {
  test(`${account} workspace passes automated WCAG 2.1 AA checks`, async ({ page }) => {
    await page.goto("/workspace");
    const selector = account === "Hospital Officer" ? /^Hospital Officer HospitalMSP$/ : new RegExp(account);
    await page.getByRole("button", { name: selector }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Workflow action")).toBeVisible();
    await expectWcagAA(page, `${account} workspace`);
  });
}

test("ledger-derived research dashboard passes automated WCAG 2.1 AA checks", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/workspace");
  await page.getByRole("button", { name: /Insurer Administrator/ }).click();
  await page.goto("/research");
  await expect(page.getByRole("heading", { name: "Block-Insure thesis dashboard" })).toBeVisible();
  await expectWcagAA(page, "research dashboard");
});
