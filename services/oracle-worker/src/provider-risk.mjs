import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function scoreProviderRisk(artifact, vector) {
  const { model, features, scoreScale } = artifact;
  if (model.kind !== "logistic" || vector.length !== features.length || model.weights.length !== vector.length + 1 ||
      ![...vector, ...model.means, ...model.scales, ...model.weights, ...model.calibration].every(Number.isFinite) ||
      model.means.length !== vector.length || model.scales.length !== vector.length || model.calibration.length !== 2 ||
      !model.scales.every(scale => scale > 0) || model.calibration[1] < 0 || !Number.isSafeInteger(scoreScale) || scoreScale <= 0) {
    throw new Error("Invalid logistic artifact or provider vector");
  }
  const contributions = vector.map((value, index) => ({
    feature: features[index],
    marginContribution: model.weights[index + 1] * (value - model.means[index]) / model.scales[index],
  }));
  const margin = model.weights[0] + contributions.reduce((sum, item) => sum + item.marginContribution, 0);
  const logOdds = Math.max(-35, Math.min(35, model.calibration[0] + margin * model.calibration[1]));
  const scoreUnits = Math.round(scoreScale / (1 + Math.exp(-logOdds)));
  return { scoreUnits, contributions };
}

export async function observeProviderShadow({ release, artifactPath, catalogPath, hospitalId }) {
  if (release.intendedTask !== "ADVISORY" || release.status !== "SHADOW") return null;
  const bytes = await readFile(artifactPath);
  if (createHash("sha256").update(bytes).digest("hex") !== release.artifactHash) throw new Error("Provider artifact does not match release");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const vector = Object.hasOwn(catalog, hospitalId) ? catalog[hospitalId] : null;
  if (!Array.isArray(vector)) return null;
  const { scoreUnits } = scoreProviderRisk(JSON.parse(bytes.toString("utf8")), vector);
  return { releaseId: release.id, scoreUnits };
}
