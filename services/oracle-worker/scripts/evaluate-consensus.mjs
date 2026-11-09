import { enumerateThreeOracleStateSpace, evaluateThreshold } from "../src/threshold-model.mjs";

const scenarios = [
  { name: "healthy", responses: ["A", "A", "A"], toleratedFaults: 0 },
  { name: "one_unavailable", responses: ["A", "A", null], toleratedFaults: 1 },
  { name: "one_divergent", responses: ["A", "A", "B"], toleratedFaults: 1 },
  { name: "all_divergent", responses: ["A", "B", "C"], toleratedFaults: 0 },
  { name: "quorum_unavailable", responses: ["A", null, null], toleratedFaults: 0 },
].map((scenario) => ({
  ...scenario,
  outcome: evaluateThreshold({ responses: scenario.responses, requiredConfirmations: 2, expectedResponses: 3, deadlineExpired: true }),
}));

const stateSpace = enumerateThreeOracleStateSpace();
const summary = Object.fromEntries(["CONSENSUS", "CONFLICT", "TIMEOUT", "PENDING"].map((status) => [
  status.toLowerCase(), stateSpace.filter((item) => item.outcome.status === status).length,
]));
process.stdout.write(`${JSON.stringify({
  protocol: "2-of-3-strict-majority",
  evaluatedStates: stateSpace.length,
  safetyProperty: "At most one result hash can reach quorum in a request",
  summary,
  scenarios,
}, null, 2)}\n`);
