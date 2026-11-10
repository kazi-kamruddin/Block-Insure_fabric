import { expect, test } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

test("@rehearsal-evidence-recovery lost real committed upload response recovers original ciphertext and one ledger reference", async ({ page }, info) => {
  test.setTimeout(240000);
  if (process.env.FABRIC_CHANNEL_NAME !== "insurance-workflow-alignment-20261108") throw new Error("Exact isolated candidate required");
  const suffix = randomUUID(), policyId = `ui-recover-policy-${suffix}`, invoiceId = `ui-recover-invoice-${suffix}`;
  const claimId = `ui-recover-claim-${suffix}`, evidenceId = `ui-recover-evidence-${suffix}`;
  let signedIn = false;
  async function login(name: string) {
    if (signedIn) await page.getByRole("button", { name: "Sign out", exact: true }).click();
    else await page.goto("/workspace");
    await page.getByRole("button", { name: `Sign in as ${name}`, exact: true }).click();
    const workspace = name === "Insurer Administrator" ? "insurer" : name === "Policyholder One" ? "policyholder" : "hospital";
    await expect(page).toHaveURL(new RegExp(`/workspace/${workspace}$`));
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    signedIn = true;
  }
  async function form(operation: string, values: Record<string, string>) {
    console.log(`UI evidence recovery: ${operation}`);
    const card = page.locator("#guided-workflow"); await card.getByLabel("Workflow action").selectOption(operation);
    for (const [name, value] of Object.entries(values)) {
      const field = card.locator(`[name="${name}"]`);
      await expect(field).toBeVisible({ timeout: 15000 });
      if (await field.evaluate(element => element.tagName) === "SELECT") await field.selectOption(value); else await field.fill(value);
    }
    const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/workflows") && response.request().method() === "POST", { timeout: 120000 });
    await card.getByRole("button", { name: /^(Submit verified transaction|Save invoice record)$/ }).click();
    const response = await responsePromise; expect(response.status(), await response.text()).toBe(200);
    await expect(card.getByRole("button", { name: /^(Submit verified transaction|Save invoice record)$/ })).toBeEnabled();
  }
  await login("Insurer Administrator");
  await form("issuePolicy", { id: policyId, packageId: "showcase-health-v1", policyholderId: "policyholder1", startDate: "2026-01-01", endDate: "2026-12-31" });
  await login("Dhaka Central Medical Hospital");
  await form("createHospitalInvoice", { id: invoiceId, patientReferenceText: "policyholder1", invoiceReferenceText: invoiceId, treatmentText: "Synthetic recovery surgery", amountBdt: "500.00", admissionDate: "2026-01-15", dischargeDate: "2026-01-15", status: "FINALIZED" });
  await form("recordHospitalModelFacts", { invoiceId, treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: "2026-01-15", expectedMinBdt: "250.00", expectedMaxBdt: "750.00", licenseStatus: "ACTIVE" });
  await login("Policyholder One");
  await form("submitClaim", { id: claimId, policyId, hospitalInvoiceId: invoiceId, amountBdt: "250.00", incidentDate: "2026-01-15", descriptionText: "Synthetic real committed upload response loss" });
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Encrypt, store, and anchor evidence", exact: true }) });
  const text = "Synthetic real browser upload recovery invoice", passphrase = "synthetic real recovery passphrase";
  await card.getByLabel("Claim ID", { exact: true }).fill(claimId); await card.getByLabel("Evidence ID", { exact: true }).fill(evidenceId);
  await card.getByLabel("Document type", { exact: true }).fill("INVOICE");
  await card.getByLabel("Original file").setInputFiles({ name: "synthetic-invoice.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await card.getByLabel("Evidence passphrase", { exact: true }).fill(passphrase); await card.getByLabel("Confirm passphrase").fill(passphrase);
  await card.getByRole("button", { name: "Encrypt in browser", exact: true }).click(); await expect(card.getByText("Ciphertext ready", { exact: true })).toBeVisible();
  let original: { result: { id: string }; ciphertextHash: string; recovered?: boolean } | undefined;
  // The real server commits first. Only the browser's response is discarded.
  await page.route("**/api/evidence", async route => {
    const response = await route.fetch(); expect(response.status(), await response.text()).toBe(200);
    original = await response.json(); expect(original?.recovered).not.toBe(true); await route.abort("connectionreset");
  });
  await card.getByRole("button", { name: "Store ciphertext and record reference", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("Upload outcome unresolved", { timeout: 120000 }); expect(original?.result.id).toBe(evidenceId);
  await expect(card.getByLabel("Evidence ID", { exact: true })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Encrypt in browser", exact: true })).toBeDisabled();
  await page.unroute("**/api/evidence");
  const recoveryPromise = page.waitForResponse(response => response.url().endsWith("/api/evidence") && response.request().method() === "POST", { timeout: 120000 });
  await card.getByRole("button", { name: "Retry original ciphertext", exact: true }).click();
  const recoveryResponse = await recoveryPromise; expect(recoveryResponse.status()).toBe(200); const recovered = await recoveryResponse.json();
  expect(recovered).toMatchObject({ result: original!.result, ciphertextHash: original!.ciphertextHash, recovered: true });
  await expect(card.getByRole("status")).toContainText("linked to the current claim version");
  const claimResponse = await page.request.get(`/api/ledger/claim/${claimId}`); expect(claimResponse.status()).toBe(200);
  expect((await claimResponse.json()).result.evidenceIds.filter((id: string) => id === evidenceId)).toHaveLength(1);
  const retrieval = page.locator("article").filter({ has: page.getByRole("heading", { name: "Retrieve and decrypt evidence", exact: true }) });
  await retrieval.getByLabel("Evidence ID", { exact: true }).fill(evidenceId); await retrieval.getByLabel("Evidence passphrase", { exact: true }).fill(passphrase);
  await retrieval.getByRole("button", { name: "Retrieve and decrypt", exact: true }).click();
  const plaintext = retrieval.getByRole("link", { name: "Download verified plaintext" }); await expect(plaintext).toBeVisible({ timeout: 120000 });
  const downloadPromise = page.waitForEvent("download"); await plaintext.click(); const filename = await (await downloadPromise).path();
  if (!filename) throw new Error("Verified plaintext download missing"); expect(await readFile(filename, "utf8")).toBe(text);
  await info.attach("real-evidence-response-loss", { body: JSON.stringify({ channel: process.env.FABRIC_CHANNEL_NAME, authenticationSetup: "visible sign-in cards; business mutations via visible forms", policyId, claimId, evidenceId, original, recovered, plaintextSha256: createHash("sha256").update(text).digest("hex"), evidenceReferences: 1 }, null, 2), contentType: "application/json" });
});
