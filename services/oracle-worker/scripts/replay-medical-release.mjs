import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { evaluatorHash, evaluatorVersion, routeModel } from "../src/xgboost.mjs";

export function replayRelease(release, inputs) {
  if (release.intendedTask !== "ROUTING" || release.modelVersion !== evaluatorVersion || release.artifactHash !== evaluatorHash) {
    throw new Error("Named release does not match a supported installed routing evaluator");
  }
  return inputs.map(({ snapshot, request, claim, priorRoute, baseAssessment, mandatoryReview }) => {
    if (typeof mandatoryReview !== "boolean" || !["PANEL", "ORACLE_AUTO"].includes(priorRoute)) {
      throw new Error("Every replay input needs its prior route and mandatory-review flag");
    }
    const assessment = routeModel({ snapshot, claim, assessment: baseAssessment,
      request: { ...request, modelReleaseId: release.id, modelVersion: release.modelVersion, modelHash: release.artifactHash } });
    const replayRoute = !mandatoryReview && assessment.verified ? "ORACLE_AUTO" : "PANEL";
    return { claimId: claim.id, claimVersion: request.claimVersion, priorRoute, replayRoute, verificationCode: assessment.verificationCode };
  }).filter(row => row.priorRoute !== row.replayRoute);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , releaseId, releaseFile, inputFile] = process.argv;
  try {
    if (!releaseId || !releaseFile || !inputFile) throw new Error("Usage: node scripts/replay-medical-release.mjs RELEASE_ID RELEASE_JSON INPUT_JSON");
    const release = JSON.parse(await readFile(releaseFile, "utf8"));
    if (release.id !== releaseId) throw new Error("Release ID differs from the supplied release file");
    const inputs = JSON.parse(await readFile(inputFile, "utf8"));
    console.log(JSON.stringify({ releaseId, evaluated: inputs.length, changed: replayRelease(release, inputs) }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
