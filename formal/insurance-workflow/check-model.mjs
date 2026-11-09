import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORACLE_COUNT = 3;
const ORACLE_THRESHOLD = 2;
const MAX_VERSION = 2;

const initial = Object.freeze({
  status: "SUBMITTED", claimVersion: 1, requestVersion: 0,
  matchingOracleVotes: 0, conflictingOracleVotes: 0,
  oracleApproved: false, approvalVersion: 0, approvalSource: "NONE",
  finalDecision: "NONE", settlementAuthorized: false, settled: false,
  staleResultsRejected: 0,
});

function transition(name, enabled, next) {
  return { name, enabled, next };
}

function transitions(state) {
  const same = (patch) => ({ ...state, ...patch });
  return [
    transition("HospitalVerify", ["SUBMITTED", "APPEAL_SUBMITTED"].includes(state.status), () => same({ status: "HOSPITAL_VERIFIED" })),
    transition("RequestOracle", state.status === "HOSPITAL_VERIFIED", () => same({ status: "ORACLE_PENDING", requestVersion: state.claimVersion, matchingOracleVotes: 0, conflictingOracleVotes: 0, oracleApproved: false })),
    transition("MatchingOracleVote", state.status === "ORACLE_PENDING" && state.requestVersion === state.claimVersion && state.matchingOracleVotes < ORACLE_COUNT, () => {
      const votes = state.matchingOracleVotes + 1;
      return votes >= ORACLE_THRESHOLD
        ? same({ status: "APPROVED", matchingOracleVotes: votes, oracleApproved: true, approvalVersion: state.claimVersion, approvalSource: "ORACLE", finalDecision: "APPROVE" })
        : same({ matchingOracleVotes: votes });
    }),
    transition("ConflictingOracleVote", state.status === "ORACLE_PENDING" && state.requestVersion === state.claimVersion && state.matchingOracleVotes + state.conflictingOracleVotes < ORACLE_COUNT, () => {
      const conflicts = state.conflictingOracleVotes + 1;
      return same({ conflictingOracleVotes: conflicts, status: state.matchingOracleVotes + conflicts === ORACLE_COUNT ? "UNDER_REVIEW" : state.status });
    }),
    transition("OracleTimeout", state.status === "ORACLE_PENDING" && state.matchingOracleVotes < ORACLE_THRESHOLD, () => same({ status: "UNDER_REVIEW" })),
    transition("AuditorApprove", state.status === "UNDER_REVIEW", () => same({ status: "APPROVED", approvalVersion: state.claimVersion, approvalSource: "AUDITOR", finalDecision: "APPROVE" })),
    transition("AuditorReject", state.status === "UNDER_REVIEW", () => same({ status: "REJECTED", finalDecision: "REJECT" })),
    transition("Appeal", state.status === "REJECTED" && state.claimVersion < MAX_VERSION, () => same({ status: "APPEAL_SUBMITTED", claimVersion: state.claimVersion + 1, matchingOracleVotes: 0, conflictingOracleVotes: 0, oracleApproved: false, approvalVersion: 0, approvalSource: "NONE", finalDecision: "NONE" })),
    transition("RejectStaleOracleResult", state.requestVersion > 0 && state.requestVersion !== state.claimVersion && state.staleResultsRejected < 2, () => same({ staleResultsRejected: state.staleResultsRejected + 1 })),
    transition("AuthorizeSettlement", state.status === "APPROVED" && state.approvalVersion === state.claimVersion, () => same({ status: "SETTLEMENT_AUTHORIZED", settlementAuthorized: true })),
    transition("ConfirmSettlement", state.status === "SETTLEMENT_AUTHORIZED" && state.settlementAuthorized, () => same({ status: "SETTLED", settled: true })),
  ].filter((item) => item.enabled);
}

const invariants = {
  SettlementRequiresAuthorization: (s) => !s.settled || s.settlementAuthorized,
  AuthorizationRequiresCurrentApproval: (s) => !s.settlementAuthorized || (s.approvalVersion === s.claimVersion && s.finalDecision === "APPROVE"),
  OracleApprovalRequiresQuorum: (s) => !s.oracleApproved || (s.matchingOracleVotes >= ORACLE_THRESHOLD && s.requestVersion === s.claimVersion),
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

const report = {
  model: "InsuranceWorkflow", checkedAt: new Date().toISOString(),
  parameters: { oracleCount: ORACLE_COUNT, oracleThreshold: ORACLE_THRESHOLD, maxVersion: MAX_VERSION },
  reachableStates: visited.size, maximumDepth, transitionCounts,
  invariants: Object.keys(invariants).map((name) => ({ name, status: "PASS" })),
};
const directory = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(directory, "reports", "latest.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
