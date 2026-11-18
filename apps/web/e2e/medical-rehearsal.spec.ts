import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const roles = {
  insurer: ["Insurer Administrator", "insurer"],
  hospital: ["Dhaka Central Medical Hospital", "hospital"],
  holder: ["Policyholder One", "policyholder"],
  bank: ["Bangladesh Demo Commercial Bank", "bank"],
  auditor1: ["Independent Auditor One", "auditor"],
  auditor2: ["Independent Auditor Two", "auditor"],
  auditor3: ["Independent Auditor Three", "auditor"],
  auditor4: ["Independent Auditor Four", "auditor"],
} as const;

const governed = process.env.MEDICAL_REVIEW_LIVE === "true";

function day(offset: number) {
  return new Date(Date.now() + 6 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

test(governed ? "live medical clarification, review, appeal and OCR through one Bank payout" : "ordinary medical browser journey through one Bank payout", async ({ page }, info) => {
  test.setTimeout(900_000);
  const health = await page.request.get("/api/fabric/health");
  expect(health.ok(), await health.text()).toBe(true);
  expect(await health.json()).toMatchObject({ channel: "insurance-medical-reimbursement", chaincode: "insurance-contract", schemaVersion: 15 });

  const suffix = randomUUID().slice(0, 12);
  const id = (prefix: string) => "med-" + prefix + "-" + suffix;
  const start = day(-1), service = day(0), firstEnd = day(28), end = day(59);
  const journal: unknown[] = [];
  const errors: string[] = [];
  const priorClaimId = process.env.MEDICAL_PRIOR_CLAIM_ID;
  let role: keyof typeof roles | undefined;
  page.on("pageerror", error => errors.push(error.message));
  async function login(next: keyof typeof roles) {
    if (role === next) return;
    if (role) await page.getByRole("button", { name: "Sign out", exact: true }).click();
    else await page.goto("/workspace");
    await page.getByRole("button", { name: "Sign in as " + roles[next][0], exact: true }).click();
    await expect(page).toHaveURL(new RegExp("/workspace/" + roles[next][1] + "$"));
    await expect(page.getByRole("heading", { name: roles[next][0], exact: true })).toBeVisible();
    role = next;
  }

  async function postFromButton(button: ReturnType<typeof page.getByRole>, path = "/api/workflows", status = 200) {
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "POST", { timeout: 150_000 });
    await button.click();
    const response = await pending;
    const body = await response.json();
    journal.push({ actor: role, path, status: response.status(), result: body.result, message: body.message });
    expect(response.status(), JSON.stringify(body)).toBe(status);
    if (path === "/api/workflows" && await button.count()) await expect(button).toBeEnabled({ timeout: 120_000 });
    return body.result;
  }

  async function form(operation: string, input: Record<string, string>, status = 200) {
    console.log(role + " " + operation);
    const card = page.locator("#guided-workflow");
    if (role !== "hospital") {
      const selector = card.getByLabel("Workflow action");
      if (await selector.inputValue() !== operation) await selector.selectOption(operation);
    }
    for (const [name, value] of Object.entries(input)) {
      const field = card.locator('[name="' + name + '"]');
      await expect(field).toBeVisible();
      if (await field.evaluate(element => element.tagName === "SELECT")) await field.selectOption(value);
      else await field.fill(value);
    }
    return postFromButton(card.getByRole("button", { name: /^(Save intake|Submit verified transaction|Submit bank instruction)$/ }), "/api/workflows", status);
  }

  async function assets(type: string) {
    const response = await page.request.get("/api/ledger/" + type);
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).result;
  }

  async function asset(type: string, key: string) {
    const response = await page.request.get("/api/ledger/" + type + "/" + encodeURIComponent(key));
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).result;
  }

  const reviewCard = page.locator("#medical-review");
  async function loadReview(claimId: string) {
    await reviewCard.getByLabel("Medical claim ID").fill(claimId);
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/medical/review" && response.request().method() === "GET");
    await reviewCard.getByRole("button", { name: "Load medical case" }).click();
    const response = await pending;
    expect(response.ok(), await response.text()).toBe(true);
    const detail = await response.json();
    await expect(reviewCard.getByText(`Claim version ${detail.claim.version} · ${detail.claim.status}`)).toBeVisible();
    return detail;
  }

  async function reviewAction(name: string, status = 200) {
    console.log(role + " " + name);
    const outcome = await postFromButton(reviewCard.getByRole("button", { name, exact: true }), "/api/medical/review", status);
    if (status === 200) await expect(reviewCard.getByRole("status")).toHaveText("Action confirmed.", { timeout: 80_000 });
    return outcome;
  }

  async function freshVerification(claimId: string, version: number, appealId?: string) {
    const request = await form("startClaimProcessing", { claimId });
    expect(request).toMatchObject({ claimId, claimVersion: version, modelVersion: "fabric-xgb-synthetic-v1", requiredConfirmations: 2, expectedResponses: 3 });
    if (appealId) expect(request).toMatchObject({ appealId });
    await expect.poll(async () => (await asset("claim", claimId)).status, { timeout: 200_000, intervals: [2000] }).toMatch(/^(ORACLE_FAILED|MEDICAL_REVIEW_REQUIRED)$/);
    const results = (await assets("oracle-result") as { requestId: string; verificationCode: string; resultHash: string }[]).filter(result => result.requestId === request.id);
    expect(results.some((result, n) => results.slice(n + 1).some(other => other.resultHash === result.resultHash))).toBe(true);
    journal.push({ request, results });
    return results;
  }

  type FixtureFile = { name: string; mimeType: string; buffer: Buffer };
  const passphrase = "Live-synthetic-document-passphrase";
  async function uploadDocument(claimId: string, evidenceId: string, documentType: string, file: FixtureFile, version: number) {
    const upload = page.locator("article").filter({ has: page.getByRole("heading", { name: "Encrypt, store, and anchor evidence" }) });
    const fields = { "Claim ID": claimId, "Evidence ID": evidenceId, "Document type": documentType, "Evidence passphrase": passphrase, "Confirm passphrase": passphrase };
    for (const [label, value] of Object.entries(fields)) await upload.getByLabel(label, { exact: true }).fill(value);
    await upload.getByLabel("Original file").setInputFiles(file);
    await upload.getByRole("button", { name: "Encrypt in browser" }).click();
    await expect(upload.getByText("Ciphertext ready", { exact: true })).toBeVisible();
    const result = await postFromButton(upload.getByRole("button", { name: "Store ciphertext and record reference" }), "/api/evidence");
    expect(result).toMatchObject({ id: evidenceId, claimId, claimVersion: version, documentType });
  }

  const panel = ["auditor1", "auditor2", "auditor3", "auditor4"] as const;
  async function confirmReviewDocuments(claimId: string, documentIds: string[], ocrEvidenceId?: string) {
    const retrieval = page.locator("article").filter({ has: page.getByRole("heading", { name: "Retrieve and decrypt evidence" }) });
    for (const auditor of panel) {
      await login(auditor);
      await loadReview(claimId);
      for (const evidenceId of documentIds) {
        await reviewCard.getByRole("listitem").filter({ hasText: evidenceId }).getByRole("button", { name: "Open granted evidence" }).click();
        await retrieval.getByLabel("Evidence passphrase", { exact: true }).fill(passphrase);
        const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/evidence/" + evidenceId);
        await retrieval.getByRole("button", { name: "Retrieve and decrypt" }).click();
        const response = await responsePromise;
        expect(response.status(), response.ok() ? evidenceId : await response.text()).toBe(200);
        await expect(retrieval.getByRole("link", { name: "Download verified plaintext" })).toBeVisible();
        const accessId = response.headers()["x-evidence-access-id"];
        const reviewId = response.headers()["x-evidence-medical-review-id"];
        expect(accessId).toBeTruthy();
        expect(reviewId).toBeTruthy();
        if (auditor === "auditor1" && evidenceId === ocrEvidenceId) {
          await retrieval.getByRole("button", { name: "Extract invoice fields" }).click();
          await expect(retrieval.getByLabel("Invoice number", { exact: true })).toHaveValue("MED-250", { timeout: 90_000 });
          await expect(retrieval.getByLabel("Documented service date")).toHaveValue(service);
          await expect(retrieval.getByLabel("Invoice total in BDT")).toHaveValue("950.00");
          await retrieval.getByLabel("Invoice total in BDT").fill("950.01");
          const downloaded = page.waitForEvent("download", { timeout: 120_000 });
          const confirmed = page.waitForResponse(r => new URL(r.url()).pathname === "/api/medical/review" && r.request().method() === "POST");
          await retrieval.getByRole("button", { name: "Confirm fields and download private receipt" }).click();
          const [receipt, confirmation] = await Promise.all([downloaded, confirmed]);
          expect(confirmation.status()).toBe(200);
          const sent = confirmation.request().postDataJSON();
          const source = { evidenceId, sourceHash: response.headers()["x-content-sha256"], engineVersion: "tesseract-7.0.0:eng-4.0.0-best-int" };
          expect(sent).toMatchObject({ action: "recordOCR", accessId, ...source });
          expect(sent.suggestionsHash).not.toBe(sent.confirmedHash);
          expect(receipt.suggestedFilename()).toBe(`ocr-review-${evidenceId}.json`);
          expect(JSON.parse(await readFile(await receipt.path(), "utf8"))).toMatchObject({
            ...source, suggestions: { totalBdt: "950.00" }, confirmed: { totalBdt: "950.01" },
          });
          const projectionPath = process.env.MEDICAL_EVENT_PROJECTION_PATH;
          if (projectionPath) {
            const committed = { id: sent.id, claimId, claimVersion: 2, confirmedBy: auditor, ...source,
              suggestionsHash: sent.suggestionsHash, confirmedHash: sent.confirmedHash };
            await expect.poll(async () => {
              const projection = JSON.parse(await readFile(projectionPath, "utf8"));
              return projection.events.find((event: { eventName: string; payload: { id: string } }) =>
                event.eventName === "MedicalOCRConfirmed" && event.payload.id === sent.id);
            }, { timeout: 45_000 }).toMatchObject({ payload: committed });
          }
          journal.push({ actor: role, action: "recordOCR", ...source, receiptId: sent.id });
        }
        expect(await postFromButton(retrieval.getByRole("button", { name: "Confirm decryption for this review" }), "/api/medical/review"))
          .toMatchObject({ reviewId, evidenceId, auditorId: auditor, accessId });
      }
      if (auditor === "auditor3") {
        await login("insurer");
        await loadReview(claimId);
        await reviewAction("Open voting for 24 hours", 409);
        await expect(reviewCard.getByRole("status")).toContainText(/confirm decryption/i);
      }
    }
  }

  function hospitalFields(revision: number, billBdt: string) {
    return { episodeReference: id("episode"), expectedRevision: String(revision), patientReference: id("patient"),
      service: "SURGERY", admissionDate: service, dischargeDate: service, serviceDate: service, billBdt, invoiceDate: service, diagnosisCode: "" };
  }

  try {
    if (governed) {
      await login("insurer");
      await expect(reviewCard.getByRole("heading", { name: "Medical review and appeal" })).toBeVisible();
      if (priorClaimId) expect(await asset("claim", priorClaimId)).toMatchObject({ status: "SETTLED", amountMinor: 4000 });
    }
    await test.step("register partners and publish the medical policy", async () => {
      await login("insurer");
      const existing = await assets("partner-agreement") as { partnerId: string; status: string }[];
      for (const [partnerType, partnerId, name] of [
        ["HOSPITAL", "hospital-demo", "Synthetic Hospital"],
        ["BANK", "bank-demo", "Synthetic Bank"],
      ]) {
        if (existing.some(row => row.partnerId === partnerId && row.status === "ACTIVE")) continue;
        await form("createPartnerAgreement", { id: id(partnerId), partnerType, partnerId, name,
          location: "Dhaka", tier: "Preferred", accessScope: "Synthetic rehearsal only", effectiveDate: day(-30), expiryDate: day(365) });
      }
      await form("createPolicyPackage", { id: id("package"), name: "Medical Reimbursement " + suffix,
        description: "Isolated synthetic reimbursement", premiumBdt: "1.00", coverageLimitBdt: "40.00", termsText: id("terms") });
      await form("configurePolicyPackagePartners", { id: id("package"), hospitalIdsJson: '["hospital-demo"]', bankIdsJson: '["bank-demo"]' });
      await form("configureMedicalRules", { packageId: id("package"), service: "SURGERY", sublimit: "80.00",
        deductibleBps: "1000", deductibleCap: "10.00", shareBps: "8000", waitingDays: "0", filingDays: "30", evidenceRequired: "No" });
      await form("publishPolicyPackage", { id: id("package") });
    });

    await test.step("accept policy terms and pay the first installment with OTP", async () => {
      await login("bank");
      for (const [name, ownerId, accountType, openingBalanceBdt] of [
        ["customer", "policyholder1", "CUSTOMER", "100.00"],
        ["premium", "insurer", "INSURER", "0.00"],
        ["reserve", "insurer", "INSURER", "100.00"],
      ]) await form("openBankAccount", { id: id(name), bankId: "bank-demo", ownerId, accountType,
        accountLabel: "Synthetic medical " + name, maskedAccount: "**** 1234", openingBalanceBdt, accountTokenText: id("token-" + name) });
      await login("holder");
      const offer = page.locator("#guided-workflow");
      await offer.getByLabel("Workflow action").selectOption("acquireMedicalPolicy");
      await offer.getByRole("button", { name: "Load published packages" }).click();
      await offer.getByLabel("Medical package").selectOption(id("package"));
      await expect(offer.getByText(/BDT 40.00 is payable/)).toBeVisible();
      await offer.getByLabel("I accept these published terms").check();
      const policy = await form("acquireMedicalPolicy", { id: id("policy"), startDate: start, endDate: end });
      expect(policy).toMatchObject({ status: "PENDING_PAYMENT", coverageLimitMinor: 4000, medicalRulesVersion: 1 });
      const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Pay with one-time authorization", exact: true }) });
      for (const [label, value] of Object.entries({ "Policy ID": id("policy"), "Customer account ID": id("customer"),
        "Insurer account ID": id("premium"), "Transfer ID": id("otp-transfer"), "Payment ID": id("otp-payment"),
        "Period starts": start, "Period ends": firstEnd, "Premium (BDT)": "1.00", "External bank receipt": id("otp-reference") })) {
        await card.getByLabel(label, { exact: true }).fill(value);
      }
      await card.getByRole("button", { name: "Email OTP", exact: true }).click();
      const code = card.locator(".evidenceWarning strong");
      await expect(code).toHaveText(/^\d{6}$/);
      await card.getByLabel("Six-digit OTP", { exact: true }).fill((await code.textContent())!);
      await postFromButton(card.getByRole("button", { name: "Authorize premium", exact: true }), "/api/banking/premium-payment");
      expect(await asset("policy", id("policy"))).toMatchObject({ status: "ACTIVE", paidThroughDate: firstEnd });
    });

    let claimId = "";
    let episodeId = "";
    await test.step("intake stays hidden until verified and the quote is pinned to the submitted claim", async () => {
      await login("hospital");
      await expect(page.locator("#guided-workflow").getByLabel("Workflow action")).toHaveCount(0);
      const forbidden = await page.request.post("/api/workflows", { data: { operation: "recordHospitalModelFacts",
        invoiceId: id("hospital-model"), treatmentType: "SURGERY", diagnosisCode: "", invoiceDate: service,
        expectedMinMinor: 1, expectedMaxMinor: 2, licenseStatus: "ACTIVE" } });
      expect(forbidden.status()).toBe(403);
      expect(await forbidden.json()).toMatchObject({ message: "Hospital accounts can only save factual episode intake." });
      const episode = await form("saveMedicalEpisode", hospitalFields(0, governed ? "950.00" : "500.00"));
      episodeId = episode.id;
      await login("holder");
      const discovery = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Your medical episodes", exact: true }) });
      await discovery.getByRole("button", { name: "Refresh episodes" }).click();
      await expect(discovery.getByLabel("Verified episode").locator('option[value="' + episode.id + '"]')).toHaveCount(0);
      await login("insurer");
      const queue = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Episode association queue", exact: true }) });
      await queue.getByRole("button", { name: "Refresh episodes" }).click();
      await expect(queue.getByRole("button", { name: "Resolve association" }).first()).toBeVisible();
      await form("verifyMedicalAssociation", { episodeId: episode.id, revision: "1", beneficiaryId: "policyholder1",
        decisionBasis: id("verified-synthetic-match"), associationDecision: "VERIFY" });
      const registry = await page.request.get("/api/medical/intake");
      expect(registry.ok()).toBe(true);
      expect((await registry.json()).episodes.find((row: { id: string }) => row.id === episode.id)).toMatchObject({ associationStatus: "VERIFIED" });

      // The benchmark is an immutable synthetic fixture local to this channel.
      if (process.env.MEDICAL_BENCHMARK_EXISTS !== "true") {
        await form("registerMedicalOracleBenchmark", { hospitalId: "hospital-demo", service: "SURGERY", minimum: "250.00", maximum: "750.00",
          licenseStatus: "ACTIVE", sourceReference: "Synthetic benchmark range for documented BDT 500 surgery fixture" });
      }
      await login("holder");
      await discovery.getByRole("button", { name: "Refresh episodes" }).click();
      await discovery.getByLabel("Medical policy").selectOption(id("policy"));
      await discovery.getByLabel("Verified episode").selectOption(episode.id);
      const receipt = await postFromButton(discovery.getByRole("button", { name: "Prepare claim and calculate reimbursement" }));
      await expect(discovery.getByText(/Eligible BDT 80.00 · Deductible BDT 8.00 · Insurer share BDT 57.60/)).toBeVisible();
      await expect(discovery.getByText("Payable BDT 40.00", { exact: true })).toBeVisible();
      await info.attach("reimbursement-statement", { body: await discovery.innerText(), contentType: "text/plain" });
      const claim = await postFromButton(discovery.getByRole("button", { name: "Accept statement and submit claim" }));
      expect(claim).toMatchObject({ id: receipt.id, version: 1, amountMinor: 4000, episodeId: episode.id, episodeRevision: 1 });
      claimId = claim.id;
    });

    if (governed) await test.step("clarification, four-auditor decryption, OCR and corrected appeal", async () => {
      await login("insurer");
      const initialResults = await freshVerification(claimId, 1);
      expect(initialResults.some(result => result.verificationCode.startsWith("XGB_REVIEW:"))).toBe(true);
      await loadReview(claimId);
      const initial = await reviewAction("Prepare four-auditor review");
      expect(initial).toMatchObject({ assignedAuditorIds: panel, approvalThreshold: 3, rejectionThreshold: 2 });
      await reviewCard.getByLabel("Clarification question and requested evidence").fill("Please provide the itemized synthetic invoice.");
      await reviewAction("Send clarification");
      await expect(reviewCard.getByRole("button", { name: "Open voting for 24 hours" })).toBeDisabled();

      await login("holder");
      await loadReview(claimId);
      await expect(reviewCard.getByText(/Please provide the itemized synthetic invoice/)).toBeVisible();
      const image = await page.evaluate(date => {
        const canvas = document.createElement("canvas");
        canvas.width = 1000;
        canvas.height = 330;
        const brush = canvas.getContext("2d")!;
        brush.fillStyle = "white";
        brush.fillRect(0, 0, canvas.width, canvas.height);
        brush.fillStyle = "black";
        brush.font = "42px Arial";
        ["Invoice number: MED-250", "Service date: " + date, "Total due: BDT 950.00"].forEach((text, i) => brush.fillText(text, 50, 85 + i * 82));
        return canvas.toDataURL("image/png").split(",")[1];
      }, service);
      const invoice = { name: "itemized-invoice.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") };
      await reviewCard.getByLabel("Response type").selectOption("MATERIAL");
      await reviewCard.getByLabel("Clarification response", { exact: true }).fill("The itemized invoice is attached.");
      await reviewCard.getByLabel("New clarification document").setInputFiles(invoice);
      expect(await reviewAction("Send response")).toMatchObject({ id: claimId, version: 2, status: "SUBMITTED" });
      const invoiceId = id("clarification");
      await uploadDocument(claimId, invoiceId, "CLARIFICATION_DOCUMENT", invoice, 2);

      await login("insurer");
      const clarificationResults = await freshVerification(claimId, 2);
      expect(clarificationResults.some(result => result.verificationCode.startsWith("XGB_REVIEW:"))).toBe(true);
      await loadReview(claimId);
      const returned = await reviewAction("Prepare four-auditor review");
      expect(returned).toMatchObject({ assignedAuditorIds: panel, medicalVersion: 2 });
      expect(await asset("review", initial.id)).toMatchObject({ status: "SUPERSEDED" });
      await expect(reviewCard.getByRole("button", { name: "Send clarification" })).toHaveCount(0);
      await login("holder");
      await loadReview(claimId);
      const initialGrants = await reviewAction("Grant listed evidence to these four reviewers");
      expect(initialGrants).toHaveLength(4);
      await confirmReviewDocuments(claimId, [invoiceId], invoiceId);
      await login("insurer");
      await loadReview(claimId);
      await reviewAction("Open voting for 24 hours");

      let disputed = "";
      for (const auditor of panel.slice(0, 2)) {
        await login(auditor);
        await loadReview(claimId);
        await reviewCard.getByLabel("Decision reason").selectOption("INSUFFICIENT_REQUIRED_EVIDENCE");
        await reviewCard.getByLabel("Reason reference").fill("The itemization does not substantiate the out-of-range synthetic bill.");
        const rejected = await reviewAction("Record reasoned vote");
        disputed = rejected.id;
      }
      expect(await asset("claim", claimId)).toMatchObject({ status: "REJECTED" });

      await login("hospital");
      expect(await form("saveMedicalEpisode", hospitalFields(1, "500.00"))).toMatchObject({ id: episodeId, revision: 2 });
      await login("insurer");
      await form("verifyMedicalAssociation", { episodeId, revision: "2", beneficiaryId: "policyholder1",
        decisionBasis: id("verified-corrected-source"), associationDecision: "VERIFY" });

      await login("holder");
      await loadReview(claimId);
      await reviewCard.getByLabel("Disputed rejection").selectOption(disputed);
      await reviewCard.getByLabel("What changed?").fill("The hospital corrected the billed amount to BDT 500.00 in episode revision 2.");
      const newFile = { name: "corrected-supplement.txt", mimeType: "text/plain", buffer: Buffer.from(`Synthetic corrected BDT 500.00 itemization ${service} · ${suffix}`) };
      await reviewCard.getByLabel("New appeal document").setInputFiles(newFile);
      await reviewCard.getByLabel("Corrected episode revision (optional)").fill("2");
      await reviewCard.getByRole("button", { name: "Calculate corrected reimbursement" }).click();
      await expect(reviewCard.getByText(/Corrected payable amount BDT 40.00/)).toBeVisible();
      const appeal = await reviewAction("File medical appeal");
      expect(appeal).toMatchObject({ claimVersion: 3, disputedDecisionId: disputed, medicalPriorReviewId: returned.id });
      const appealDocument = id("appeal-document");
      await uploadDocument(claimId, appealDocument, "APPEAL_DOCUMENT", newFile, 3);

      await login("insurer");
      const appealResults = await freshVerification(claimId, 3, appeal.id);
      expect(appealResults.some(result => /^XGB_(AUTO|REVIEW):/.test(result.verificationCode))).toBe(true);
      await loadReview(claimId);
      const reopened = await reviewAction("Prepare four-auditor review");
      expect(reopened).toMatchObject({ assignedAuditorIds: panel, medicalVersion: 3 });
      await login("auditor1");
      const oldGrant = initialGrants.find((grant: { granteeSubject: string }) => grant.granteeSubject === "auditor1");
      expect(oldGrant).toBeDefined();
      const stale = await page.request.post(`/api/evidence/${invoiceId}`, { data: { grantId: oldGrant.id } });
      expect(stale.status(), await stale.text()).toBe(403);
      await login("holder");
      const detail = await loadReview(claimId);
      const currentIds = detail.documents.map((doc: { id: string }) => doc.id);
      expect(currentIds).toContain(appealDocument);
      expect(await reviewAction("Grant listed evidence to these four reviewers")).toHaveLength(4 * currentIds.length);
      await confirmReviewDocuments(claimId, currentIds);
      await login("insurer");
      await loadReview(claimId);
      await reviewAction("Open voting for 24 hours");
      for (const auditor of panel.slice(0, 3)) {
        await login(auditor);
        await loadReview(claimId);
        await reviewCard.getByLabel("Reason reference").fill("Verified corrected amount, decrypted evidence and issued terms.");
        await reviewAction("Record reasoned vote");
      }
      expect(await asset("claim", claimId)).toMatchObject({ version: 3, status: "APPROVED", amountMinor: 4000 });
    });

    await test.step("pinned matching Oracle results and exactly one committed payout", async () => {
      await login("insurer");
      if (!governed) {
      const request = await form("startClaimProcessing", { claimId });
      expect(request).toMatchObject({ claimId, claimVersion: 1, modelVersion: "fabric-xgb-synthetic-v1", requiredConfirmations: 2, expectedResponses: 3 });
      await expect.poll(async () => (await asset("claim", claimId)).status, { timeout: 240_000, intervals: [2000] }).toMatch(/^(APPROVED|ORACLE_FAILED)$/);
      const results = (await assets("oracle-result") as { requestId: string; verificationCode: string; resultHash: string }[]).filter(result => result.requestId === request.id);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some((result, n) => results.slice(n + 1).some(other => other.resultHash === result.resultHash))).toBe(true);
      journal.push({ request, results });
      const claim = await asset("claim", claimId);
      if (claim.status === "ORACLE_FAILED") {
        expect(results.some(result => result.verificationCode.startsWith("XGB_REVIEW:")), JSON.stringify(results)).toBe(true);
        await form("routeOracleFailureToReview", { requestId: request.id, reviewId: id("review"),
          assignedAuditorIdsJson: '["auditor1","auditor2","auditor3","auditor4"]', approvalThreshold: "3", rejectionThreshold: "2",
          deadline: new Date(Date.now() + 3_600_000).toISOString() });
        for (const auditor of ["auditor1", "auditor2", "auditor3"] as const) {
          await login(auditor);
          await form("recordAuditorDecision", { reviewId: id("review"), decisionId: id(auditor), outcome: "APPROVE",
            reasonText: "Synthetic structured record confirms the published reimbursement basis" });
        }
        await login("insurer");
        expect((await asset("claim", claimId)).status).toBe("APPROVED");
      } else {
        expect(results.some(result => result.verificationCode.startsWith("XGB_AUTO:")), JSON.stringify(results)).toBe(true);
      }
      }
      await form("authorizeSettlement", { settlementId: id("settlement"), claimId, sourceAccountId: id("reserve"), destinationAccountId: id("customer") });
      await login("bank");
      expect((await asset("account", id("customer"))).balanceMinor).toBe(9900);
      const payout = { settlementId: id("settlement"), transferId: id("payout"), bankReferenceText: id("bank-receipt") };
      expect(await form("confirmSettlement", payout)).toMatchObject({ status: "CONFIRMED", amountMinor: 4000 });
      await form("confirmSettlement", { ...payout, transferId: id("duplicate") }, 409);
      expect((await asset("account", id("customer"))).balanceMinor).toBe(13900);
      expect((await asset("account", id("reserve"))).balanceMinor).toBe(6000);
      const transfers = (await assets("bank-transfer") as { settlementId: string; status: string; id: string }[]).filter(row => row.settlementId === id("settlement"));
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({ id: id("payout"), status: "SETTLED" });
      await login("holder");
      expect(await asset("claim", claimId)).toMatchObject({ status: "SETTLED", amountMinor: 4000 });
      if (governed && priorClaimId) expect(await asset("claim", priorClaimId)).toMatchObject({ status: "SETTLED", amountMinor: 4000 });
      await info.attach("settled-workspace", { body: await page.screenshot(), contentType: "image/png" });
      expect(errors).toEqual([]);
    });
  } finally {
    await info.attach("fabric-rehearsal-journal", { body: JSON.stringify({ suffix, start, service, end, journal, errors }, null, 2), contentType: "application/json" });
  }
});
