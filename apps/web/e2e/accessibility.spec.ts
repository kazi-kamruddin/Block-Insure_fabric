import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { encryptEvidenceBytes } from "../lib/evidence/browser-crypto";
import { invoicePDF } from "./invoice-pdf";

const accounts = [
  { name: "Insurer Administrator", selector: /Insurer Administrator/ },
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
    await expect(page.getByRole("navigation", { name: "Workspace pages" })).toBeVisible();
    await expectWcagAA(page, `${account.name} workspace`);
  });
}

test("ledger-derived research dashboard passes automated WCAG 2.1 AA checks", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/workspace");
  await page.getByRole("button", { name: /Insurer Administrator/ }).click();
  await page.waitForURL(/\/workspace\/insurer$/);
  await page.goto("/research");
  await expect(page.getByRole("heading", { name: "Block-Insure thesis dashboard" })).toBeVisible();
  await expectWcagAA(page, "research dashboard");
});

test("an onboarded customer can navigate the claim, OCR and appeal controls with a keyboard", async ({ page }, info) => {
  test.skip(info.project.name !== "dev-lite-chromium", "Requires the retained LevelDB onboarding profile");
  test.setTimeout(180_000);
  const claimId = "CLM-2026-000201";
  const reviewId = "synthetic-a11y-review";
  const evidenceId = "synthetic-a11y-receipt";
  const passphrase = "synthetic accessibility-only review passphrase";
  await page.goto("/workspace");
  await page.getByRole("link", { name: "Customer sign-in" }).press("Enter");
  const email = page.getByRole("textbox", { name: "Email address" });
  await email.fill(process.env.DEV_LITE_A11Y_EMAIL ?? "kazi.ahmed@example.com");
  await email.press("Enter");
  const codeInput = page.getByRole("textbox", { name: "Verification code" });
  const displayCode = page.getByLabel("Demo verification code", { exact: true });
  await expect(codeInput).toBeFocused();
  await expect(displayCode).toBeVisible();
  const code = await displayCode.textContent();
  if (!code || !/^\d{6}$/.test(code.trim())) throw new Error("The seeded sign-in did not show a local code.");
  await codeInput.fill(code.trim());
  await codeInput.press("Enter");
  await expect(page).toHaveURL(/\/workspace\/policyholder$/);
  await expect(page.getByText(/\bBI-[A-Z0-9]{6,}\b/).first()).toBeVisible();
  await expectWcagAA(page, "onboarded customer overview");

  let prepared = 0;
  await page.route("**/api/**", async route => {
    if (route.request().method() === "GET") return route.continue();
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint === "/api/medical/review") {
      const action = route.request().postDataJSON().action;
      if (action === "recordOCR") return route.fulfill({ json: { result: { recorded: true } } });
      if (action === "appeal") return route.fulfill({ status: 409, json: { message: "The submitted decision changed. Refresh the case." } });
    }
    if (endpoint === "/api/workflows") prepared++;
    return route.abort();
  });
  await page.goto("/workspace/policyholder/claims");
  await page.getByRole("button", { name: "Refresh episodes" }).press("Enter");
  const policy = page.getByRole("combobox", { name: "Medical policy" });
  const episode = page.getByRole("combobox", { name: "Verified episode" });
  await expect(policy).toBeVisible();
  await policy.focus();
  await page.keyboard.press("Tab");
  await expect(episode).toBeFocused();
  await expectWcagAA(page, "medical claim submission controls");
  expect(prepared).toBe(0);

  const reviewCard = page.locator("#medical-review");
  const claim = reviewCard.getByRole("textbox", { name: "Medical claim ID" });
  await claim.fill("??");
  await reviewCard.getByRole("button", { name: "Load medical case" }).press("Enter");
  await expect(reviewCard.getByRole("status").filter({ hasText: "Enter a valid claim ID" })).toBeVisible();
  await claim.fill(claimId);
  await reviewCard.getByRole("button", { name: "Load medical case" }).press("Enter");
  await expect(reviewCard.getByText("Remaining cover at submission", { exact: true })).toBeVisible();
  await expect(reviewCard.getByRole("button", { name: "File medical appeal" })).toHaveCount(0);

  // The retained seed has no rejected case. Present a browser-only synthetic
  // appeal fixture derived from a permitted real read, with POST intercepted.
  await page.route("**/api/medical/review?claim=" + claimId, async route => {
    const response = await route.fetch();
    const body = await response.json();
    const closedAt = "2026-11-24T00:00:00.000Z";
    await route.fulfill({ response, json: { ...body, claim: { ...body.claim, status: "REJECTED", appealCount: 0 },
      review: { id: reviewId, status: "REJECTED", closedAt, assignedAuditorIds: ["auditor1", "auditor2", "auditor3", "auditor4"] },
      ledgerTime: Date.parse("2026-11-25T00:00:00.000Z"), decisions: [{ id: "synthetic-a11y-decision", outcome: "REJECT",
        reasonCode: "INSUFFICIENT_REQUIRED_EVIDENCE" }] } });
  });
  await reviewCard.getByRole("button", { name: "Load medical case" }).press("Enter");
  const submitAppeal = reviewCard.getByRole("button", { name: "File medical appeal" });
  await expect(submitAppeal).toBeDisabled();
  const dispute = reviewCard.getByRole("combobox", { name: "Disputed rejection" });
  await dispute.press("ArrowDown");
  await dispute.press("Tab");
  const explanation = reviewCard.getByRole("textbox", { name: "What changed?" });
  await expect(explanation).toBeFocused();
  await explanation.fill("Synthetic document supplies missing material.");
  const chooser = page.waitForEvent("filechooser");
  await reviewCard.getByLabel("New appeal document").press("Enter");
  await (await chooser).setFiles({ name: "synthetic-appeal.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic evidence") });
  await expect(reviewCard.getByLabel("New appeal document")).toBeFocused();
  await expect(submitAppeal).toBeEnabled();
  await submitAppeal.press("Enter");
  await expect(reviewCard.getByRole("status").filter({ hasText: "Refresh the case" })).toBeVisible();
  await expectWcagAA(page, "medical appeal and status feedback");

  await page.goto("/workspace/policyholder/documents");
  const encrypted = await encryptEvidenceBytes(invoicePDF("MED-250", "2026-11-24", "125.50"), passphrase, { claimId, evidenceId });
  await page.route("**/api/evidence/" + evidenceId, route => route.fulfill({ body: Buffer.from(encrypted.envelope),
    headers: { "x-evidence-claim-id": claimId, "x-content-sha256": encrypted.contentHash, "x-evidence-access-id": "synthetic-a11y-access" } }));
  const retrieval = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Retrieve and decrypt evidence" }) });
  await retrieval.getByRole("textbox", { name: "Evidence ID", exact: true }).fill(evidenceId);
  await retrieval.getByLabel("Evidence passphrase").fill(passphrase);
  await retrieval.getByRole("button", { name: "Retrieve and decrypt" }).press("Enter");
  const pageNumber = retrieval.getByRole("spinbutton", { name: "Page" });
  const extract = retrieval.getByRole("button", { name: "Extract invoice fields" });
  await pageNumber.fill("11");
  await pageNumber.press("Tab");
  await expect(extract).toBeFocused();
  await extract.press("Enter");
  await expect(retrieval.getByRole("status").filter({ hasText: "page number from 1 to 10" })).toBeVisible();
  await pageNumber.fill("1");
  await extract.press("Enter");
  await expect(retrieval.getByRole("textbox", { name: "Invoice number" })).toHaveValue("MED-250", { timeout: 60_000 });
  await expectWcagAA(page, "OCR confirmation");
  const download = page.waitForEvent("download");
  await retrieval.getByRole("button", { name: "Confirm fields and download private receipt" }).press("Enter");
  await download;
  await expect(retrieval.getByRole("status").filter({ hasText: "Confirmation recorded" })).toBeVisible();
});
