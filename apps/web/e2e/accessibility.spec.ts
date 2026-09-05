import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const accounts = [
  "Insurer Administrator",
  "Policyholder One",
  "Hospital Officer",
  "Independent Auditor",
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
    await page.getByRole("button", { name: new RegExp(account) }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Workflow action")).toBeVisible();
    await expectWcagAA(page, `${account} workspace`);
  });
}
