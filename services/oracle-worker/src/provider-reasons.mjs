import { scoreProviderRisk } from "./provider-risk.mjs";

export function describeProviderReferral(artifact, vector, cutoff, bounds) {
  if (!Number.isSafeInteger(cutoff) || cutoff < 1 || cutoff > artifact.scoreScale || bounds.length !== vector.length) {
    throw new Error("Supply the fixed referral cutoff and a bound for each feature");
  }
  const initial = scoreProviderRisk(artifact, vector);
  const lines = initial.contributions.map(({ feature, marginContribution }) => `${feature}: ${marginContribution.toFixed(4)} log-odds contribution before calibration.`);
  if (initial.scoreUnits < cutoff) return [...lines, "The score is below this referral cutoff."];
  let best;
  for (const [index, { min, max, step }] of bounds.entries()) {
    const value = vector[index];
    if (![min, max, step].every(Number.isFinite) || step <= 0 || min > value || max < value) {
      throw new Error(`Invalid feasible range for ${artifact.features[index]}`);
    }
    const direction = -Math.sign(artifact.model.weights[index + 1] * artifact.model.calibration[1]);
    if (!direction) continue;
    let low = 1;
    let high = Math.floor((direction < 0 ? value - min : max - value) / step);
    if (!Number.isSafeInteger(high)) throw new Error("Feature step count exceeds the safe integer range");
    const candidate = steps => {
      const changed = [...vector];
      changed[index] += direction * steps * step;
      return scoreProviderRisk(artifact, changed).scoreUnits;
    };
    if (high < low || candidate(high) >= cutoff) continue;
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (candidate(mid) < cutoff) high = mid;
      else low = mid + 1;
    }
    const delta = direction * low * step;
    const distance = Math.abs(delta) / artifact.model.scales[index];
    if (!best || distance < best.distance) best = { feature: artifact.features[index], value, delta, distance };
  }
  lines.push(best ? `Smallest tested single-feature change in standard deviation units: ${best.feature} from ${best.value} to ${Number((best.value + best.delta).toPrecision(12))}.`
    : "No feasible single-feature change crosses the cutoff within the supplied ranges.");
  lines.push("This is a model sensitivity explanation. Review and payout authority remain unchanged.");
  return lines;
}
