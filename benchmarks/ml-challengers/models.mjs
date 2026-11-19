import { commonFeatures, rankFeatures, protocol } from "./cohort.mjs";

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));
const mean = (values) => values.reduce((sum, n) => sum + n, 0) / values.length;
const clip = (x, low, high) => Math.min(high, Math.max(low, x));
const l2 = 2;
const shrinkage = 0.15;
const rounds = 48;

function scaler(columns) {
  return columns.map((column) => {
    const offset = mean(column);
    return { offset, scale: Math.max(1e-6, Math.sqrt(mean(column.map((x) => (x - offset) ** 2)))) };
  });
}

function logistic(matrix, labels, { steps = 500, penalty = 0.02, nonnegative = false } = {}) {
  const weights = matrix[0].map(() => 0);
  let intercept = logit(clip(mean(labels), 1e-7, 1 - 1e-7));
  for (let iteration = 0; iteration < steps; iteration++) {
    const loss = matrix.map((row, i) => sigmoid(intercept + dot(row, weights)) - labels[i]);
    intercept -= 0.13 * mean(loss);
    for (let j = 0; j < weights.length; j++) {
      const update = mean(matrix.map((row, i) => row[j] * loss[i])) + penalty * weights[j];
      weights[j] -= 0.13 * update;
      if (nonnegative) weights[j] = Math.max(0, weights[j]);
    }
  }
  return { intercept, weights };
}

const dot = (x, y) => x.reduce((sum, value, j) => sum + value * y[j], 0);
const rowValues = (row, names) => names.map((name) => row.features[name]);

function thresholds(values) {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  return [...new Set(Array.from({ length: Math.min(15, unique.length - 1) }, (_, j) =>
    Math.floor((j + 1) * unique.length / Math.min(16, unique.length)),
  ))].map((j) => (unique[j - 1] + unique[j]) / 2);
}

function sumGradients(indices, gradients, hessians) {
  return indices.reduce(([g, h], row) => [g + gradients[row], h + hessians[row]], [0, 0]);
}

const objective = ([g, h], weight) => g * weight - (h + l2) * weight ** 2 / 2;
const optimum = ([g, h], low, high) => clip(g / (h + l2), low, high);

function fitTree({ rows, names, cuts, gradients, hessians, monotone }, indices, depth, low = -3, high = 3) {
  const stat = sumGradients(indices, gradients, hessians);
  const value = optimum(stat, low, high);
  const baseline = objective(stat, value);
  let best;
  if (depth > 0) for (const feature of names) {
    const increasing = monotone.includes(feature);
    for (const cut of cuts[feature]) {
      const left = [], right = [];
      for (const i of indices) (rows[i].features[feature] < cut ? left : right).push(i);
      if (left.length < 6 || right.length < 6) continue;
      const first = sumGradients(left, gradients, hessians);
      const second = sumGradients(right, gradients, hessians);
      let leftWeight = optimum(first, low, high), rightWeight = optimum(second, low, high);
      if (increasing && leftWeight > rightWeight) {
        leftWeight = rightWeight = clip(stat[0] / (stat[1] + 2 * l2), low, high);
      }
      const gain = objective(first, leftWeight) + objective(second, rightWeight) - baseline;
      if (gain > (best?.gain ?? 1e-8)) best = { feature, cut, left, right, gain, pivot: increasing ? (leftWeight + rightWeight) / 2 : null };
    }
  }
  if (!best) return { leaf: shrinkage * value, count: indices.length };
  const context = { rows, names, cuts, gradients, hessians, monotone };
  return { feature: best.feature, cut: best.cut,
    left: fitTree(context, best.left, depth - 1, low, best.pivot ?? high),
    right: fitTree(context, best.right, depth - 1, best.pivot ?? low, high) };
}

export function treeValue(tree, features) {
  while (tree.leaf === undefined) tree = features[tree.feature] < tree.cut ? tree.left : tree.right;
  return tree.leaf;
}

function trainingPairs(rows) {
  const groups = new Map();
  rows.forEach((row, i) => {
    if (!groups.has(row.provider)) groups.set(row.provider, [[], []]);
    groups.get(row.provider)[row.label].push(i);
  });
  return [...groups.values()].flatMap(([negative, positive]) => {
    if (!positive.length || !negative.length) return [];
    const weight = (positive.length + negative.length) / (positive.length * negative.length);
    return positive.flatMap((p) => negative.map((n) => ({ p, n, weight })));
  });
}

function fitBoosting(rows, ranker, monotone) {
  const features = ranker ? rankFeatures : commonFeatures;
  const id = ranker ? (monotone.length ? "monotonic-ranker" : "unconstrained-ranker") : "additive-stumps";
  const cuts = Object.fromEntries(features.map((name) => [name, thresholds(rows.map((row) => row.features[name]))]));
  const base = ranker ? 0 : logit(mean(rows.map((row) => row.label)));
  const scores = rows.map(() => base), trees = [], indices = rows.map((_, i) => i);
  const pairs = ranker ? trainingPairs(rows) : [];
  if (ranker && !pairs.length) throw new Error("Rank training requires within-provider opposing labels");
  for (let round = 0; round < rounds; round++) {
    const probabilities = scores.map(sigmoid);
    const gradients = rows.map((row, i) => ranker ? 0 : row.label - probabilities[i]);
    const hessians = rows.map((_, i) => ranker ? 0 : probabilities[i] * (1 - probabilities[i]));
    for (const { p, n, weight } of pairs) {
      const error = sigmoid(scores[n] - scores[p]);
      gradients[p] += weight * error;
      gradients[n] -= weight * error;
      hessians[p] += weight * error * (1 - error);
      hessians[n] += weight * error * (1 - error);
    }
    const tree = fitTree({ rows, names: features, cuts, gradients, hessians, monotone }, indices, ranker ? 3 : 1);
    trees.push(tree);
    for (let i = 0; i < scores.length; i++) scores[i] += treeValue(tree, rows[i].features);
  }
  return { id, features, base, trees, monotone, objective: ranker ? "provider-pairwise-logistic" : "binary-logistic" };
}

export function rawMargin(model, features) {
  if (!model.features.every((key) => Number.isFinite(features[key]))) throw new Error("Missing or invalid challenger feature");
  if (model.trees) return model.trees.reduce((sum, tree) => sum + treeValue(tree, features), model.base);
  const values = model.features.map((key) => features[key]);
  if (model.id === "peer-excess-only") return values[0];
  if (model.id === "logistic") return model.intercept + dot(model.weights, values.map((v, i) => (v - model.scaling[i].offset) / model.scaling[i].scale));
  return model.base + model.rules.reduce((sum, rule, i) => sum + (values[i] > rule.median ? rule.high : rule.low), 0);
}

function fitBernoulli(rows) {
  const positive = rows.filter((row) => row.label === 1);
  const negative = rows.filter((row) => row.label === 0);
  const rules = commonFeatures.map((feature) => {
    const values = rows.map((row) => row.features[feature]).sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    const probability = (group) => (1 + group.filter((row) => row.features[feature] > median).length) / (group.length + 2);
    const yes = probability(positive), no = probability(negative);
    return { median, high: Math.log(yes / no), low: Math.log((1 - yes) / (1 - no)) };
  });
  return { id: "bernoulli-nb", features: commonFeatures, base: Math.log(positive.length / negative.length), rules };
}

export function fitModels(training, calibration) {
  const train = training.filter((row) => !row.mandatory);
  const calibrate = calibration.filter((row) => !row.mandatory);
  for (const split of [train, calibrate]) {
    if (!split.some((row) => row.label === 0) || !split.some((row) => row.label === 1)) throw new Error("Both classes are required in residual fitting splits");
  }
  const scaling = scaler(commonFeatures.map((name) => train.map((row) => row.features[name])));
  const input = train.map((row) => rowValues(row, commonFeatures).map((x, i) => (x - scaling[i].offset) / scaling[i].scale));
  const models = [
    fitBernoulli(train),
    { id: "logistic", features: commonFeatures, scaling, ...logistic(input, train.map((row) => row.label)) },
    fitBoosting(train, false, []),
    fitBoosting(train, true, ["peerExcess", "overlap14"]),
    { id: "peer-excess-only", features: ["peerExcess"] },
    fitBoosting(train, true, []),
  ];
  return models.map((model) => {
    const scores = calibrate.map((row) => rawMargin(model, row.features));
    const [{ offset, scale }] = scaler([scores]);
    const fit = logistic(scores.map((score) => [(score - offset) / scale]), calibrate.map((row) => row.label),
      { nonnegative: true, penalty: 0.005 });
    const slope = fit.weights[0] / scale;
    return { ...model, calibration: { slope, intercept: fit.intercept - slope * offset } };
  });
}

export function scoreChallenger(model, features) {
  const margin = rawMargin(model, features);
  const probability = sigmoid(model.calibration.intercept + model.calibration.slope * margin);
  const result = { margin, probability, scoreUnits: Math.round(probability * protocol.scoreScale) };
  if (model.id !== "additive-stumps") return result;
  let base = model.base;
  const contributions = Object.fromEntries(model.features.map((name) => [name, 0]));
  for (const stump of model.trees) {
    if (stump.leaf !== undefined) {
      base += stump.leaf;
      continue;
    }
    const expected = (stump.left.leaf * stump.left.count + stump.right.leaf * stump.right.count) / (stump.left.count + stump.right.count);
    base += expected;
    contributions[stump.feature] += treeValue(stump, features) - expected;
  }
  return { ...result, explanation: { base, contributions } };
}
