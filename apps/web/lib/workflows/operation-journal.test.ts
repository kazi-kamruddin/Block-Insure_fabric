import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Contract, Gateway, Identity } from "@hyperledger/fabric-gateway";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/fabric/gateway", () => ({ withFabricContract: vi.fn() }));
import { withFabricContract } from "@/lib/fabric/gateway";
import { OperationStore, runRecoverableOperation, submitJournaled } from "./operation-journal";

let root: string;
const secret = "synthetic recovery secret with at least 32 characters";
const session = { accountId: "policyholder-1", subjectId: "policyholder1", role: "policyholder" as const, issuedAt: 1, expiresAt: 9999999999 };
const identity: Identity = { mspId: "InsurerMSP", credentials: Buffer.from("synthetic public certificate") };
const command = { operation: "submitClaim", id: "claim-one", amountMinor: 100 };
const requestId = "synthetic-request-0000000001";
const status = vi.fn(), submit = vi.fn(), endorse = vi.fn();
const gateway = { newCommit: vi.fn(() => ({ getStatus: status })) } as unknown as Gateway;
const contract = { newProposal: vi.fn(() => ({ endorse })), submitTransaction: vi.fn() } as unknown as Contract;
function run(execute: () => Promise<unknown>, changes = {}) { return runRecoverableOperation({ requestId, command, session, secret, root, ...changes }, execute); }
const execute = () => submitJournaled(contract, gateway, identity, "policyholder", "SubmitInvoiceClaim", [command.id]).then(bytes => JSON.parse(Buffer.from(bytes).toString()));
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "fabric-workflow-journal-")); vi.clearAllMocks();
  vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-recovery-test");
  endorse.mockResolvedValue({ getTransactionId: () => "actual-transaction-id", getResult: () => Buffer.from('{"id":"claim-one","status":"SUBMITTED"}'), submit });
  submit.mockResolvedValue({}); status.mockResolvedValue({ successful: true, code: 0, transactionId: "actual-transaction-id", blockNumber: 10n });
  vi.mocked(withFabricContract).mockImplementation(async (_role, action) => action(contract, gateway, identity));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

it("recovers a lost submit/status response from durable preparation without another endorsement or submission", async () => {
  submit.mockRejectedValueOnce(new Error("response lost")); status.mockRejectedValueOnce(new Error("status deadline"));
  expect(await run(execute)).toMatchObject({ state: "PENDING", transactionId: "actual-transaction-id" });
  const mustNotExecute = vi.fn();
  expect(await run(mustNotExecute, { recoverOnly: true })).toMatchObject({ state: "COMMITTED", validationCode: 0, result: { id: "claim-one" } });
  expect(mustNotExecute).not.toHaveBeenCalled(); expect(endorse).toHaveBeenCalledTimes(1); expect(submit).toHaveBeenCalledTimes(1);
  expect(await run(mustNotExecute)).toMatchObject({ state: "COMMITTED", recovered: true });
});
it("does not present an endorsed result as successful when Fabric commits INVALID/MVCC", async () => {
  status.mockResolvedValueOnce({ successful: false, code: 11, transactionId: "actual-transaction-id", blockNumber: 11n });
  expect(await run(execute)).toMatchObject({ state: "INVALID", validationCode: 11 });
  expect(await run(vi.fn())).not.toHaveProperty("result"); expect(endorse).toHaveBeenCalledTimes(1);
});
it("serializes duplicate business requests and rejects changed intent under the same identity", async () => {
  const outcomes = await Promise.all([run(execute), run(execute)]);
  expect(outcomes.map(row => row.state)).toEqual(["COMMITTED", "COMMITTED"]); expect(endorse).toHaveBeenCalledTimes(1);
  await expect(run(vi.fn(), { command: { ...command, amountMinor: 999 } })).rejects.toThrow("different command");
});
it("isolates account and deployment recovery and never sends a recovery-only missing request", async () => {
  await run(execute); const untouched = vi.fn();
  expect(await run(untouched, { session: { ...session, accountId: "another-owner" }, recoverOnly: true })).toMatchObject({ state: "NOT_SUBMITTED" });
  vi.stubEnv("FABRIC_CHANNEL_NAME", "another-channel");
  expect(await run(untouched, { recoverOnly: true })).toMatchObject({ state: "NOT_SUBMITTED" }); expect(untouched).not.toHaveBeenCalled();
});
it("preserves pre-submit rejection as terminal and does not rerun it implicitly", async () => {
  endorse.mockRejectedValueOnce(new Error("appeal version rejected"));
  expect(await run(execute)).toMatchObject({ state: "REJECTED", message: "appeal version rejected" });
  expect(await run(execute)).toMatchObject({ state: "REJECTED", recovered: true }); expect(submit).not.toHaveBeenCalled(); expect(endorse).toHaveBeenCalledTimes(1);
});
it("encrypts records, rejects tampering and never overwrites a reserved outcome", async () => {
  const store = new OperationStore(path.join(root, "store"), secret);
  expect(await store.publish("intent", { privateValue: "do-not-expose" })).toBe(true);
  expect(await store.publish("intent", { privateValue: "replacement" })).toBe(false);
  const file = path.join(root, "store/intent.json"), text = await readFile(file, "utf8"); expect(text).not.toContain("do-not-expose");
  const tampered = JSON.parse(text); tampered.tag = Buffer.alloc(16).toString("base64"); await writeFile(file, JSON.stringify(tampered));
  await expect(store.read("intent")).rejects.toThrow();
});
it("checks prepared recovery against the original public certificate", async () => {
  status.mockRejectedValueOnce(new Error("unavailable")); await run(execute);
  vi.mocked(withFabricContract).mockImplementation(async (_role, action) => action(contract, gateway, { ...identity, credentials: Buffer.from("rotated certificate") }));
  await expect(run(vi.fn(), { recoverOnly: true })).rejects.toThrow("identity changed");
});
it("resolves independent store instances from immutable published bytes", async () => {
  const directory = path.join(root, "same-store"), first = new OperationStore(directory, secret), restarted = new OperationStore(directory, secret);
  const winners = await Promise.all([first.publish("outcome", { state: "COMMITTED" }), restarted.publish("outcome", { state: "INVALID" })]);
  expect(winners.filter(Boolean)).toHaveLength(1); expect(await first.read("outcome")).toEqual(await restarted.read("outcome"));
  expect((await readdir(directory)).filter(name => name.endsWith(".tmp"))).toHaveLength(0);
});
it("keeps a blank optional journal root under ignored data rather than the application directory", async () => {
  vi.stubEnv("FABRIC_NETWORK_ROOT", path.join(root, "network")); vi.stubEnv("WORKFLOW_OPERATION_ROOT", "");
  const observed: string[] = [];
  const read = vi.spyOn(OperationStore.prototype, "read").mockImplementation(async function(this: OperationStore) { observed.push(this.directory); return null; });
  try {
    expect(await run(vi.fn(), { root: undefined, recoverOnly: true })).toMatchObject({ state: "NOT_SUBMITTED" });
    expect(observed.every(directory => directory.startsWith(path.join(root, "data/workflow-operations") + path.sep))).toBe(true);
  } finally { read.mockRestore(); }
});
it("recovers legacy encrypted records without rewriting them or executing another transaction", async () => {
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const deployment = hash(JSON.stringify(["insurance-recovery-test", "insurance-contract"]));
  const owner = hash(JSON.stringify([session.accountId, session.subjectId, session.role]));
  const directory = path.join(root, deployment, owner, hash(requestId)), store = new OperationStore(directory, secret);
  await store.publish("intent", { digest: hash(JSON.stringify(command, Object.keys(command).sort())), ownerPid: process.pid, expected: "SubmitInvoiceClaim" });
  await store.publish("outcome", { state: "COMMITTED", validationCode: 0, transactionId: "original-legacy-transaction", result: { id: command.id } });
  const original = await readFile(path.join(directory, "outcome.json")), neverExecute = vi.fn();
  expect(await run(neverExecute, { recoverOnly: true })).toMatchObject({ state: "COMMITTED", transactionId: "original-legacy-transaction", recovered: true });
  expect(neverExecute).not.toHaveBeenCalled(); expect(await readFile(path.join(directory, "outcome.json"))).toEqual(original);
});
it("uses a fully qualified compact v2 path for new operations on Windows", async () => {
  await run(execute);
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith(".json"));
  expect(files).toHaveLength(3); expect(files.every(file => file.startsWith("v2" + path.sep))).toBe(true);
  expect(files.every(file => path.join(root, file).length < 260)).toBe(true);
});
it("restores v2 ciphertext under another root while rejecting a different operation namespace", async () => {
  const original = new OperationStore(path.join(root, "original/v2", "a".repeat(64)), secret);
  const restored = new OperationStore(path.join(root, "restored/v2", "a".repeat(64)), secret);
  await original.publish("outcome", { state: "COMMITTED", result: { id: "restore-case" } });
  await restored.publish("outcome", {});
  await writeFile(path.join(restored.directory, "outcome.json"), await readFile(path.join(original.directory, "outcome.json")));
  expect(await restored.read("outcome")).toMatchObject({ state: "COMMITTED", result: { id: "restore-case" } });
  const changed = new OperationStore(path.join(root, "restored/v2", "b".repeat(64)), secret); await changed.publish("outcome", {});
  await writeFile(path.join(changed.directory, "outcome.json"), await readFile(path.join(original.directory, "outcome.json")));
  await expect(changed.read("outcome")).rejects.toThrow();
});
