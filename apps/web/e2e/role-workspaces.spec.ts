import { expect, test, type Page } from "@playwright/test";

const actors = [
  { account: "insurer-admin", workspace: "insurer", heading: "Portfolio oversight" },
  { account: "policyholder-1", workspace: "policyholder", heading: "Coverage and claims overview" },
  { account: "hospital-officer", workspace: "hospital", heading: "Hospital verification desk" },
  { account: "auditor", workspace: "auditor", heading: "Independent claim audit" },
  { account: "bank-officer", workspace: "bank", heading: "Settlement confirmation desk" },
] as const;

async function signIn(page: Page, account: string) {
  await page.goto("/workspace");
  const labels: Record<string, string> = {
    "insurer-admin": "Insurer Administrator",
    "policyholder-1": "Policyholder One",
    "hospital-officer": "Hospital Officer",
    auditor: "Independent Auditor",
    "bank-officer": "Bank Officer",
  };
  await page.getByRole("button", { name: new RegExp(labels[account]) }).click();
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

test("cross-site mutation attempts are rejected before authentication", async ({ request }) => {
  const response = await request.post("/api/auth/demo-login", {
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    data: { accountId: "insurer-admin" },
  });
  expect(response.status()).toBe(403);
});
