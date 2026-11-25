import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ORACLE_COUNT = 3;
const ORACLE_THRESHOLD = 2;
const MAX_VERSION = 2;
const ORACLES = ["oracle1", "oracle2", "oracle3"];
const { values: options } = parseArgs({ options: { report: { type: "string" }, "no-write": { type: "boolean" } } });

const initial = Object.freeze({
  status: "SUBMITTED", claimVersion: 1, requestVersion: 0,
  revealed: [], oracleOutcome: "NONE",
  oracleApproved: false, approvalVersion: 0, approvalSource: "NONE",
  finalDecision: "NONE", settlementAuthorized: false, settled: false,
  staleResultsRejected: 0,
});

function transition(name, enabled, next) {
  return { name, enabled, next };
}

function approvals(votes) {
  return votes.filter(([, result]) => result === "match").length;
}

function transitions(state) {
  const same = (patch) => ({ ...state, ...patch });
  const reveals = [];
  if (state.status === "ORACLE_PENDING" && state.requestVersion === state.claimVersion) {
    for (const oracle of ORACLES.filter(id => !state.revealed.some(([subject]) => subject === id))) {
      for (const outcome of ["match", "conflict"]) {
        const revealed = [...state.revealed, [oracle, outcome]].sort(([left], [right]) => left.localeCompare(right));
        const patch = { revealed };
        if (approvals(revealed) >= ORACLE_THRESHOLD) {
          Object.assign(patch, { status: "APPROVED", oracleApproved: true,
            approvalVersion: state.claimVersion, approvalSource: "ORACLE", finalDecision: "APPROVE", oracleOutcome: "CONSENSUS" });
        } else if (revealed.length === ORACLE_COUNT) {
          patch.status = "UNDER_REVIEW";
          patch.oracleOutcome = "CONFLICT";
        }
        reveals.push(transition(outcome === "match" ? "MatchingOracleVote" : "ConflictingOracleVote",
          true, () => same(patch)));
      }
    }
  }
  return [
    transition("HospitalVerify", ["SUBMITTED", "APPEAL_SUBMITTED"].includes(state.status), () => same({ status: "HOSPITAL_VERIFIED" })),
    transition("RequestOracle", state.status === "HOSPITAL_VERIFIED", () => same({ status: "ORACLE_PENDING", requestVersion: state.claimVersion, revealed: [], oracleOutcome: "NONE", oracleApproved: false })),
    ...reveals,
    transition("OracleTimeout", state.status === "ORACLE_PENDING", () => same({ status: "UNDER_REVIEW", oracleOutcome: "TIMEOUT" })),
    transition("AuditorApprove", state.status === "UNDER_REVIEW", () => same({ status: "APPROVED", approvalVersion: state.claimVersion, approvalSource: "AUDITOR", finalDecision: "APPROVE" })),
    transition("AuditorReject", state.status === "UNDER_REVIEW", () => same({ status: "REJECTED", finalDecision: "REJECT" })),
    transition("Appeal", state.status === "REJECTED" && state.claimVersion < MAX_VERSION, () => same({ status: "APPEAL_SUBMITTED", claimVersion: state.claimVersion + 1, revealed: [], oracleOutcome: "NONE", oracleApproved: false, approvalVersion: 0, approvalSource: "NONE", finalDecision: "NONE" })),
    transition("RejectStaleOracleResult", state.requestVersion > 0 && state.requestVersion !== state.claimVersion && state.staleResultsRejected < 2, () => same({ staleResultsRejected: state.staleResultsRejected + 1 })),
    transition("AuthorizeSettlement", state.status === "APPROVED" && state.approvalVersion === state.claimVersion, () => same({ status: "SETTLEMENT_AUTHORIZED", settlementAuthorized: true })),
    transition("ConfirmSettlement", state.status === "SETTLEMENT_AUTHORIZED" && state.settlementAuthorized, () => same({ status: "SETTLED", settled: true })),
  ].filter((item) => item.enabled);
}

const invariants = {
  SettlementRequiresAuthorization: (s) => !s.settled || s.settlementAuthorized,
  AuthorizationRequiresCurrentApproval: (s) => !s.settlementAuthorized || (s.approvalVersion === s.claimVersion && s.finalDecision === "APPROVE"),
  OracleApprovalRequiresQuorum: (s) => !s.oracleApproved || (approvals(s.revealed) >= ORACLE_THRESHOLD && s.requestVersion === s.claimVersion),
  AtMostOneRevealPerAssignee: (s) => s.revealed.length <= ORACLE_COUNT &&
    new Set(s.revealed.map(([id]) => id)).size === s.revealed.length &&
    s.revealed.every(([id]) => ORACLES.includes(id)),
  ExhaustedRequestIsClosed: (s) => s.status !== "ORACLE_PENDING" || s.revealed.length < ORACLE_COUNT,
  CurrentApprovalOnly: (s) => !["APPROVED", "SETTLEMENT_AUTHORIZED", "SETTLED"].includes(s.status) || s.approvalVersion === s.claimVersion,
  NoConflictingFinalDecision: (s) => !(s.status === "REJECTED" && s.finalDecision === "APPROVE")
    && !(["APPROVED", "SETTLEMENT_AUTHORIZED", "SETTLED"].includes(s.status) && s.finalDecision === "REJECT"),
};

const key = (state) => JSON.stringify(state);
const queue = [{ state: initial, trace: [] }];
const visited = new Set([key(initial)]);
const transitionCounts = {};
let maximumDepth = 0;

while (queue.length) {
  const { state, trace } = queue.shift();
  maximumDepth = Math.max(maximumDepth, trace.length);
  for (const [name, invariant] of Object.entries(invariants)) {
    if (!invariant(state)) throw new Error(`${name} violated after ${trace.join(" -> ")}: ${JSON.stringify(state)}`);
  }
  for (const item of transitions(state)) {
    transitionCounts[item.name] = (transitionCounts[item.name] ?? 0) + 1;
    const next = item.next();
    const stateKey = key(next);
    if (!visited.has(stateKey)) {
      visited.add(stateKey);
      queue.push({ state: next, trace: [...trace, item.name] });
    }
  }
}

function legacyCounterexample() {
  let matches = 0, conflicts = 0, status = "ORACLE_PENDING";
  const trace = [];
  for (const kind of ["conflict", "conflict", "match", "match"]) {
    if (status !== "ORACLE_PENDING") throw new Error("Legacy counterexample unexpectedly closed");
    // The old matching branch counted only matches in its guard and did not
    // check exhaustion, unlike the old conflicting branch.
    if (kind === "match" && matches < ORACLE_COUNT) {
      if (++matches >= ORACLE_THRESHOLD) status = "APPROVED";
    } else if (kind === "conflict" && matches + conflicts < ORACLE_COUNT) {
      if (matches + ++conflicts === ORACLE_COUNT) status = "UNDER_REVIEW";
    }
    trace.push({ response: kind, matches, conflicts, status });
  }
  if (status !== "APPROVED" || matches + conflicts <= ORACLE_COUNT) throw new Error("Legacy counterexample missing");
  return trace;
}

const report = {
  model: "InsuranceWorkflow", checkedAt: new Date().toISOString(),
  parameters: { oracleCount: ORACLE_COUNT, oracleThreshold: ORACLE_THRESHOLD, maxVersion: MAX_VERSION },
  reachableStates: visited.size, maximumDepth, transitionCounts,
  invariants: Object.keys(invariants).map((name) => ({ name, status: "PASS" })),
  regression: { legacyCounterexample: legacyCounterexample() },
};
const directory = path.dirname(fileURLToPath(import.meta.url));
const output = options.report ? path.resolve(options.report) : path.join(directory, "reports", "latest.json");
if (!options["no-write"]) {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
}
console.log(JSON.stringify(report, null, 2));
