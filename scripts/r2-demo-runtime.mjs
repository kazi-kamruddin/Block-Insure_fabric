import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = "data/dev-lite/channel-artifacts/r2";
const sha256 = /^[a-f0-9]{64}$/;

async function fileSha256(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export async function readR2Runtime(profile, root, { candidate = false } = {}) {
  if (profile.channel !== "insurance-dev-lite-190" || profile.database !== "LevelDB" ||
      profile.chaincodeName !== "insurance-contract" || profile.chaincodeVersion !== "1.9.0") {
    throw new Error("The R2 demo requires the dev-lite LevelDB medical channel");
  }

  const runtime = profile.r2CandidateRuntime;
  if (runtime?.type !== "ccaas" || runtime.composeService !== "insurance-chaincode" ||
      runtime.image !== "hyperledger/fabric-peer:2.5.16" || runtime.packageDirectory !== directory ||
      !sha256.test(runtime.packageSha256) || !sha256.test(runtime.binarySha256) ||
      !Number.isInteger(runtime.targetSequence) || runtime.targetSequence < 3) {
    throw new Error("Invalid dev-lite R2 external runtime profile");
  }
  if (!candidate && profile.expectedSequence !== runtime.targetSequence) {
    throw new Error(`The R2 demo requires expected sequence ${runtime.targetSequence} after all-five-peer ledger readback`);
  }

  const label = `${profile.chaincodeName}_${profile.chaincodeVersion}-r2`;
  const packageId = `${label}:${runtime.packageSha256}`;
  const packageRoot = path.join(root, directory);
  if ((await readFile(path.join(packageRoot, "package-id.txt"), "utf8")).trim() !== packageId) {
    throw new Error("Retained R2 package ID differs from the profile");
  }
  if (await fileSha256(path.join(packageRoot, `${label}.tar.gz`)) !== runtime.packageSha256) {
    throw new Error("Retained R2 package SHA-256 differs from the profile");
  }
  if (await fileSha256(path.join(packageRoot, "insurance-contract")) !== runtime.binarySha256) {
    throw new Error("Retained R2 binary SHA-256 differs from the profile");
  }
  return { packageId, sequence: runtime.targetSequence, image: runtime.image, service: runtime.composeService };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const profile = JSON.parse(await readFile(new URL("./profiles/dev-lite-190.json", import.meta.url), "utf8"));
    const root = profile.repoRoot ?? fileURLToPath(new URL("..", import.meta.url));
    console.log(JSON.stringify(await readR2Runtime(profile, root, { candidate: process.argv[2] === "--candidate" })));
  } catch (error) {
    console.error(error.code === "ENOENT" ? "Retained R2 package files are incomplete" : error.message);
    process.exitCode = 1;
  }
}
