import { execFile as runProgram } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";
import { expect, test, type APIRequestContext } from "@playwright/test";

const execFile = promisify(runProgram);
const app = "http://127.0.0.1:3219";
const bankId = "bank-demo";
const hospitalId = "hospital-demo";
const premium = 125_000;
const payout = 6_400_000;
const cooldown = 60_100;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const insurerPolicyQuery = String.raw`
set -euo pipefail
[[ "$1" =~ ^[a-zA-Z0-9_-]+$ ]]
org="$PWD/data/dev-lite/organizations/peerOrganizations/insurer.blockinsure.test"
export FABRIC_CFG_PATH="$PWD/network/.fabric/fabric-samples/config"
export CORE_PEER_TLS_ENABLED=true CORE_PEER_LOCALMSPID=InsurerMSP CORE_PEER_ADDRESS=localhost:31051
export CORE_PEER_TLS_ROOTCERT_FILE="$org/peers/peer0.insurer.blockinsure.test/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="$org/users/insurerAdmin@insurer.blockinsure.test/msp"
export CORE_PEER_BCCSP_SW_FILEKEYSTORE_KEYSTORE="$CORE_PEER_MSPCONFIGPATH/keystore"
printf -v args '{"Args":["ReadPolicy","%s"]}' "$1"
"$PWD/network/.fabric/fabric-samples/bin/peer" chaincode query -C insurance-dev-lite-190 -n insurance-contract -c "$args"
`;

type Member = { memberId: string; status: string };
type Payment = { status: string; amountMinor: number; method?: string };
type Claim = { id: string; claimantId: string; policyId: string; episodeId: string; amountMinor: number; status: string; version: number };
type Checkpoint = {
  completed: boolean;
  evidence: { policy?: { id: string; policyholderId: string }; enrollment?: object; episode?: object };
  events: { check: string; status: number }[];
};

function day(offset: number, start?: string) {
  const reference = start ? Date.parse(start + "T00:00:00Z") : Date.now() + 6 * 3_600_000;
  return new Date(reference + offset * 86_400_000).toISOString().slice(0, 10);
}

function localCode(body: { displayCode?: string; demoCode?: string }) {
  const code = body.displayCode ?? body.demoCode ?? "";
  if (!/^\d{6}$/.test(code)) throw new Error("The local no-email verification code was unavailable");
  return code;
}

async function queryInsurerPolicy(repo: string, policyId: string) {
  try {
    const { stdout } = await execFile("wsl.exe", ["-d", "Ubuntu", "--cd", repo, "--exec", "bash", "-c", insurerPolicyQuery, "onboarding-read-policy", policyId], { timeout: 45_000 });
    return JSON.parse(stdout) as { id: string; policyholderId: string; status: string; coverStartDate: string };
  } catch {
    throw new Error("The direct Insurer peer policy query did not return a policy");
  }
}

test("onboard real CA identities and settle a synthetic medical claim on LevelDB dev-lite", async ({ playwright, page }, info) => {
  test.skip(!process.env.ONBOARDING_RESULTS_DIR, "Run only through the dedicated LevelDB dev-lite onboarding runner");
  const repo = process.env.ONBOARDING_REPO_ROOT;
  const results = process.env.ONBOARDING_RESULTS_DIR;
  if (!repo || !results) throw new Error("The onboarding runner must supply its workspace and evidence paths");
  const resume = process.env.ONBOARDING_RESUME_RUN;
  let checkpoint: Checkpoint | undefined;
  if (resume) {
    if (!/^\d{8}T\d{10}Z$/.test(resume)) throw new Error("Use a dated onboarding evidence directory");
    checkpoint = JSON.parse(await readFile(path.join(path.dirname(results), resume, "journey.json"), "utf8"));
    if (checkpoint?.completed || !checkpoint?.evidence.enrollment || !checkpoint.evidence.episode ||
        !checkpoint.events.some(event => event.check === "confirmSettlement" && event.status === 200)) {
      throw new Error("The prior journey must have confirmed settlement and retained its onboarding evidence");
    }
  }
  const began = new Date();
  const priorSuffix = /^onboard-([a-f0-9]{8})-policy$/.exec(checkpoint?.evidence.policy?.id ?? "")?.[1];
  if (checkpoint && !priorSuffix) throw new Error("The checkpoint does not name a synthetic onboarding policy");
  const suffix = priorSuffix ?? randomUUID().slice(0, 8);
  const id = (kind: string) => ["onboard", suffix, kind].join("-");
  const address = (kind: string) => ["onboard", suffix, kind].join("-") + "@block-insure.demo";
  const contexts = new Set<APIRequestContext>();
  const events: { check: string; status: number; elapsedMs: number }[] = [];
  const evidence: Record<string, unknown> = { ...checkpoint?.evidence, ...(resume ? { resumedFrom: resume } : {}) };
  const rateAbort = new AbortController();
  let rateProbe: Promise<Error | undefined> | undefined;
  let completed = false;

  async function client() {
    const session = await playwright.request.newContext({ baseURL: app, extraHTTPHeaders: { Origin: app }, timeout: 120_000 });
    contexts.add(session);
    return session;
  }
  async function call<T>(session: APIRequestContext, check: string, endpoint: string, data?: object, accepted: number | number[] = 200) {
    const started = Date.now();
    const response = await (data ? session.post(endpoint, { data }) : session.get(endpoint))
      .catch(() => { throw new Error(check + " did not receive an HTTP response"); });
    const status = response.status();
    events.push({ check, status, elapsedMs: Date.now() - started });
    expect(Array.isArray(accepted) ? accepted : [accepted], check + " HTTP status " + status).toContain(status);
    if (status >= 400) return undefined as T;
    return await response.json().catch(() => { throw new Error(check + " did not return JSON"); }) as T;
  }
  async function staff(accountId: string) {
    const session = await client();
    await call(session, "Staff sign-in", "/api/auth/demo-login", { accountId });
    return session;
  }
  async function workflow<T = unknown>(session: APIRequestContext, operation: string, input: object) {
    return (await call<{ result: T }>(session, operation, "/api/workflows", { operation, ...input })).result;
  }
  async function asset<T>(session: APIRequestContext, kind: string, key: string) {
    return (await call<{ result: T }>(session, "Read " + kind, "/api/ledger/" + kind + "/" + key)).result;
  }
  async function codeRequest(session: APIRequestContext, purpose: "signup" | "login", email: string) {
    const result = await call<{ displayCode?: string }>(session, "Request " + purpose + " code", "/api/auth/" + purpose, { action: "request", email });
    return localCode(result);
  }
  async function signup(session: APIRequestContext, email: string, person: string) {
    const code = await codeRequest(session, "signup", email);
    const readyForLogin = Date.now() + cooldown;
    await call(session, "Verify sign-up email", "/api/auth/signup", { action: "verify", email, code });
    const nid = randomInt(1_000_000_000, 10_000_000_000).toString();
    const profile = await call<{ customer: Member }>(session, "Submit synthetic KYC profile", "/api/auth/signup", {
      action: "profile", fullName: person, phone: "+880 1000 000 000", dateOfBirth: "1990-01-01",
      nid, dataSharing: true,
    });
    expect(JSON.stringify(profile).includes(nid), "The profile response must omit the raw national ID").toBe(false);
    expect(profile.customer.status).toBe("PENDING_KYC");
    expect(profile.customer.memberId).toMatch(/^BI-[0-9A-HJKMNP-TV-Z]{8}$/);
    return { memberId: profile.customer.memberId, readyForLogin };
  }
  async function login(session: APIRequestContext, email: string, readyForLogin: number) {
    await wait(Math.max(0, readyForLogin - Date.now()));
    const code = await codeRequest(session, "login", email);
    const body = await call<{ customer: Member }>(session, "Verify customer sign-in", "/api/auth/login", { action: "verify", email, code });
    return { ...body.customer, nextCodeAt: Date.now() + cooldown };
  }
  async function approve(insurer: APIRequestContext, memberId: string) {
    const { customer, ca } = await call<{ customer: Member; ca: { registerHttpStatus: number; enrollHttpStatus: number } }>(
      insurer, "Insurer approves KYC and issues certificate", "/api/insurer/customers", { action: "approve", memberId });
    expect(customer.status).toBe("ACTIVE");
    expect(customer.memberId).toBe(memberId);
    expect(ca.registerHttpStatus).toBeGreaterThanOrEqual(200);
    expect(ca.registerHttpStatus).toBeLessThan(300);
    expect(ca.enrollHttpStatus).toBeGreaterThanOrEqual(200);
    expect(ca.enrollHttpStatus).toBeLessThan(300);
    return { registerHttpStatus: ca.registerHttpStatus, enrollHttpStatus: ca.enrollHttpStatus };
  }
  async function checkCodeLimits(session: APIRequestContext, completedSends = 0) {
    const email = address("rate");
    const signal = rateAbort.signal;
    for (let i = completedSends + 1; i <= 5; i++) {
      const code = await codeRequest(session, "signup", email);
      if (i === 1) {
        await call(session, "Refuse resend inside the 60-second cooldown", "/api/auth/signup", { action: "request", email }, 429);
        const wrong = code === "000000" ? "000001" : "000000";
        for (let attempt = 1; attempt <= 5; attempt++) {
          await call(session, "Refuse wrong code attempt " + attempt, "/api/auth/signup", { action: "verify", email, code: wrong }, 401);
        }
        await call(session, "Refuse original code after five wrong attempts", "/api/auth/signup", { action: "verify", email, code }, 401);
      }
      await wait(cooldown, undefined, { signal });
    }
    const started = Date.now();
    const response = await session.post("/api/auth/signup", { data: { action: "request", email } })
      .catch(() => { throw new Error("Sixth code request did not receive an HTTP response"); });
    events.push({ check: "Refuse sixth code request after the resend cooldown", status: response.status(), elapsedMs: Date.now() - started });
    expect(response.status()).toBe(429);
    expect(Number(response.headers()["retry-after"])).toBeGreaterThan(60);
  }

  async function finishIsolatedJourney(insurer: APIRequestContext, first: APIRequestContext, second: APIRequestContext, memberId: string, nextCodeAt: number) {
    const policyId = id("policy");
    const claimId = id("claim");
    await test.step("Isolate customer records and disable new and existing access on suspension", async () => {
      await call(second, "Refuse cross-customer policy read", "/api/ledger/policy/" + policyId, undefined, 403);
      await call(second, "Refuse cross-customer claim read", "/api/ledger/claim/" + claimId, undefined, 403);
      const cancellation = { operation: "cancelPolicy", id: policyId, reasonHash: digest(id("denied-cancellation")) };
      await call(second, "Refuse cross-customer policy change", "/api/workflows", cancellation, [403, 409]);
      const profile = await call<{ customer: Member }>(first, "Read signed-in customer profile", "/api/customer/profile");
      expect(profile.customer.memberId).toBe(memberId);
      const firstState = await first.storageState();
      await page.context().addCookies(firstState.cookies);
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto("/workspace/policyholder");
      await expect(page.getByRole("heading", { name: "My profile", exact: true })).toBeVisible();
      const card = page.getByRole("article", { name: "Insurance card" });
      await expect(card.getByText(memberId, { exact: true })).toBeVisible();
      await expect(card.getByText(policyId, { exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "Print insurance card" })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (checkpoint) {
        const failure = await rateProbe;
        if (failure) throw failure;
      }
      const { customer } = await call<{ customer: Member }>(insurer, "Suspend the approved customer", "/api/insurer/customers", {
        action: "suspend", memberId, reason: "Synthetic suspension",
      });
      expect(customer.status).toBe("SUSPENDED");
      await call(first, "Refuse a suspended customer's existing session transaction", "/api/workflows", cancellation, [401, 403]);
      const fresh = await client();
      await wait(Math.max(0, nextCodeAt - Date.now()));
      const code = await codeRequest(fresh, "login", address("first"));
      await call(fresh, "Refuse a suspended customer's new sign-in", "/api/auth/login", { action: "verify", email: address("first"), code }, 401);
      const unchanged = await asset<{ status: string }>(insurer, "policy", policyId);
      expect(unchanged.status).toBe("ACTIVE");
    });
  }

  try {
    const health = await call<{ channel: string; chaincode: string; schemaVersion: number }>(await client(), "Read channel health", "/api/fabric/health");
    expect(health.channel).toBe("insurance-dev-lite-190");
    expect(health.chaincode).toBe("insurance-contract");
    expect(health.schemaVersion).toBe(15);
    const rateSession = await client();
    const completedSends = checkpoint
      ? checkpoint.events.filter(event => event.check === "Request signup code" && event.status === 200).length - 3 : 0;
    if (completedSends < 0 || completedSends > 5) throw new Error("Unexpected code-request count in the prior run");
    rateProbe = checkCodeLimits(rateSession, completedSends).then(() => undefined, (failure: unknown) =>
      failure instanceof Error ? failure : new Error("The live code-limit check failed"));

    const insurer = await staff("insurer-admin");
    const bank = await staff("bank-officer");
    const first = await client();
    const second = await client();
    if (checkpoint) {
      const signedIn = await login(first, address("first"), 0);
      await login(second, address("second"), 0);
      expect(signedIn.memberId).toBe(checkpoint.evidence.policy?.policyholderId);
      const settled = await asset<Claim>(first, "claim", id("claim"));
      const confirmation = await asset<Payment & { approvalCertificateHash: string }>(first, "settlement", id("settlement"));
      const bankView = await call<{ claimId: string; approval: { hash: string; path: string }; payout: Payment }>(
        bank, "Read already-confirmed Bank settlement", "/api/medical/settlement?settlement=" + id("settlement"));
      const funds = await asset<{ balanceMinor: number }>(bank, "account", id("customer"));
      expect(settled).toMatchObject({ status: "SETTLED", claimantId: signedIn.memberId, amountMinor: payout, version: 1 });
      expect(confirmation).toMatchObject({ status: "CONFIRMED", amountMinor: payout });
      expect(confirmation.approvalCertificateHash).toMatch(/^[a-f0-9]{64}$/);
      expect(bankView).toMatchObject({ claimId: settled.id, approval: { hash: confirmation.approvalCertificateHash, path: "ORACLE_AUTO" },
        payout: { status: "CONFIRMED", amountMinor: payout } });
      expect(funds.balanceMinor).toBe(2_500_000 - premium + payout);
      evidence.settlement = { claimId: settled.id, version: settled.version, settlementId: id("settlement"), transferId: id("payout"),
        approvalPath: bankView.approval.path, certificateHash: confirmation.approvalCertificateHash, status: settled.status,
        amountMinor: payout, balanceAfterMinor: funds.balanceMinor };
      await finishIsolatedJourney(insurer, first, second, signedIn.memberId, signedIn.nextCodeAt);
      completed = true;
      return;
    }
    const hospital = await staff("hospital-officer");
    const refused = await client();

    const members = await test.step("Sign up two customers and reject a third profile without issuing a wallet", async () => {
      const firstProfile = await signup(first, address("first"), "Synthetic Onboarding First");
      const secondProfile = await signup(second, address("second"), "Synthetic Onboarding Second");
      const rejected = await signup(refused, address("rejected"), "Synthetic Onboarding Rejected");
      const pending = [firstProfile.memberId, secondProfile.memberId, rejected.memberId];
      expect(new Set(pending).size).toBe(3);
      const queue = await call<{ customers: Member[] }>(insurer, "Read the Insurer's pending KYC queue", "/api/insurer/customers");
      const awaitingReview = queue.customers.filter(row => row.status === "PENDING_KYC").map(row => row.memberId);
      expect(pending.every(memberId => awaitingReview.includes(memberId))).toBe(true);
      const firstCa = await approve(insurer, firstProfile.memberId);
      const secondCa = await approve(insurer, secondProfile.memberId);
      const rejection = await call<{ customer: Member; ca?: unknown }>(insurer, "Insurer rejects KYC", "/api/insurer/customers", {
        action: "reject", memberId: rejected.memberId, reason: "Synthetic review refusal",
      });
      expect(rejection.customer.status).toBe("REJECTED");
      expect(rejection.ca).toBeUndefined();
      const rejectedWalletExists = await lstat(path.join(repo, "data", "dev-lite", "customer-wallet", rejected.memberId))
        .then(() => true, (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw new Error("The rejected customer's wallet path could not be checked");
          return false;
        });
      expect(rejectedWalletExists).toBe(false);
      evidence.enrollment = { first: firstCa, second: secondCa, rejectedWalletExists };
      return { first: firstProfile, second: secondProfile };
    });

    const today = day(0);
    const policyId = id("policy");
    const claimId = id("claim");
    const settlementId = id("settlement");
    const packageId = id("package");
    const customerAccount = id("customer");
    const premiumAccount = id("premium");
    const reserveAccount = id("reserve");
    const termsHash = digest(id("terms"));
    const service = "INPATIENT";
    const maskedAccount = "**** 4321";

    await test.step("Prepare the medical product and the Bank accounts", async () => {
      const { result: agreements } = await call<{ result: { partnerId: string; status: string }[] }>(insurer, "Read partner agreements", "/api/ledger/partner-agreement");
      for (const [partnerType, partnerId, name] of [["HOSPITAL", hospitalId, "Synthetic Hospital"], ["BANK", bankId, "Synthetic Bank"]]) {
        if (agreements.some(row => row.partnerId === partnerId && row.status === "ACTIVE")) continue;
        await workflow(insurer, "createPartnerAgreement", {
          id: id(partnerId), partnerType, partnerId, name, location: "Dhaka", tier: "Preferred",
          accessScope: "Synthetic onboarding rehearsal", effectiveDate: day(-30, today), expiryDate: day(365, today),
        });
      }
      await workflow(insurer, "createPolicyPackage", {
        id: packageId, name: "Synthetic Onboarding Medical " + suffix, description: "Isolated reimbursement rehearsal",
        premiumMinor: premium, coverageLimitMinor: 30_000_000, termsHash,
      });
      await workflow(insurer, "configurePolicyPackagePartners", { id: packageId, hospitalIdsJson: JSON.stringify([hospitalId]), bankIdsJson: JSON.stringify([bankId]) });
      await workflow(insurer, "configureMedicalRules", {
        packageId, service, sublimit: 15_000_000, deductibleBps: 1000, deductibleCap: 500_000,
        shareBps: 8000, waitingDays: 0, filingDays: 30, evidenceRequired: false,
      });
      await workflow(insurer, "publishPolicyPackage", { id: packageId });
      for (const [account, openingBalanceMinor] of [[premiumAccount, 0], [reserveAccount, 10_000_000]] as const) {
        await workflow(bank, "openBankAccount", {
          id: account, bankId, ownerId: "insurer", accountType: "INSURER", accountLabel: "Synthetic insurer account",
          maskedAccount, openingBalanceMinor, accountTokenHash: digest(account),
        });
      }
    });

    const signedIn = await test.step("Sign in with customer identities, buy coverage and pay the first premium", async () => {
      const primary = await login(first, address("first"), members.first.readyForLogin);
      const different = await login(second, address("second"), members.second.readyForLogin);
      expect(primary.memberId).toBe(members.first.memberId);
      expect(different.memberId).toBe(members.second.memberId);
      await workflow(first, "requestBankAccountLink", { id: id("link"), bankId, accountLabel: "Synthetic member account", maskedAccount });
      await workflow(bank, "reviewBankAccountLink", {
        id: id("link"), outcome: "APPROVE", accountReferenceId: customerAccount, decisionHash: digest(id("verified-link")),
        accountTokenHash: digest(customerAccount), openingBalanceMinor: 2_500_000,
      });
      const published = await asset<{ termsHash: string }>(first, "package", packageId);
      expect(published.termsHash).toMatch(/^[a-f0-9]{64}$/);
      const policy = await workflow<{ status: string; policyholderId: string }>(first, "acquireMedicalPolicy", {
        id: policyId, packageId, startDate: today, endDate: day(364, today), acceptedTermsHash: published.termsHash,
      });
      expect(policy.status).toBe("PENDING_PAYMENT");
      expect(policy.policyholderId).toBe(primary.memberId);
      const payment = {
        policyId, transferId: id("premium-transfer"), paymentId: id("premium-payment"),
        sourceAccountId: customerAccount, destinationAccountId: premiumAccount,
        periodStartDate: today, periodEndDate: day(29, today), amountMinor: premium, externalReferenceHash: digest(id("premium-reference")),
      };
      const challenge = await call<{ challengeId: string; demoCode?: string }>(first, "Request first premium authorization", "/api/banking/otp", payment);
      const paid = await call<{ result: Payment }>(first, "Pay first premium with OTP", "/api/banking/premium-payment", {
        ...payment, challengeId: challenge.challengeId, otp: localCode(challenge),
      });
      expect(paid.result.status).toBe("SETTLED");
      expect(paid.result.amountMinor).toBe(premium);
      expect(paid.result.method).toBe("OTP");
      const peerPolicy = await queryInsurerPolicy(repo, policyId);
      expect(peerPolicy.id).toBe(policyId);
      expect(peerPolicy.policyholderId).toBe(primary.memberId);
      expect(peerPolicy.status).toBe("ACTIVE");
      expect(peerPolicy.coverStartDate).toBe(today);
      evidence.policy = { id: policyId, policyholderId: primary.memberId, activeFrom: today, source: "Direct Insurer peer read on localhost:31051", premiumMinor: premium };
      return primary;
    });

    const submitted = await test.step("The Hospital records the member ID and the Insurer verifies the suggested match", async () => {
      const patientReferenceHash = digest(signedIn.memberId);
      const episode = await workflow<{ id: string; revision: number }>(hospital, "saveMedicalEpisode", {
        episodeReferenceHash: digest(id("episode")), expectedRevision: 0, patientReferenceHash,
        service, serviceDate: today, admissionDate: today, dischargeDate: today,
        billMinor: 8_500_000, invoiceDate: today, diagnosisCode: "",
      });
      expect(episode.revision).toBe(1);
      const lookup = "/api/insurer/customers?patientReferenceHash=" + patientReferenceHash;
      await call(hospital, "Do not expose the customer match to the Hospital", lookup, undefined, 403);
      const { match } = await call<{ match: { memberId: string; fullName: string; dateOfBirth: string } }>(insurer, "Resolve patient hash to the approved member", lookup);
      expect(match?.memberId).toBe(signedIn.memberId);
      expect(match?.fullName === "Synthetic Onboarding First").toBe(true);
      expect(match?.dateOfBirth === "1990-01-01").toBe(true);
      const association = await workflow<{ verified: boolean; beneficiaryId: string }>(insurer, "verifyMedicalAssociation", {
        episodeId: episode.id, revision: 1, beneficiaryId: signedIn.memberId,
        decisionBasisHash: digest(id("manual-association")), verified: true,
      });
      expect(association.verified).toBe(true);
      expect(association.beneficiaryId).toBe(signedIn.memberId);

      const benchmarkOperation = {
        operation: "registerMedicalOracleBenchmark", hospitalId, service, minimum: 5_000_000, maximum: 12_000_000,
        licenseStatus: "ACTIVE", sourceHash: digest("Synthetic inpatient benchmark for a documented BDT 85,000 fixture"),
      };
      const benchmarkStarted = Date.now();
      const benchmark = await insurer.post("/api/workflows", { data: benchmarkOperation })
        .catch(() => { throw new Error("Register synthetic medical benchmark did not receive an HTTP response"); });
      events.push({ check: "Register or reuse the immutable inpatient benchmark", status: benchmark.status(), elapsedMs: Date.now() - benchmarkStarted });
      const benchmarkReply = await benchmark.json().catch(() => ({}));
      expect(benchmark.ok() || (benchmark.status() === 409 && /private medicalOracleBenchmark [0-9a-f]{64} already exists/.test(benchmarkReply.message ?? ""))).toBe(true);

      const intake = { policyId, episodeId: episode.id, revision: 1 };
      await call(second, "Refuse another customer's claim preparation", "/api/workflows", { operation: "prepareMedicalClaim", id: id("denied-claim"), ...intake }, [403, 409]);
      await workflow(first, "prepareMedicalClaim", { id: claimId, ...intake });
      const query = new URLSearchParams({ policy: policyId, episode: episode.id, revision: "1" });
      const { quote } = await call<{ quote: { payableMinor: number; statementHash: string } }>(first, "Read the reimbursement statement", "/api/medical/intake?" + query);
      expect(quote.payableMinor).toBe(payout);
      const claim = await workflow<Claim>(first, "submitMedicalClaim", { id: claimId, ...intake, statementHash: quote.statementHash });
      expect(claim).toMatchObject({ id: claimId, claimantId: signedIn.memberId, policyId, episodeId: episode.id, version: 1, amountMinor: payout });
      evidence.episode = { id: episode.id, revision: 1, verified: association.verified };
      return { claimId: claim.id };
    });

    await test.step("Two Oracles approve and the Bank confirms one routine payout", async () => {
      // Propose and attest the linked episode's registry data before requesting Oracle work.
      const { result: proposal } = await call<{ result: { id: string; rootHash: string } }>(insurer, "Propose the medical registry root", "/api/medical/registry", { action: "propose", hospitalId });
      const { snapshots } = await call<{ snapshots: { id: string; status: string }[] }>(hospital, "Read Hospital registry proposals", "/api/medical/registry");
      const current = snapshots.find(item => item.id === proposal.id);
      expect(current !== undefined).toBe(true);
      if (current?.status !== "ACTIVE") {
        await call(hospital, "Hospital attests the registry root", "/api/medical/registry", { action: "attest", id: proposal.id, rootHash: proposal.rootHash });
      }
      const request = await workflow<{ id: string; claimId: string; claimVersion: number; requiredConfirmations: number; expectedResponses: number }>(insurer, "startClaimProcessing", submitted);
      expect(request).toMatchObject({ claimId, claimVersion: 1, requiredConfirmations: 2, expectedResponses: 3 });
      let routed: string | undefined;
      await expect.poll(async () => {
        routed = (await asset<Claim>(insurer, "claim", claimId)).status;
        return routed;
      }, {
        timeout: 240_000, intervals: [2000], message: "Current-version Oracle auto-approval",
      }).toMatch(/^(APPROVED|ORACLE_FAILED|MEDICAL_REVIEW_REQUIRED)$/);
      expect(routed).toBe("APPROVED");
      await workflow(insurer, "authorizeSettlement", { settlementId, claimId, sourceAccountId: reserveAccount, destinationAccountId: customerAccount });
      const bankView = await call<{ approval: { path: string; hash: string }; payout: Payment }>(bank, "Read Bank instruction", "/api/medical/settlement?settlement=" + settlementId);
      expect(bankView.approval.path).toBe("ORACLE_AUTO");
      expect(bankView.payout).toMatchObject({ status: "AUTHORIZED", amountMinor: payout });
      const before = await asset<{ balanceMinor: number }>(bank, "account", customerAccount);
      expect(before.balanceMinor).toBe(2_500_000 - premium);
      const transferId = id("payout");
      const paid = await workflow<Payment>(bank, "confirmSettlement", { settlementId, transferId, bankReferenceHash: digest(id("bank-receipt")) });
      expect(paid).toMatchObject({ status: "CONFIRMED", amountMinor: payout });
      const after = await asset<{ balanceMinor: number }>(bank, "account", customerAccount);
      expect(after.balanceMinor - before.balanceMinor).toBe(payout);
      const settled = await asset<Claim>(first, "claim", claimId);
      expect(settled.status).toBe("SETTLED");
      const confirmed = await asset<Payment & { approvalCertificateHash: string }>(first, "settlement", settlementId);
      expect(confirmed.approvalCertificateHash).toMatch(/^[a-f0-9]{64}$/);
      expect(confirmed.approvalCertificateHash).toBe(bankView.approval.hash);
      evidence.settlement = {
        claimId, version: settled.version, oracleRequestId: request.id, settlementId, transferId,
        approvalPath: bankView.approval.path, certificateHash: confirmed.approvalCertificateHash, status: settled.status,
        amountMinor: payout, balanceBeforeMinor: before.balanceMinor, balanceAfterMinor: after.balanceMinor,
      };
    });

    await finishIsolatedJourney(insurer, first, second, signedIn.memberId, signedIn.nextCodeAt);

    await test.step("Confirm the real resend window and hourly email limit", async () => {
      const failure = await rateProbe;
      if (failure) throw failure;
    });
    completed = true;
  } finally {
    rateAbort.abort();
    await rateProbe;
    await Promise.allSettled(Array.from(contexts, session => session.dispose()));
    await writeFile(path.join(results, "journey.json"), JSON.stringify({
      scope: "synthetic, single-host, live LevelDB dev-lite", startedAt: began.toISOString(), endedAt: new Date().toISOString(),
      durationMs: Date.now() - began.getTime(), completed, testStatusAtCleanup: info.status, evidence, events,
    }, null, 2));
  }
});
