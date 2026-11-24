import { createHash, randomInt } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { expect, test, type APIRequestContext } from "@playwright/test";

// Seeds a fresh LevelDB dev-lite ledger with a small, realistic demonstration
// set: four partners, five single-service health plans, five customers with linked accounts
// and policies, and three claims at different stages. Run it once, through
// scripts/seed-dev-lite-demo.ps1, straight after a fresh deployment.

const app = "http://127.0.0.1:3219";
const cooldown = 61_000;
const hospital = { dhaka: "hospital-demo", chattogram: "hospital-2", rajshahi: "hospital-3" } as const;
const bankId = "bank-demo";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const bdt = (taka: number) => Math.round(taka * 100);

function day(offset: number, start?: string) {
  const reference = start ? Date.parse(start + "T00:00:00Z") : Date.now() + 6 * 3_600_000;
  return new Date(reference + offset * 86_400_000).toISOString().slice(0, 10);
}

function localCode(body: { displayCode?: string; demoCode?: string }) {
  const code = body.displayCode ?? body.demoCode ?? "";
  if (!/^\d{6}$/.test(code)) throw new Error("The on-screen verification code was unavailable; start the app without -Email");
  return code;
}

type Service = "SURGERY" | "CONSULTATION" | "DIAGNOSTIC" | "INPATIENT" | "OTHER";
type Rule = { service: Service; sublimit: number; deductiblePct: number; deductibleCap: number; sharePct: number; waitingDays: number };

const partners = [
  { id: "AGR-HSP-DCMH-2026", partnerType: "HOSPITAL", partnerId: hospital.dhaka, name: "Dhaka Central Medical Hospital",
    location: "Road 16, Dhanmondi, Dhaka 1209", tier: "Preferred network", accessScope: "Cashless inpatient, surgical, diagnostic and outpatient claims" },
  { id: "AGR-HSP-CMH-2026", partnerType: "HOSPITAL", partnerId: hospital.chattogram, name: "Chattogram Metropolitan Hospital",
    location: "Agrabad Commercial Area, Chattogram 4100", tier: "Preferred network", accessScope: "Cashless inpatient, surgical and diagnostic claims" },
  { id: "AGR-HSP-RCH-2026", partnerType: "HOSPITAL", partnerId: hospital.rajshahi, name: "Rajshahi Community Hospital",
    location: "Laxmipur, Rajshahi 6000", tier: "Standard network", accessScope: "Inpatient, diagnostic and outpatient claims" },
  { id: "AGR-BNK-BDCB-2026", partnerType: "BANK", partnerId: bankId, name: "Bangladesh Demo Commercial Bank",
    location: "Motijheel C/A, Dhaka 1000", tier: "Settlement bank", accessScope: "Premium collection, EFT mandates and claim payouts" },
] as const;

// Each medical package covers one service, so every plan is a single-service product.
const plans: { id: string; name: string; description: string; premium: number; cover: number; hospitals: string[]; rule: Rule }[] = [
  { id: "HLT-IND-2026", name: "Shastho Shurokkha Hospital Cover", premium: 950, cover: 200_000,
    description: "Individual cover for hospital admissions at network hospitals: room, nursing, medicines and tests during the stay.",
    hospitals: [hospital.dhaka, hospital.chattogram, hospital.rajshahi],
    rule: { service: "INPATIENT", sublimit: 120_000, deductiblePct: 10, deductibleCap: 3_000, sharePct: 80, waitingDays: 0 } },
  { id: "HLT-PLS-2026", name: "Hospital Care Plus", premium: 2_450, cover: 500_000,
    description: "Higher-limit cover for hospital admissions, including intensive care, at all network hospitals.",
    hospitals: [hospital.dhaka, hospital.chattogram, hospital.rajshahi],
    rule: { service: "INPATIENT", sublimit: 300_000, deductiblePct: 10, deductibleCap: 5_000, sharePct: 80, waitingDays: 0 } },
  { id: "HLT-SRG-2026", name: "Surgical Shield", premium: 1_500, cover: 300_000,
    description: "Planned and emergency surgery at Dhaka and Chattogram network hospitals, after a 30-day waiting period.",
    hospitals: [hospital.dhaka, hospital.chattogram],
    rule: { service: "SURGERY", sublimit: 250_000, deductiblePct: 10, deductibleCap: 5_000, sharePct: 85, waitingDays: 30 } },
  { id: "HLT-DGN-2026", name: "Diagnostics Care", premium: 650, cover: 75_000,
    description: "Laboratory tests and imaging (X-ray, ultrasound, CT and MRI) without a hospital admission.",
    hospitals: [hospital.dhaka, hospital.chattogram, hospital.rajshahi],
    rule: { service: "DIAGNOSTIC", sublimit: 40_000, deductiblePct: 10, deductibleCap: 1_000, sharePct: 80, waitingDays: 0 } },
  { id: "HLT-OPD-2026", name: "Doctor Visit Care", premium: 450, cover: 30_000,
    description: "Consultations with general practitioners and specialists at network hospital outpatient departments.",
    hospitals: [hospital.dhaka, hospital.chattogram, hospital.rajshahi],
    rule: { service: "CONSULTATION", sublimit: 15_000, deductiblePct: 0, deductibleCap: 0, sharePct: 80, waitingDays: 0 } },
];

// All five register through customer onboarding and sign in with on-screen
// codes. Email addresses (example.com), phones and NIDs are fictional.
const customers = [
  { key: "kazi", fullName: "Kazi Kamruddin Ahmed", email: "kazi.ahmed@example.com", phone: "+880 1700-000101", dateOfBirth: "1999-09-18",
    plan: "HLT-PLS-2026", policyId: "POL-2026-000101", premium: "OTP",
    account: { label: "Savings account", masked: "**** 4821", reference: "ACC-0101-4821", opening: 185_000 } },
  { key: "sumit", fullName: "Sumit Majumder", email: "sumit.majumder@example.com", phone: "+880 1700-000102", dateOfBirth: "1998-03-14",
    plan: "HLT-IND-2026", policyId: "POL-2026-000102", premium: "OTP",
    account: { label: "Salary account", masked: "**** 3307", reference: "ACC-0102-3307", opening: 96_500 } },
  { key: "abdullah", fullName: "Abdullah Ishtiaq", email: "abdullah.ishtiaq@example.com", phone: "+880 1700-000103", dateOfBirth: "1999-07-22",
    plan: "HLT-DGN-2026", policyId: "POL-2026-000103", premium: "OTP",
    account: { label: "Savings account", masked: "**** 9154", reference: "ACC-0103-9154", opening: 54_200 } },
  { key: "sadik", fullName: "Sadik Rahman", email: "sadik.rahman@example.com", phone: "+880 1700-000104", dateOfBirth: "1998-11-05",
    plan: "HLT-SRG-2026", policyId: "POL-2026-000104", premium: "OTP",
    account: { label: "Savings account", masked: "**** 2768", reference: "ACC-0104-2768", opening: 120_000 } },
  { key: "rakibul", fullName: "Rakibul Islam", email: "rakibul.islam@example.com", phone: "+880 1700-000105", dateOfBirth: "1997-01-30",
    plan: "HLT-IND-2026", policyId: "POL-2026-000105", premium: "EFT",
    account: { label: "Salary account", masked: "**** 6043", reference: "ACC-0105-6043", opening: 72_000 } },
] as const;

test("seed a realistic demonstration ledger", async ({ playwright }, info) => {
  test.skip(!process.env.SEED_RESULTS_DIR, "Run only through scripts/seed-dev-lite-demo.ps1");
  test.setTimeout(1_800_000);
  const results = process.env.SEED_RESULTS_DIR;
  if (process.env.FABRIC_CHANNEL_NAME !== "insurance-dev-lite-190" || !results) throw new Error("Run through scripts/seed-dev-lite-demo.ps1");
  const today = day(0);
  const summary: Record<string, unknown> = { seededOn: today };
  const sessions: APIRequestContext[] = [];

  async function client() {
    const session = await playwright.request.newContext({ baseURL: app, extraHTTPHeaders: { Origin: app }, timeout: 150_000 });
    sessions.push(session);
    return session;
  }
  async function call<T>(session: APIRequestContext, label: string, endpoint: string, data?: object): Promise<T> {
    const response = await (data ? session.post(endpoint, { data, maxRetries: 0 }) : session.get(endpoint, { maxRetries: 2 }));
    const body = await response.json().catch(() => ({}));
    expect(response.ok(), `${label}: HTTP ${response.status()} ${JSON.stringify(body)}`).toBe(true);
    console.log(label);
    return body as T;
  }
  async function staff(accountId: string) {
    const session = await client();
    await call(session, "Sign in " + accountId, "/api/auth/demo-login", { accountId });
    return session;
  }
  async function workflow<T = unknown>(session: APIRequestContext, operation: string, input: object, label = operation) {
    return (await call<{ result: T }>(session, label, "/api/workflows", { operation, ...input })).result;
  }
  async function read<T>(session: APIRequestContext, kind: string, key?: string) {
    return (await call<{ result: T }>(session, "Read " + kind, "/api/ledger/" + kind + (key ? "/" + encodeURIComponent(key) : ""))).result;
  }

  try {
    const insurer = await staff("insurer-admin");
    const bank = await staff("bank-officer");
    const hospitals = { dhaka: await staff("hospital-officer"), chattogram: await staff("hospital-officer-2") };

    const health = await call<{ channel: string; schemaVersion: number }>(insurer, "Read ledger health", "/api/fabric/health");
    expect(health).toMatchObject({ channel: "insurance-dev-lite-190", schemaVersion: 15 });
    expect(await read<unknown[]>(insurer, "package"), "Seed only an empty ledger").toEqual([]);

    await test.step("activate approval certificates", async () => {
      // Activation is once per channel; an interrupted earlier seed may already have done it.
      const response = await insurer.post("/api/medical/registry", { data: { action: "activate" }, maxRetries: 0 });
      const body = await response.text();
      expect(response.ok() || /already exists/.test(body), `Activate approval certificates: HTTP ${response.status()} ${body}`).toBe(true);
    });

    await test.step("sign partner agreements and publish five health plans", async () => {
      for (const partner of partners) {
        await workflow(insurer, "createPartnerAgreement", { ...partner, effectiveDate: day(-90), expiryDate: day(640) }, "Agreement " + partner.name);
      }
      for (const plan of plans) {
        await workflow(insurer, "createPolicyPackage", { id: plan.id, name: plan.name, description: plan.description,
          premiumMinor: bdt(plan.premium), coverageLimitMinor: bdt(plan.cover), termsHash: digest(`${plan.id} policy wording, edition 2026-01`) }, "Plan " + plan.name);
        await workflow(insurer, "configurePolicyPackagePartners", { id: plan.id, hospitalIdsJson: JSON.stringify(plan.hospitals), bankIdsJson: JSON.stringify([bankId]) });
        const { rule } = plan;
        await workflow(insurer, "configureMedicalRules", { packageId: plan.id, service: rule.service, sublimit: bdt(rule.sublimit),
          deductibleBps: rule.deductiblePct * 100, deductibleCap: bdt(rule.deductibleCap), shareBps: rule.sharePct * 100,
          waitingDays: rule.waitingDays, filingDays: 30, evidenceRequired: false }, `Rule ${plan.id} ${rule.service}`);
        await workflow(insurer, "publishPolicyPackage", { id: plan.id });
      }
      // Reference charges the Oracle workers check bills against.
      for (const [hospitalId, service, minimum, maximum] of [
        [hospital.dhaka, "INPATIENT", 40_000, 150_000], [hospital.dhaka, "DIAGNOSTIC", 3_000, 45_000],
        [hospital.chattogram, "INPATIENT", 35_000, 130_000], [hospital.chattogram, "DIAGNOSTIC", 2_500, 40_000],
      ] as const) {
        await workflow(insurer, "registerMedicalOracleBenchmark", { hospitalId, service, minimum: bdt(minimum), maximum: bdt(maximum),
          licenseStatus: "ACTIVE", sourceHash: digest(`DGHS-registered tariff ${hospitalId} ${service} 2026`) }, `Benchmark ${hospitalId} ${service}`);
      }
      summary.plans = plans.map(plan => plan.id);
    });

    await test.step("open the Insurer's premium and claims reserve accounts", async () => {
      for (const [id, label, masked, opening] of [
        ["ACC-INS-PREM-7001", "Premium collection account", "**** 7001", 0],
        ["ACC-INS-RSRV-7002", "Claims reserve account", "**** 7002", 2_500_000],
      ] as const) {
        await workflow(bank, "openBankAccount", { id, bankId, ownerId: "insurer", accountType: "INSURER", accountLabel: label,
          maskedAccount: masked, openingBalanceMinor: bdt(opening), accountTokenHash: digest(id) }, "Open " + label);
      }
    });

    const members: Record<string, { session: APIRequestContext; memberId: string }> = {};
    await test.step("register five customers and approve their KYC", async () => {
      const pending: { key: string; email: string; session: APIRequestContext; memberId: string; readyAt: number }[] = [];
      for (const customer of customers) {
        const session = await client();
        const requested = await call<{ displayCode?: string }>(session, "Sign-up code for " + customer.fullName, "/api/auth/signup", { action: "request", email: customer.email });
        const readyAt = Date.now() + cooldown;
        await call(session, "Verify email of " + customer.fullName, "/api/auth/signup", { action: "verify", email: customer.email, code: localCode(requested) });
        const profile = await call<{ customer: { memberId: string; status: string } }>(session, "KYC profile of " + customer.fullName, "/api/auth/signup", {
          action: "profile", fullName: customer.fullName, phone: customer.phone, dateOfBirth: customer.dateOfBirth,
          nid: randomInt(1_000_000_000, 10_000_000_000).toString(), dataSharing: true,
        });
        expect(profile.customer.status).toBe("PENDING_KYC");
        pending.push({ key: customer.key, email: customer.email, session, memberId: profile.customer.memberId, readyAt });
      }
      for (const row of pending) {
        const approved = await call<{ customer: { status: string } }>(insurer, "Approve KYC " + row.memberId, "/api/insurer/customers", { action: "approve", memberId: row.memberId });
        expect(approved.customer.status).toBe("ACTIVE");
      }
      for (const row of pending) {
        await wait(Math.max(0, row.readyAt - Date.now()));
        const requested = await call<{ displayCode?: string }>(row.session, "Sign-in code " + row.memberId, "/api/auth/login", { action: "request", email: row.email });
        const signedIn = await call<{ customer: { memberId: string } }>(row.session, "Sign in " + row.memberId, "/api/auth/login", { action: "verify", email: row.email, code: localCode(requested) });
        expect(signedIn.customer.memberId).toBe(row.memberId);
        members[row.key] = { session: row.session, memberId: row.memberId };
      }
      summary.members = Object.fromEntries(Object.entries(members).map(([key, value]) => [key, value.memberId]));
    });

    await test.step("link accounts, buy policies and pay first premiums", async () => {
      for (const [index, customer] of customers.entries()) {
        const { session } = members[customer.key];
        const linkId = `LNK-2026-${String(101 + index).padStart(4, "0")}`;
        await workflow(session, "requestBankAccountLink", { id: linkId, bankId, accountLabel: customer.account.label, maskedAccount: customer.account.masked },
          "Link request " + customer.fullName);
        await workflow(bank, "reviewBankAccountLink", { id: linkId, outcome: "APPROVE", accountReferenceId: customer.account.reference,
          decisionHash: digest("KYC-matched account " + customer.account.reference), accountTokenHash: digest(customer.account.reference),
          openingBalanceMinor: bdt(customer.account.opening) }, "Verify account " + customer.fullName);
        const plan = plans.find(row => row.id === customer.plan)!;
        const published = await read<{ termsHash: string }>(session, "package", plan.id);
        const policy = await workflow<{ status: string }>(session, "acquireMedicalPolicy", { id: customer.policyId, packageId: plan.id,
          startDate: today, endDate: day(364), acceptedTermsHash: published.termsHash }, "Buy " + plan.name + " for " + customer.fullName);
        expect(policy.status).toBe("PENDING_PAYMENT");
        if (customer.premium === "OTP") {
          const tag = customer.policyId.slice(-3);
          const payment = { policyId: customer.policyId, transferId: `TRF-PRM-2026-${tag}`, paymentId: `PAY-PRM-2026-${tag}`,
            sourceAccountId: customer.account.reference, destinationAccountId: "ACC-INS-PREM-7001",
            periodStartDate: today, periodEndDate: day(29), amountMinor: bdt(plan.premium), externalReferenceHash: digest(`BEFTN ${customer.policyId} ${today}`) };
          const challenge = await call<{ challengeId: string; demoCode?: string; displayCode?: string }>(session, "Premium code " + customer.fullName, "/api/banking/otp", payment);
          const paid = await call<{ result: { status: string } }>(session, "Pay first premium " + customer.fullName, "/api/banking/premium-payment",
            { ...payment, challengeId: challenge.challengeId, otp: localCode(challenge) });
          expect(paid.result.status).toBe("SETTLED");
        } else {
          const mandateId = `MND-2026-${customer.policyId.slice(-4)}`;
          await workflow(session, "requestBankMandate", { id: mandateId, policyId: customer.policyId, accountReferenceId: customer.account.reference,
            expiryDate: day(364) }, "EFT mandate request " + customer.fullName);
          await workflow(bank, "reviewBankMandate", { id: mandateId, outcome: "APPROVE", decisionHash: digest("Signed EFT mandate " + mandateId) }, "Approve mandate " + mandateId);
        }
      }
    });

    type Claim = { id: string; status: string; version: number };
    async function admit(key: string, place: keyof typeof hospitals, service: Service, bill: number, reference: string) {
      const member = members[key];
      const episode = await workflow<{ id: string; revision: number }>(hospitals[place], "saveMedicalEpisode", {
        episodeReferenceHash: digest(reference), expectedRevision: 0, patientReferenceHash: digest(member.memberId),
        service, serviceDate: today, admissionDate: today, dischargeDate: today, billMinor: bdt(bill), invoiceDate: today, diagnosisCode: "",
      }, `Hospital records ${reference}`);
      await workflow(insurer, "verifyMedicalAssociation", { episodeId: episode.id, revision: 1, beneficiaryId: member.memberId,
        decisionBasisHash: digest("Member card and NID checked at admission desk " + reference), verified: true }, "Insurer matches " + reference);
      return episode;
    }
    async function fileClaim(key: string, claimId: string, policyId: string, episodeId: string) {
      const { session } = members[key];
      const intake = { policyId, episodeId, revision: 1 };
      await workflow(session, "prepareMedicalClaim", { id: claimId, ...intake }, "Prepare " + claimId);
      const query = new URLSearchParams({ policy: policyId, episode: episodeId, revision: "1" });
      const { quote } = await call<{ quote: { statementHash: string; payableMinor: number } }>(session, "Statement " + claimId, "/api/medical/intake?" + query);
      const claim = await workflow<Claim>(session, "submitMedicalClaim", { id: claimId, ...intake, statementHash: quote.statementHash }, "Submit " + claimId);
      return { claim, payableMinor: quote.payableMinor };
    }
    async function attest(place: keyof typeof hospitals, hospitalId: string) {
      const { result: proposal } = await call<{ result: { id: string; rootHash: string } }>(insurer, "Propose registry " + hospitalId, "/api/medical/registry", { action: "propose", hospitalId });
      const { snapshots } = await call<{ snapshots: { id: string; status: string }[] }>(hospitals[place], "Read registry proposals", "/api/medical/registry");
      if (snapshots.find(item => item.id === proposal.id)?.status !== "ACTIVE") {
        await call(hospitals[place], "Attest registry " + hospitalId, "/api/medical/registry", { action: "attest", id: proposal.id, rootHash: proposal.rootHash });
      }
    }
    async function approveByOracles(claimId: string) {
      await workflow(insurer, "startClaimProcessing", { claimId }, "Send " + claimId + " to the Oracles");
      let status = "";
      await expect.poll(async () => (status = (await read<Claim>(insurer, "claim", claimId)).status), { timeout: 300_000, intervals: [3000] })
        .toMatch(/^(APPROVED|ORACLE_FAILED|MEDICAL_REVIEW_REQUIRED)$/);
      expect(status, claimId + " Oracle outcome").toBe("APPROVED");
    }

    await test.step("three claims at different stages", async () => {
      // Kazi: emergency admission at Dhaka Central, approved by the Oracles and paid.
      const kaziStay = await admit("kazi", "dhaka", "INPATIENT", 85_000, "DCMH-IP-2026-04417");
      const kazi = await fileClaim("kazi", "CLM-2026-000201", "POL-2026-000101", kaziStay.id);
      // Sumit: day-care admission at Dhaka Central, approved, payout awaiting the Bank.
      const sumitStay = await admit("sumit", "dhaka", "INPATIENT", 62_500, "DCMH-IP-2026-04452");
      const sumit = await fileClaim("sumit", "CLM-2026-000202", "POL-2026-000102", sumitStay.id);
      await attest("dhaka", hospital.dhaka);
      await approveByOracles(kazi.claim.id);
      await workflow(insurer, "authorizeSettlement", { settlementId: "STL-2026-000201", claimId: kazi.claim.id,
        sourceAccountId: "ACC-INS-RSRV-7002", destinationAccountId: "ACC-0101-4821" }, "Authorise payout CLM-2026-000201");
      await workflow(bank, "confirmSettlement", { settlementId: "STL-2026-000201", transferId: "TRF-CLM-2026-000201",
        bankReferenceHash: digest("BEFTN payout CLM-2026-000201") }, "Bank pays CLM-2026-000201");
      await approveByOracles(sumit.claim.id);
      await workflow(insurer, "authorizeSettlement", { settlementId: "STL-2026-000202", claimId: sumit.claim.id,
        sourceAccountId: "ACC-INS-RSRV-7002", destinationAccountId: "ACC-0102-3307" }, "Authorise payout CLM-2026-000202");
      // Abdullah: diagnostic visit at Chattogram Metropolitan, submitted and waiting for the Insurer.
      const abdullahVisit = await admit("abdullah", "chattogram", "DIAGNOSTIC", 18_400, "CMH-DX-2026-11306");
      const abdullah = await fileClaim("abdullah", "CLM-2026-000203", "POL-2026-000103", abdullahVisit.id);
      const states = await Promise.all(["CLM-2026-000201", "CLM-2026-000202", "CLM-2026-000203"].map(id => read<Claim>(insurer, "claim", id)));
      expect(states.map(claim => claim.status)).toEqual(["SETTLED", "SETTLEMENT_AUTHORIZED", abdullah.claim.status]);
      summary.claims = states.map(claim => ({ id: claim.id, status: claim.status }));
      summary.payable = { kazi: kazi.payableMinor, sumit: sumit.payableMinor, abdullah: abdullah.payableMinor };
    });

    const file = path.join(results, "seed-summary.json");
    await writeFile(file, JSON.stringify(summary, null, 2));
    await info.attach("seed-summary", { path: file, contentType: "application/json" });
  } finally {
    await Promise.all(sessions.map(session => session.dispose()));
  }
});
