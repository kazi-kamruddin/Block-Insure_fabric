import { expect, test, type Page } from "@playwright/test";

const actors = [
  { account: "insurer-admin", workspace: "insurer", heading: "Portfolio oversight", action: "createPolicyPackage" },
  { account: "policyholder-1", workspace: "policyholder", heading: "Coverage and claims overview", action: "acquirePolicy" },
  { account: "hospital-officer", workspace: "hospital", heading: "Hospital verification desk", action: "verifyClaim" },
  { account: "auditor", workspace: "auditor", heading: "Independent claim audit", action: "recordAuditorDecision" },
  { account: "auditor-2", workspace: "auditor", heading: "Independent claim audit", action: "recordAuditorDecision" },
  { account: "auditor-3", workspace: "auditor", heading: "Independent claim audit", action: "recordAuditorDecision" },
  { account: "auditor-4", workspace: "auditor", heading: "Independent claim audit", action: "recordAuditorDecision" },
  { account: "bank-officer", workspace: "bank", heading: "Banking operations desk", action: "registerBankAccountReference" },
] as const;

async function signIn(page: Page, account: string) {
  await page.goto("/workspace");
  const labels: Record<string, string> = {
    "insurer-admin": "Insurer Administrator",
    "policyholder-1": "Policyholder One",
    "hospital-officer": "Hospital Officer",
    auditor: "Independent Auditor One",
    "auditor-2": "Independent Auditor Two",
    "auditor-3": "Independent Auditor Three",
    "auditor-4": "Independent Auditor Four",
    "bank-officer": "Bank Officer",
  };
  await page.getByRole("button", { name: new RegExp(labels[account]) }).click();
  await page.waitForLoadState("networkidle");
}

test("public landing page describes the permissioned network", async ({ page }) => {
  const response = await page.goto("/");
  await expect(page.getByRole("heading", { name: "Insurance coordination with proof built in." })).toBeVisible();
  await expect(page.getByText("Hyperledger Fabric · Permissioned by design")).toBeVisible();
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
});

for (const actor of actors) {
  test(`${actor.account} reaches only its canonical workspace`, async ({ page }) => {
    await signIn(page, actor.account);
    await expect(page).toHaveURL(new RegExp(`/workspace/${actor.workspace}$`));
    await expect(page.getByRole("heading", { name: actor.heading })).toBeVisible();
    await expect(page.getByRole("navigation", { name: new RegExp("navigation$") })).toBeVisible();
    await expect(page.getByLabel("Workflow action")).toHaveValue(actor.action);

    const anotherWorkspace = actor.workspace === "insurer" ? "bank" : "insurer";
    await page.goto(`/workspace/${anotherWorkspace}`);
    await expect(page).toHaveURL(new RegExp(`/workspace/${actor.workspace}$`));
    await expect(page.getByRole("heading", { name: actor.heading })).toBeVisible();
  });
}

test("anonymous users cannot read ledger dashboards", async ({ request }) => {
  const response = await request.get("/api/dashboard");
  expect(response.status()).toBe(401);
});

test("guided financial forms reject fractional poisha before submission", async ({ page }) => {
  await signIn(page, "insurer-admin");
  await page.getByLabel("Package name").fill("Validation-only package");
  await page.getByLabel("Public description").fill("No ledger transaction should be submitted");
  await page.getByLabel("Premium (BDT)").fill("10.005");
  await page.getByLabel("Coverage limit (BDT)").fill("1000");
  await page.getByLabel("Terms reference").fill("validation-only-terms");
  await page.getByRole("button", { name: "Submit verified transaction" }).click();
  await expect(page.locator(".formError")).toContainText("at most two decimal places");
});

test("policyholder encrypts evidence locally before upload", async ({ page }) => {
  await signIn(page, "policyholder-1");
  const evidenceCard = page.getByRole("article").filter({ hasText: "Encrypt, store, and anchor evidence" });
  await evidenceCard.getByLabel("Claim ID").fill("claim-browser-encryption");
  await evidenceCard.getByLabel("Evidence ID").fill("evidence-browser-encryption");
  await evidenceCard.getByLabel("Original file").setInputFiles({
    name: "medical-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("private browser evidence"),
  });
  await evidenceCard.getByLabel("Evidence passphrase").fill("correct horse battery staple");
  await evidenceCard.getByLabel("Confirm passphrase").fill("correct horse battery staple");
  await evidenceCard.getByRole("button", { name: "Encrypt in browser" }).click();

  await expect(evidenceCard.getByText("Ciphertext ready")).toBeVisible();
  await expect(evidenceCard.getByText(/medical-note\.txt\.enc/)).toBeVisible();
  await expect(evidenceCard.getByLabel("Original content SHA-256")).toHaveValue(/^[a-f0-9]{64}$/);
  await expect(evidenceCard.getByLabel("Evidence passphrase")).toHaveValue("");
  await expect(evidenceCard.getByRole("button", { name: "Store ciphertext and record reference" })).toBeEnabled();
});

test("cross-site mutation attempts are rejected before authentication", async ({ request }) => {
  const response = await request.post("/api/auth/demo-login", {
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    data: { accountId: "insurer-admin" },
  });
  expect(response.status()).toBe(403);
});
