export function evaluateThreshold({ responses, requiredConfirmations, expectedResponses, deadlineExpired = false }) {
  if (!Array.isArray(responses)) throw new Error("responses must be an array");
  if (!Number.isInteger(expectedResponses) || expectedResponses < 1) throw new Error("expectedResponses must be positive");
  if (!Number.isInteger(requiredConfirmations) || requiredConfirmations <= expectedResponses / 2 || requiredConfirmations > expectedResponses) {
    throw new Error("requiredConfirmations must be a strict majority no greater than expectedResponses");
  }
  const revealed = responses.filter((value) => value !== null && value !== undefined);
  const counts = new Map();
  for (const resultHash of revealed) counts.set(resultHash, (counts.get(resultHash) ?? 0) + 1);
  const decisions = [...counts.entries()].filter(([, count]) => count >= requiredConfirmations);
  if (decisions.length > 1) throw new Error("strict-majority safety violation: multiple results reached quorum");
  if (decisions.length === 1) {
    return { status: "CONSENSUS", resultHash: decisions[0][0], matchingResponses: decisions[0][1], revealedResponses: revealed.length };
  }
  if (revealed.length === expectedResponses) return { status: "CONFLICT", resultHash: null, matchingResponses: 0, revealedResponses: revealed.length };
  if (deadlineExpired) return { status: "TIMEOUT", resultHash: null, matchingResponses: 0, revealedResponses: revealed.length };
  return { status: "PENDING", resultHash: null, matchingResponses: 0, revealedResponses: revealed.length };
}

export function enumerateThreeOracleStateSpace() {
  const values = [null, "A", "B", "C"];
  const cases = [];
  for (const first of values) {
    for (const second of values) {
      for (const third of values) {
        const responses = [first, second, third];
        cases.push({ responses, outcome: evaluateThreshold({ responses, requiredConfirmations: 2, expectedResponses: 3, deadlineExpired: true }) });
      }
    }
  }
  return cases;
}
