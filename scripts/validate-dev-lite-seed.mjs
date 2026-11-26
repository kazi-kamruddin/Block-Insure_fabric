import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const seedRoot = fileURLToPath(new URL("../data/dev-lite/demo-seed/", import.meta.url));
const requireWebDependency = createRequire(new URL("../apps/web/package.json", import.meta.url));
const dhaka = "hospital-demo";
const chattogram = "hospital-2";
const rajshahi = "hospital-3";
const claim203 = "CLM-2026-000203";

// Historical seed summaries record plan IDs, member aliases and claim statuses.
// The remaining offline inputs come from apps/web/e2e/demo-seed.spec.ts and
// the 24 November seed record in docs/dev-lite-medical.md.
const seedPlans = [
  { id: "HLT-IND-2026", service: "INPATIENT", waitingDays: 0, hospitalIds: [dhaka, chattogram, rajshahi] },
  { id: "HLT-PLS-2026", service: "INPATIENT", waitingDays: 0, hospitalIds: [dhaka, chattogram, rajshahi] },
  { id: "HLT-SRG-2026", service: "SURGERY", waitingDays: 30, hospitalIds: [dhaka, chattogram] },
  { id: "HLT-DGN-2026", service: "DIAGNOSTIC", waitingDays: 0, hospitalIds: [dhaka, chattogram, rajshahi] },
  { id: "HLT-OPD-2026", service: "CONSULTATION", waitingDays: 0, hospitalIds: [dhaka, chattogram, rajshahi] },
];
const seedPolicies = [
  { key: "kazi", member: "Kazi", id: "POL-2026-000101", packageId: "HLT-PLS-2026" },
  { key: "sumit", member: "Sumit", id: "POL-2026-000102", packageId: "HLT-IND-2026" },
  { key: "abdullah", member: "Abdullah", id: "POL-2026-000103", packageId: "HLT-DGN-2026" },
  { key: "sadik", member: "Sadik", id: "POL-2026-000104", packageId: "HLT-SRG-2026" },
  { key: "rakibul", member: "Rakibul", id: "POL-2026-000105", packageId: "HLT-IND-2026", firstPremiumDue: true },
];
const seedClaimHospitals = new Map([
  ["CLM-2026-000201", dhaka],
  ["CLM-2026-000202", dhaka],
  [claim203, chattogram],
]);
const seedBenchmarks = [dhaka, chattogram].flatMap(hospitalId =>
  ["INPATIENT", "DIAGNOSTIC"].map(service => ({ hospitalId, service })),
);

function dateOnly(value, label) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  }
  return date;
}

function addDays(value, days) {
  const date = dateOnly(value, "Policy date");
  if (!Number.isSafeInteger(days) || days < 0) throw new Error("Policy day count must be a non-negative integer");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function policyDates(policy, today, defenceDate) {
  const waitFrom = policy.reinstatedDate || policy.coverStartDate;
  const waitingEnd = waitFrom ? addDays(waitFrom, policy.waitingDays) : null;
  const due = policy.status === "PENDING_PAYMENT" ? policy.startDate : policy.nextPremiumDueDate || policy.startDate;
  const graceEnd = due ? addDays(due, policy.gracePeriodDays || 15) : null;
  const waitingState = date => !waitingEnd ? "cover not started" : date < waitingEnd ? "waiting" : date === waitingEnd ? "ends today" : "ended";
  const graceState = date => !graceEnd ? "unavailable" : date < graceEnd ? "open" : date === graceEnd ? "last day" : "expired";
  const flag = policy.member === "Sadik" ? "Surgical waiting period" : policy.member === "Rakibul" ? "EFT grace deadline" : "";
  return {
    member: policy.member, id: policy.id, status: policy.status, waitingEnd, graceEnd, flag,
    waitingToday: waitingState(today), graceToday: graceState(today),
    waitingDefence: defenceDate ? waitingState(defenceDate) : null,
    graceDefence: defenceDate ? graceState(defenceDate) : null,
  };
}

function offlineSeed(summary) {
  const plans = seedPlans.filter(plan => summary.plans.includes(plan.id));
  const policies = seedPolicies.filter(policy => Object.hasOwn(summary.members, policy.key)).map(policy => {
    const firstPremiumDue = policy.firstPremiumDue;
    const plan = plans.find(plan => plan.id === policy.packageId);
    if (!plan) throw new Error(`Seed summary lacks the package for ${policy.id}`);
    return {
      ...policy, status: firstPremiumDue ? "PENDING_PAYMENT" : "ACTIVE",
      startDate: summary.seededOn, coverStartDate: firstPremiumDue ? "" : summary.seededOn,
      nextPremiumDueDate: addDays(summary.seededOn, firstPremiumDue ? 0 : 30),
      gracePeriodDays: 15, waitingDays: plan.waitingDays,
    };
  });
  return {
    plans, policies, benchmarks: seedBenchmarks,
    claims: summary.claims.map(claim => ({ ...claim, hospitalId: seedClaimHospitals.get(claim.id) })),
    snapshots: [{ hospitalId: dhaka, status: "ACTIVE", attestedAt: summary.seededOn }],
  };
}

export function buildSeedReport(summary, { today, defenceDate, live } = {}) {
  dateOnly(summary.seededOn, "Seed date");
  dateOnly(today, "Today");
  if (defenceDate !== undefined) dateOnly(defenceDate, "Defence date");
  const { plans, policies, claims, snapshots, benchmarks } = live ?? offlineSeed(summary);
  const hospitals = [...new Set(plans.flatMap(plan => plan.hospitalIds))];
  const services = [...new Set(plans.map(plan => plan.service))].sort();
  const registered = new Set(benchmarks.map(row => `${row.hospitalId}/${row.service}`));
  const benchmarkRows = hospitals.flatMap(hospital => services.map(service => ({
    hospital, service,
    coveredByPlan: plans.some(plan => plan.service === service && plan.hospitalIds.includes(hospital)),
    registered: registered.has(`${hospital}/${service}`),
  })));
  const activeSnapshots = snapshots.filter(row => row.status === "ACTIVE" && row.attestedAt);
  const activeHospitals = new Set(activeSnapshots.map(row => row.hospitalId));
  const claimHospital = claims.find(claim => claim.id === claim203)?.hospitalId ?? null;
  const attested = snapshots.some(row => row.hospitalId === claimHospital && row.attestedAt);
  const pending = claim => claim.status === "SUBMITTED" || claim.status === "APPEAL_SUBMITTED";
  const matching = predicate => claims.filter(predicate).map(claim => claim.id).sort();
  const runningOrder = [
    { step: "1–6: Customer, account, policy and premium", claims: [], note: "Check the policy table for seeded customers" },
    { step: "7–9: Intake, association and submission", claims: matching(() => true), note: "Existing medical claim examples" },
    { step: "10–11: Propose and attest registry", claims: matching(claim => pending(claim) && !activeHospitals.has(claim.hospitalId)), note: "Pending claims at hospitals without an active attestation" },
    { step: "12: Start Oracle processing", claims: matching(claim => pending(claim) && activeHospitals.has(claim.hospitalId)), note: "Pending claims at hospitals with an active attestation; confirm episode coverage before processing" },
    { step: "13: Prepare settlement", claims: matching(claim => claim.status === "APPROVED"), note: "Awaiting settlement authorization" },
    { step: "14: Bank payout", claims: matching(claim => claim.status === "SETTLEMENT_AUTHORIZED"), note: "Awaiting Bank confirmation" },
    { step: "15: Show settled claim", claims: matching(claim => claim.status === "SETTLED"), note: "Already settled" },
    { step: "Panel fallback", claims: matching(claim => ["ORACLE_FAILED", "MEDICAL_REVIEW_REQUIRED", "MEDICAL_REVIEW_PREPARING", "UNDER_REVIEW"].includes(claim.status)), note: "Fallback or review in progress" },
    { step: "Corrected appeal", claims: matching(claim => claim.status === "APPEAL_SUBMITTED" || Boolean(claim.currentAppealId)), note: "Appeal submitted or linked" },
    { step: "Final rejection", claims: matching(claim => claim.status === "REJECTED"), note: "Rejected examples; check appeal eligibility before calling a rejection final" },
  ];
  return {
    source: live ? "read-only dev-lite ledger" : "seed summary and seed procedure",
    days: { today, defenceDate },
    benchmarks: benchmarkRows,
    claim203Snapshot: { claimId: claim203, hospital: claimHospital, attested,
      active: activeSnapshots.filter(row => row.hospitalId === claimHospital && row.id).map(row => row.id) },
    policies: policies.map(policy => policyDates(policy, today, defenceDate)),
    runningOrder,
  };
}

export async function readRegisteredBenchmarks(evaluate, channel, chaincode) {
  const { common, peer } = requireWebDependency("@hyperledger/fabric-protos");
  const info = common.BlockchainInfo.deserializeBinary(await evaluate("GetChainInfo", channel));
  const height = info.getHeight();
  if (!Number.isSafeInteger(height) || height < 1) throw new Error("Cannot read the dev-lite block height");
  const registrations = new Map();
  // The write-once benchmark collection has no listing transaction. Check
  // VALID registration invocations so benchmarks without any episodes count.
  for (let number = 1; number < height; number++) {
    const block = common.Block.deserializeBinary(await evaluate("GetBlockByNumber", channel, String(number)));
    const filter = block.getMetadata()?.getMetadataList_asU8()[common.BlockMetadataIndex.TRANSACTIONS_FILTER];
    for (const [index, bytes] of (block.getData()?.getDataList_asU8() ?? []).entries()) {
      const envelope = common.Envelope.deserializeBinary(bytes);
      const payload = common.Payload.deserializeBinary(envelope.getPayload_asU8());
      const channelHeader = common.ChannelHeader.deserializeBinary(payload.getHeader().getChannelHeader_asU8());
      if (channelHeader.getType() !== common.HeaderType.ENDORSER_TRANSACTION) continue;
      if (filter?.[index] === undefined) throw new Error(`Block ${number} is missing transaction validation flags`);
      if (filter[index] !== peer.TxValidationCode.VALID) continue;
      const transaction = peer.Transaction.deserializeBinary(payload.getData_asU8());
      for (const action of transaction.getActionsList()) {
        const actionPayload = peer.ChaincodeActionPayload.deserializeBinary(action.getPayload_asU8());
        const proposal = peer.ChaincodeProposalPayload.deserializeBinary(actionPayload.getChaincodeProposalPayload_asU8());
        const spec = peer.ChaincodeInvocationSpec.deserializeBinary(proposal.getInput_asU8()).getChaincodeSpec();
        if (spec?.getChaincodeId()?.getName() !== chaincode) continue;
        const [name, hospitalId, service] = spec.getInput().getArgsList_asU8().map(value => Buffer.from(value).toString("utf8"));
        if (name !== "RegisterMedicalOracleBenchmark" || !hospitalId || !service) continue;
        registrations.set(`${hospitalId}/${service}`, { hospitalId, service });
      }
    }
  }
  return [...registrations.values()];
}

async function readLedger(summary) {
  const { devLiteProfile, withDevLitePeer } = await import("./dev-lite-gateway.mjs");
  return withDevLitePeer("insurer", async ({ network, contract }) => {
    const qscc = network.getContract("qscc");
    const evaluateBytes = async (source, name, ...args) => {
      try {
        return await source.evaluateTransaction(name, ...args);
      } catch {
        throw new Error(`Dev-lite evaluate failed for ${name}${name === "GetBlockByNumber" ? ` (block ${args[1]})` : ""}`);
      }
    };
    const evaluate = async (name, ...args) =>
      JSON.parse(Buffer.from(await evaluateBytes(contract, name, ...args)).toString("utf8"));
    const plans = [];
    for (const id of summary.plans) {
      const plan = await evaluate("ReadPolicyPackage", id);
      const rules = await evaluate("ReadMedicalRules", id);
      plans.push({ id, hospitalIds: plan.hospitalIds, service: rules.service, waitingDays: rules.waitingDays });
    }
    const policies = [];
    for (const { key, member, id } of seedPolicies) {
      if (!Object.hasOwn(summary.members, key)) continue;
      const policy = await evaluate("ReadPolicy", id);
      const plan = plans.find(plan => plan.id === policy.packageId);
      if (!plan) throw new Error(`Package ${policy.packageId} is missing from the seed plan readback`);
      policies.push({ ...policy, member, waitingDays: plan.waitingDays });
    }
    const claims = (await evaluate("ListClaims")).filter(claim => claim.episodeId);
    const snapshots = await evaluate("ListOracleRegistrySnapshots");
    const benchmarks = await readRegisteredBenchmarks((name, ...args) => evaluateBytes(qscc, name, ...args),
      devLiteProfile.channel, devLiteProfile.chaincodeName);
    return { plans, policies, claims, snapshots, benchmarks };
  });
}

async function latestSeedSummary() {
  const entries = (await readdir(seedRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^\d{8}-\d{6}(?:-|$)/.test(entry.name))
    .map(entry => entry.name).sort().reverse();
  for (const name of entries) {
    const file = path.join(seedRoot, name, "seed-summary.json");
    try {
      return { file, summary: JSON.parse(await readFile(file, "utf8")) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("No completed seed summary under data/dev-lite/demo-seed");
}

async function main() {
  const { values } = parseArgs({ options: { live: { type: "boolean" }, "defence-date": { type: "string" }, help: { type: "boolean" } } });
  if (values.help) {
    console.log("Usage: node scripts/validate-dev-lite-seed.mjs [--defence-date YYYY-MM-DD] [--live]");
    console.log("Use --live only with owner approval for read-only dev-lite ledger checks.");
    return;
  }
  const { file, summary } = await latestSeedSummary();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const defenceDate = values["defence-date"];
  if (defenceDate !== undefined) dateOnly(defenceDate, "Defence date");
  const live = values.live ? await readLedger(summary) : undefined;
  const result = buildSeedReport(summary, { today, defenceDate, live });
  console.log(`Evidence: ${result.source} (${path.relative(process.cwd(), file)})`);
  console.log(`Asia/Dhaka today: ${today}; defence date: ${defenceDate ?? "not supplied"}`);
  console.log("\nBenchmarks");
  console.table(result.benchmarks);
  const snapshot = result.claim203Snapshot;
  console.log(`\n${snapshot.claimId} hospital: ${snapshot.hospital ?? "claim unavailable"}; attested snapshot: ${snapshot.attested ? "yes" : "no"}; active snapshot IDs: ${snapshot.active.join(", ") || "none recorded"}`);
  console.log("\nPolicy waiting and grace periods");
  console.table(result.policies);
  console.log("\nRunning-order claim availability");
  console.table(result.runningOrder.map(row => ({ ...row, claims: row.claims.join(", ") || "none" })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof SyntaxError ? "Seed summary or profile JSON could not be read" : error.message);
    process.exitCode = 1;
  });
}
