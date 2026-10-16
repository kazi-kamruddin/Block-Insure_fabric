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
