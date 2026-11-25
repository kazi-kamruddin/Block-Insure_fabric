import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readR2Runtime } from "./r2-demo-runtime.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function retainedPackage(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "block-insure-r2-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageDirectory = "data/dev-lite/channel-artifacts/r2";
  const directory = path.join(root, packageDirectory);
  const binary = "test-only binary bytes";
  const archive = "test-only package bytes";
  const packageSha256 = digest(archive);
  const packageId = `insurance-contract_1.9.0-r2:${packageSha256}`;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "insurance-contract"), binary);
  await writeFile(path.join(directory, "insurance-contract_1.9.0-r2.tar.gz"), archive);
  await writeFile(path.join(directory, "package-id.txt"), packageId + "\n");
  return { root, directory, packageId, profile: {
    channel: "insurance-dev-lite-190", chaincodeName: "insurance-contract", chaincodeVersion: "1.9.0",
    expectedSequence: 3, database: "LevelDB",
    r2CandidateRuntime: { type: "ccaas", targetSequence: 3, packageDirectory, packageSha256,
      binarySha256: digest(binary), composeService: "insurance-chaincode", image: "hyperledger/fabric-peer:2.5.16" },
  } };
}

test("a sequence-3 profile selects only the exact retained package and binary", async t => {
  const { root, profile, packageId, directory } = await retainedPackage(t);
  assert.deepEqual(await readR2Runtime(profile, root), { packageId, sequence: 3, image: "hyperledger/fabric-peer:2.5.16", service: "insurance-chaincode" });
  await writeFile(path.join(directory, "insurance-contract"), "changed");
  await assert.rejects(readR2Runtime(profile, root), /binary SHA-256/);
});

test("an approved candidate is never selected as the active runtime", async t => {
  const { root, profile } = await retainedPackage(t);
  profile.expectedSequence = 2;
  await assert.rejects(readR2Runtime(profile, root), /expected sequence 3.*ledger readback/i);
});

test("wrong target and mismatched package ID fail closed", async t => {
  const { root, profile, directory } = await retainedPackage(t);
  await assert.rejects(readR2Runtime({ ...profile, channel: "insurance-channel" }, root), /dev-lite LevelDB/);
  await writeFile(path.join(directory, "package-id.txt"), "insurance-contract_1.9.0-r2:" + "f".repeat(64));
  await assert.rejects(readR2Runtime(profile, root), /package ID/);
});
