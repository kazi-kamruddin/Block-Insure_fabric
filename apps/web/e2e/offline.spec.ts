import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("public and sign-in surfaces work without ledger dependencies", async ({ page, request }) => {
  const response = await page.goto("/");
  await expect(page.getByRole("heading", { name: "Insurance coordination with proof built in." })).toBeVisible();
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await request.get("/api/health/live")).status()).toBe(200);
  await page.goto("/workspace");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("anonymous and cross-site requests fail before ledger access", async ({ request }) => {
  for (const route of ["/api/dashboard", "/api/ledger/claim", "/api/policies/policy-1/statement"]) {
    expect((await request.get(route)).status()).toBe(401);
  }
  const rejected = await request.post("/api/auth/demo-login", {
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }, data: { accountId: "insurer-admin" },
  });
  expect(rejected.status()).toBe(403);
});

test("inherited object properties cannot be used as demo accounts", async ({ request }) => {
  for (const accountId of ["__proto__", "constructor", "toString"]) {
    expect((await request.post("/api/auth/demo-login", { data: { accountId } })).status()).toBe(400);
  }
});

for (const accountId of ["hospital-officer", "bank-officer"]) {
  test(`${accountId} cannot bypass its portal through statements or workflow commands`, async ({ request }) => {
    expect((await request.post("/api/auth/demo-login", { data: { accountId } })).ok()).toBe(true);
    expect((await request.get("/api/policies/policy-1/statement")).status()).toBe(403);
    expect((await request.post("/api/workflows", { data: { operation: "publishPolicyPackage", id: "package-1" } })).status()).toBe(403);
  });
}

test("invalid dates and state keys are rejected before the Gateway", async ({ request }) => {
  await request.post("/api/auth/demo-login", { data: { accountId: "insurer-admin" } });
  for (const data of [
    { operation: "publishPolicyPackage", id: ".." },
    { operation: "advancePolicyLifecycle", id: "policy-1", asOfDate: "2026-02-30" },
  ]) {
    expect((await request.post("/api/workflows", { data })).status()).toBe(400);
  }
  await request.post("/api/auth/demo-login", { data: { accountId: "policyholder-1" } });
  expect((await request.post("/api/banking/otp", { data: { policyId: "..", sourceAccountId: "account-1" } })).status()).toBe(400);
});

test("changing an evidence binding invalidates previously encrypted bytes", async ({ page }) => {
  await page.request.post("/api/auth/demo-login", { data: { accountId: "policyholder-1" } });
  await page.goto("/workspace/policyholder");
  const card = page.getByRole("article").filter({ hasText: "Encrypt, store, and anchor evidence" });
  await card.getByLabel("Claim ID").fill("claim-browser-1");
  await card.getByLabel("Evidence ID").fill("evidence-browser-1");
  await card.getByLabel("Original file").setInputFiles({ name: "medical-note.txt", mimeType: "text/plain", buffer: Buffer.from("private browser evidence") });
  await card.getByLabel("Evidence passphrase", { exact: true }).fill("correct horse battery staple");
  await card.getByLabel("Confirm passphrase").fill("correct horse battery staple");
  await card.getByRole("button", { name: "Encrypt in browser" }).click();
  await expect(card.getByText("Ciphertext ready")).toBeVisible();
  await card.getByLabel("Claim ID").fill("claim-browser-2");
  await expect(card.getByText("Not encrypted yet")).toBeVisible();
  await expect(card.getByLabel("Original content SHA-256")).toHaveValue("");
  await expect(card.getByRole("button", { name: "Store ciphertext and record reference" })).toBeDisabled();
});

test("encrypted recovery backup restores the original evidence key at 320px without a ledger write", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.request.post("/api/auth/demo-login", { data: { accountId: "policyholder-1" } });
  await page.goto("/workspace/policyholder");
  const upload = page.getByRole("article").filter({ hasText: "Encrypt, store, and anchor evidence" });
  await upload.getByLabel("Claim ID").fill("claim-backup-browser");
  await upload.getByLabel("Evidence ID").fill("evidence-backup-browser");
  await upload.getByLabel("Original file").setInputFiles({ name: "synthetic-invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic invoice for browser encryption") });
  await upload.getByLabel("Evidence passphrase", { exact: true }).fill("synthetic original passphrase");
  await upload.getByLabel("Confirm passphrase").fill("synthetic original passphrase");
  await upload.getByLabel("Separate backup password (optional)").fill("synthetic backup password");
  await upload.getByRole("button", { name: "Encrypt in browser" }).click();
  const downloadEvent = page.waitForEvent("download");
  await upload.getByRole("link", { name: "Download recovery key" }).click();
  const download = await downloadEvent;
  const filename = testInfo.outputPath("synthetic-recovery.bifkey");
  await download.saveAs(filename);
  const retrieval = page.getByRole("article").filter({ hasText: "Retrieve and decrypt evidence" });
  await retrieval.getByLabel("Recovery key file").setInputFiles(filename);
  await retrieval.getByLabel("Backup password", { exact: true }).fill("synthetic backup password");
  await retrieval.getByRole("button", { name: "Restore recovery key" }).click();
  await expect(retrieval.getByLabel("Evidence ID", { exact: true })).toHaveValue("evidence-backup-browser");
  await expect(retrieval.getByLabel("Evidence passphrase", { exact: true })).toHaveValue("synthetic original passphrase");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await upload.getByLabel("Claim ID").fill("changed-claim");
  await expect(upload.getByRole("link", { name: "Download recovery key" })).toHaveCount(0);
});
