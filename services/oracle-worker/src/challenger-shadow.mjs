import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { challengerFeatures, protocol } from "../../../benchmarks/ml-challengers/cohort.mjs";
import { scoreChallenger } from "../../../benchmarks/ml-challengers/models.mjs";
import { evaluatorHash, evaluatorVersion, hash } from "./xgboost.mjs";
import { devLiteProfile } from "../../../scripts/dev-lite-gateway.mjs";

const selectedModels = ["additive-stumps", "monotonic-ranker"];

export async function loadChallengerShadow(channel, file, expectedHash) {
  if (!["insurance-medical-reimbursement", devLiteProfile.channel].includes(channel) ||
      !isAbsolute(file) || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error("Shadow requires the isolated medical channel and a pinned absolute artifact path");
  }
  const artifact = JSON.parse(await readFile(file, "utf8"));
  if (hash(artifact) !== expectedHash || artifact.protocol !== protocol.version ||
      artifact.incumbent?.evaluatorVersion !== evaluatorVersion || artifact.incumbent?.evaluatorHash !== evaluatorHash) {
    throw new Error("Shadow artifact identity mismatch");
  }
  const models = selectedModels.map(id => artifact.models.find(model => model.id === id));
  if (models.some(model => !model)) throw new Error("Both challenger artifacts are required");
  return { models, peers: artifact.peers, artifactHash: expectedHash };
}

export function shadowChallengerScores(shadow, packet) {
  if (!packet?.prepared || packet.prepared.observation.mandatory || packet.prepared.cutoff.slice(0, 10) <= shadow.peers.cutoff) return null;
  const features = challengerFeatures(packet.source, packet.records, packet.prepared, shadow.peers);
  const scores = Object.fromEntries(shadow.models.map(model => [model.id, scoreChallenger(model, features).scoreUnits]));
  if (Object.values(scores).some(score => !Number.isSafeInteger(score))) throw new Error("Invalid shadow score");
  return { artifactHash: shadow.artifactHash, inputHash: hash(features), scores };
}
