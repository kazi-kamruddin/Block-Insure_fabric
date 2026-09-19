import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const accounts = [
  { name: "Insurer Administrator", selector: /Insurer Administrator/ },
  { name: "Policyholder One", selector: /Policyholder One/ },
  { name: "Hospital Officer", selector: /Dhaka Central Medical Hospital/ },
  { name: "Independent Auditor One", selector: /Independent Auditor One/ },
  { name: "Bank Officer", selector: /Bangladesh Demo Commercial Bank/ },
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
  test(`${account.name} workspace passes automated WCAG 2.1 AA checks`, async ({ page }) => {
    await page.goto("/workspace");
    await page.getByRole("button", { name: account.selector }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Workflow action")).toBeVisible();
    await expectWcagAA(page, `${account.name} workspace`);
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
