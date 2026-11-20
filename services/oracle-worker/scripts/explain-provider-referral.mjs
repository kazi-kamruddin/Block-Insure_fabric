import { readFile } from "node:fs/promises";
import { describeProviderReferral } from "../src/provider-reasons.mjs";

const [, , artifactFile, reviewFile] = process.argv;
try {
  if (!artifactFile || !reviewFile) throw new Error("Supply the logistic artifact and a review file with vector, cutoff, and bounds");
  const artifact = JSON.parse(await readFile(artifactFile, "utf8"));
  const { vector, cutoff, bounds } = JSON.parse(await readFile(reviewFile, "utf8"));
  console.log(describeProviderReferral(artifact, vector, cutoff, bounds).join("\n"));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
