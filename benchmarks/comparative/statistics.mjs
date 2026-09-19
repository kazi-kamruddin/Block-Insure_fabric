export function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function median(values) {
  if (!values.length) throw new Error("at least one observation is required");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function percentile(values, percentage) {
  if (!values.length) throw new Error("at least one observation is required");
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1);
  return sorted[rank];
}

export function sampleStandardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((total, value) => total + ((value - average) ** 2), 0) / (values.length - 1));
}

export function confidenceInterval95(values) {
  const average = mean(values);
  const margin = 1.96 * sampleStandardDeviation(values) / Math.sqrt(values.length);
  return { lower: average - margin, upper: average + margin, margin };
}

export function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}
