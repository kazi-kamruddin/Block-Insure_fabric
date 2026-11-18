import { expect, test } from "@playwright/test";
import { encryptEvidenceBytes } from "../lib/evidence/browser-crypto";

const passphrase = "offline synthetic invoice passphrase";
const evidenceId = "synthetic-ocr-invoice";
const claimId = "synthetic-ocr-claim";

function invoicePDF() {
  const contents = "BT /F1 26 Tf 45 480 Td (Invoice number: MED-250) Tj 0 -50 Td (Service date: 2026-09-04) Tj 0 -50 Td (Total due: BDT 125.50) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 530 550] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + contents.length + " >>\nstream\n" + contents + "\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((value, index) => {
    const offset = pdf.length;
    pdf += (index + 1) + " 0 obj\n" + value + "\nendobj\n";
    return offset;
  });
  pdf += "xref\n0 6\n0000000000 65535 f \n" + offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("") +
    "trailer << /Size 6 /Root 1 0 R >>\nstartxref\n" + pdf.length + "\n%%EOF\n";
  return new TextEncoder().encode(pdf);
}

test("medical evidence decrypts and OCR runs locally on a PNG and PDF", async ({ page }, info) => {
  test.setTimeout(180_000);
  const external: string[] = [];
  page.context().on("request", req => {
    const url = new URL(req.url());
    if (url.protocol.startsWith("http") && url.origin !== "http://127.0.0.1:3225") external.push(url.hostname);
  });
  const login = await page.request.post("/api/auth/demo-login", { data: { accountId: "policyholder-1" } });
  expect(login.ok()).toBe(true);
  await page.goto("/workspace/policyholder");

  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000; canvas.height = 330;
    const brush = canvas.getContext("2d")!;
    brush.fillStyle = "white"; brush.fillRect(0, 0, 1000, 330);
    brush.fillStyle = "black"; brush.font = "42px Arial";
    ["Invoice number: MED-250", "Service date: 2026-09-04", "Total due: BDT 125.50"].forEach((text, i) => brush.fillText(text, 50, 85 + i * 82));
    return canvas.toDataURL("image/png").split(",")[1];
  });

  const confirmations: Record<string, unknown>[] = [];
  await page.route("**/api/medical/review", async route => {
    confirmations.push(route.request().postDataJSON());
    await route.fulfill({ json: { result: { recorded: true } } });
  });
  for (const [name, bytes] of [["PNG", Uint8Array.from(Buffer.from(image, "base64"))], ["PDF", invoicePDF()]] as const) {
    const encrypted = await encryptEvidenceBytes(bytes, passphrase, { claimId, evidenceId });
    await page.unroute("**/api/evidence/" + evidenceId);
    await page.route("**/api/evidence/" + evidenceId, route => route.fulfill({ body: Buffer.from(encrypted.envelope),
      headers: { "x-evidence-claim-id": claimId, "x-content-sha256": encrypted.contentHash, "x-evidence-access-id": "access-" + name } }));
    const retrieval = page.locator("article").filter({ has: page.getByRole("heading", { name: "Retrieve and decrypt evidence" }) });
    await retrieval.getByLabel("Evidence ID", { exact: true }).fill(evidenceId);
    await retrieval.getByLabel("Evidence passphrase", { exact: true }).fill(passphrase);
    await retrieval.getByRole("button", { name: "Retrieve and decrypt" }).click();
    await retrieval.getByRole("button", { name: "Extract invoice fields" }).click();
    await expect(retrieval.getByLabel("Invoice number", { exact: true })).toHaveValue("MED-250", { timeout: 60_000 });
    await expect(retrieval.getByLabel("Documented service date")).toHaveValue("2026-09-04");
    await expect(retrieval.getByLabel("Invoice total in BDT")).toHaveValue("125.50");
    await retrieval.getByLabel("Invoice total in BDT").fill("125.00");
    const download = page.waitForEvent("download");
    await retrieval.getByRole("button", { name: "Confirm fields and download private receipt" }).click();
    await download;
    const recorded = confirmations.at(-1);
    expect(recorded).toMatchObject({ action: "recordOCR", evidenceId, sourceHash: encrypted.contentHash, accessId: "access-" + name });
    expect(recorded?.suggestionsHash).not.toBe(recorded?.confirmedHash);
    expect(JSON.stringify(recorded)).not.toMatch(/MED-250|125\.00|125\.50/);
    await info.attach("ocr-" + name, { body: await retrieval.screenshot(), contentType: "image/png" });
  }
  expect(external).toEqual([]);
  expect(confirmations).toHaveLength(2);
});
