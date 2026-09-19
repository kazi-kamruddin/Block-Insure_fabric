import { expect, test, type Page } from "@playwright/test";

const actors = [
  { account: "insurer-admin", workspace: "insurer", heading: "Portfolio oversight", action: "createPartnerAgreement" },
  { account: "policyholder-1", workspace: "policyholder", heading: "Coverage and claims overview", action: "acquirePolicy" },
  { account: "hospital-officer", workspace: "hospital", heading: "Independent Hospital billing register", action: "createHospitalInvoice" },
  { account: "hospital-officer-2", workspace: "hospital", heading: "Independent Hospital billing register", action: "createHospitalInvoice" },
  { account: "hospital-officer-3", workspace: "hospital", heading: "Independent Hospital billing register", action: "createHospitalInvoice" },
  { account: "hospital-officer-4", workspace: "hospital", heading: "Independent Hospital billing register", action: "createHospitalInvoice" },
  { account: "hospital-officer-5", workspace: "hospital", heading: "Independent Hospital billing register", action: "createHospitalInvoice" },
  { account: "auditor", workspace: "auditor", heading: "Independent claim audit", action: "recordAuditorDecision" },
  { account: "auditor-2", workspace: "auditor", heading: "Independent claim audit", action: "recordAuditorDecision" },
  { account: "auditor-3", workspace: "auditor", heading: "Independent claim audit", action: "recordAuditorDecision" },
  { account: "auditor-4", workspace: "auditor", heading: "Independent claim audit", action: "recordAuditorDecision" },
  { account: "bank-officer", workspace: "bank", heading: "Banking operations desk", action: "openBankAccount" },
] as const;

async function signIn(page: Page, account: string) {
  await page.goto("/workspace");
  const labels: Record<string, string> = {
    "insurer-admin": "Insurer Administrator",
    "policyholder-1": "Policyholder One",
    "hospital-officer": "Dhaka Central Medical Hospital",
    "hospital-officer-2": "Chattogram Metropolitan Hospital",
    "hospital-officer-3": "Rajshahi Community Hospital",
    "hospital-officer-4": "Khulna Riverside Hospital",
    "hospital-officer-5": "Sylhet Valley Hospital",
    auditor: "Independent Auditor One",
    "auditor-2": "Independent Auditor Two",
    "auditor-3": "Independent Auditor Three",
    "auditor-4": "Independent Auditor Four",
    "bank-officer": "Bangladesh Demo Commercial Bank",
  };
  const label = labels[account];
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await page.waitForLoadState("networkidle");
}

test("public landing page describes the permissioned network", async ({ page }) => {
  const response = await page.goto("/");
  await expect(page.getByRole("heading", { name: "Insurance coordination with proof built in." })).toBeVisible();
  await expect(page.getByText("Hyperledger Fabric · Permissioned by design")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Published coverage packages" })).toBeVisible();
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
});

test("liveness, dependency readiness, public catalog, and not-found behavior are explicit", async ({ page, request }) => {
  const live = await request.get("/api/health/live");
  expect(live.status()).toBe(200);
  expect(await live.json()).toMatchObject({ status: "alive", service: "block-insure-web" });

  const ready = await request.get("/api/health/ready");
  const readiness = await ready.json();
  expect(ready.status(), JSON.stringify(readiness)).toBe(200);
  expect(readiness).toMatchObject({
    status: "ready",
    dependencies: { chaincode: "connected", schemaVersion: 10, oracle1: "connected", oracle2: "connected" },
  });

  const catalog = await request.get("/api/public/policies");
  expect(catalog.status()).toBe(200);
  expect((await catalog.json()).packages.length).toBeGreaterThan(0);

  const missing = await page.goto("/this-route-does-not-exist");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This Block-Insure page does not exist." })).toBeVisible();
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

test("event worker requires its exact bearer credential", async ({ request }) => {
  const rejected = await request.post("/api/internal/events/sync", {
    headers: { authorization: "Bearer incorrect-event-worker-secret-with-32-characters" },
  });
  expect(rejected.status()).toBe(401);

  const accepted = await request.post("/api/internal/events/sync", {
    headers: { authorization: "Bearer browser-event-worker-secret-with-32-characters" },
  });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  expect(await accepted.json()).toMatchObject({ limitReached: expect.any(Boolean), processed: expect.any(Number) });
});

test("research metrics are role-restricted and reproducibly identified", async ({ page }) => {
  await signIn(page, "policyholder-1");
  await page.goto("/research");
  await expect(page).toHaveURL(/\/workspace\/policyholder$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "insurer-admin");
  await page.goto("/research");
  await expect(page.getByRole("heading", { name: "Block-Insure thesis dashboard" })).toBeVisible();
  await expect(page.getByText(/Hash [a-f0-9]{64}/)).toBeVisible();
});

test("guided financial forms reject fractional poisha before submission", async ({ page }) => {
  await signIn(page, "insurer-admin");
  await page.getByLabel("Workflow action").selectOption("createPolicyPackage");
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
