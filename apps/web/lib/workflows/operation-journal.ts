import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gateway as protoGateway, msp } from "@hyperledger/fabric-protos";
import type { Contract, Gateway, Identity } from "@hyperledger/fabric-gateway";
import { loadFabricConfig, type FabricRole } from "@/lib/fabric/config";
import { withFabricContract } from "@/lib/fabric/gateway";
import type { Session } from "@/lib/auth/session-token";
import { recoverableTransactions } from "./recoverable";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
export type OperationOutcome = { state: "COMMITTED" | "INVALID" | "REJECTED" | "PENDING" | "NOT_SUBMITTED"; result?: unknown; transactionId?: string; validationCode?: number; blockNumber?: string; message?: string; recovered?: boolean };
type Prepared = { role: FabricRole; profileUserName?: string; certificateHash: string; request: string; transactionId: string; result: string };
type Intent = { digest: string; ownerPid: number; expected: string };

// Immutable, authenticated encrypted records. Link publishes a fully fsynced
// file atomically without replacing another process's reservation or outcome.
export class OperationStore {
  private readonly key: Buffer;
  private readonly binding: string;
  private readonly version: number;
  constructor(readonly directory: string, secret: string) {
    if (secret.length < 32) throw new Error("A stable AUTH_SECRET is required for workflow recovery");
    this.key = createHash("sha256").update("fabric-workflow-journal-v1\0" + secret).digest();
    const modern = path.basename(path.dirname(directory)) === "v2";
    this.version = modern ? 2 : 1;
    this.binding = modern ? `fabric-workflow-journal-v2/${path.basename(directory)}` : path.resolve(directory).split(path.sep).slice(-3).join("/");
  }
  async read<T>(name: string): Promise<T | null> {
    try {
      const encoded = JSON.parse(await fs.readFile(path.join(this.directory, name + ".json"), "utf8"));
      if ((encoded.version ?? 1) !== this.version) throw new Error("Workflow journal format mismatch; preserve the original directory layout");
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(encoded.iv, "base64"));
      decipher.setAAD(Buffer.from(this.binding + "/" + name));
      decipher.setAuthTag(Buffer.from(encoded.tag, "base64"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encoded.data, "base64")), decipher.final()]).toString()) as T;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async publish(name: string, value: unknown): Promise<boolean> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(this.binding + "/" + name));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    const temporary = path.join(this.directory, "." + randomUUID() + ".tmp");
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify({ version: this.version, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }));
      await handle.sync();
    } finally { await handle.close(); }
    try { await fs.link(temporary, path.join(this.directory, name + ".json")); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
    finally { await fs.unlink(temporary); }
  }
}

const operationContext = new AsyncLocalStorage<{ store: OperationStore; expected: string }>();
const active = new Map<string, { digest: string; promise: Promise<OperationOutcome> }>();

export function buildCommitRequest(identity: Identity, channel: string, transactionId: string) {
  const creator = new msp.SerializedIdentity(); creator.setMspid(identity.mspId); creator.setIdBytes(identity.credentials);
  const request = new protoGateway.CommitStatusRequest(); request.setChannelId(channel); request.setTransactionId(transactionId); request.setIdentity(creator.serializeBinary());
  const signed = new protoGateway.SignedCommitStatusRequest(); signed.setRequest(request.serializeBinary());
  return signed.serializeBinary(); // Gateway signs only behind the server boundary.
}

async function resolvePrepared(store: OperationStore, prepared: Prepared, gateway: Gateway, identity: Identity): Promise<OperationOutcome> {
  if (sha(identity.credentials) !== prepared.certificateHash) throw new Error("Workflow recovery identity changed; restore the original authorized identity");
  try {
    const status = await gateway.newCommit(Buffer.from(prepared.request, "base64")).getStatus();
    const outcome: OperationOutcome = { state: status.successful ? "COMMITTED" : "INVALID", transactionId: status.transactionId, validationCode: status.code, blockNumber: String(status.blockNumber),
      ...(status.successful ? { result: JSON.parse(Buffer.from(prepared.result, "base64").toString()) } : { message: `Transaction committed INVALID (${status.code}); no successful operation is implied. Review current state before a new attempt.` }) };
    await store.publish("outcome", outcome);
    return outcome;
  } catch (error) {
    // Status transport failure cannot establish absence, invalidity or success.
    return { state: "PENDING", transactionId: prepared.transactionId, message: `Commit outcome unresolved; recover this saved action without submitting another transaction. ${error instanceof Error ? error.message : "Status unavailable"}` };
  }
}

// Called by ledger submit helpers only when an authenticated HTTP workflow has
// opted into recovery. Preparation is durable BEFORE the first submit RPC.
export async function submitJournaled(contract: Contract, gateway: Gateway, identity: Identity, role: FabricRole, transactionName: string, args: string[], profileUserName?: string): Promise<Uint8Array> {
  const context = operationContext.getStore();
  if (!context || transactionName !== context.expected) return contract.submitTransaction(transactionName, ...args);
  const transaction = await contract.newProposal(transactionName, { arguments: args }).endorse();
  const prepared: Prepared = { role, profileUserName, certificateHash: sha(identity.credentials), request: Buffer.from(buildCommitRequest(identity, loadFabricConfig().channelName, transaction.getTransactionId())).toString("base64"), transactionId: transaction.getTransactionId(), result: Buffer.from(transaction.getResult()).toString("base64") };
  if (!await context.store.publish("prepared", prepared)) throw new Error("Workflow already has a prepared transaction; recover it");
  // Even if Submit loses its response, the already-persisted status request is
  // sufficient to recover a VALID/INVALID commit. Never re-endorse on uncertainty.
  try { await transaction.submit(); } catch { /* authoritative status below */ }
  const outcome = await resolvePrepared(context.store, prepared, gateway, identity);
  if (outcome.state !== "COMMITTED") throw new Error(outcome.message ?? "Workflow outcome unresolved");
  return Buffer.from(prepared.result, "base64");
}

export async function runRecoverableOperation(input: { requestId: string; command: { operation: string }; session: Session; secret: string; recoverOnly?: boolean; root?: string }, execute: () => Promise<unknown>): Promise<OperationOutcome> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(input.requestId)) throw new Error("Invalid workflow request identity");
  const expected = recoverableTransactions[input.command.operation];
  if (!expected) throw new Error("This workflow does not support saved-action recovery");
  const config = loadFabricConfig(), deployment = sha(canonical([config.channelName, config.chaincodeName]));
  const owner = sha(canonical([input.session.accountId, input.session.subjectId ?? "", input.session.role]));
  const base = input.root?.trim() || process.env.WORKFLOW_OPERATION_ROOT?.trim() || path.join(path.dirname(config.networkRoot), "data/workflow-operations");
  const legacyDirectory = path.join(base, deployment, owner, sha(input.requestId));
  const modernDirectory = path.join(base, "v2", sha(canonical([deployment, owner, sha(input.requestId)])));
  const exists = async (directory: string) => {
    try { await fs.stat(directory); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  const legacyExists = await exists(legacyDirectory);
  if (legacyExists && await exists(modernDirectory)) throw new Error("Both workflow journal layouts exist; preserve them and reconcile the original transaction");
  // Old records retain their authenticated layout; new records avoid long paths.
  const directory = legacyExists ? legacyDirectory : modernDirectory;
  const store = new OperationStore(directory, input.secret), digest = sha(canonical(input.command));
  const previous = await store.read<Intent>("intent");
  if (previous && previous.digest !== digest) throw new Error("Saved workflow identity is bound to a different command");
  const finished = await store.read<OperationOutcome>("outcome");
  if (finished) return { ...finished, recovered: true };
  const pending = active.get(directory);
  if (pending) { if (pending.digest !== digest) throw new Error("Saved workflow identity is bound to a different command"); return pending.promise; }
  const executeOrRecover = async (): Promise<OperationOutcome> => {
    const prepared = await store.read<Prepared>("prepared");
    if (prepared) return withFabricContract(prepared.role, (_contract, gateway, identity) => resolvePrepared(store, prepared, gateway, identity), prepared.profileUserName);
    const owns = !previous && !input.recoverOnly && await store.publish("intent", { digest, ownerPid: process.pid, expected } satisfies Intent);
    if (!owns) {
      if (!previous && input.recoverOnly) return { state: "NOT_SUBMITTED", message: "This deployment has no saved transaction for this action. No transaction was submitted by this recovery check." };
      const intent = previous ?? await store.read<Intent>("intent");
      if (!intent || intent.digest !== digest) throw new Error("Saved workflow differs from this command");
      try { process.kill(intent.ownerPid, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return { state: "NOT_SUBMITTED", message: "The original process ended before saving a transaction; no submit RPC was started. A new attempt is safe after reviewing the saved command." }; }
      return { state: "PENDING", message: "The original action is preparing. Recover it again; do not create another request." };
    }
    try {
      const result = await operationContext.run({ store, expected }, execute);
      const outcome = await store.read<OperationOutcome>("outcome");
      if (outcome) return outcome;
      // Some orchestrators reconcile existing authoritative state without a new
      // transaction, for example an already-pending Oracle request.
      const reconciled: OperationOutcome = { state: "COMMITTED", result, message: "Recovered existing authoritative workflow state" };
      await store.publish("outcome", reconciled); return reconciled;
    } catch (error) {
      const outcome = await store.read<OperationOutcome>("outcome"); if (outcome) return outcome;
      const prepared = await store.read<Prepared>("prepared");
      const failure: OperationOutcome = { state: prepared ? "PENDING" : "REJECTED", ...(prepared ? { transactionId: prepared.transactionId } : {}), message: error instanceof Error ? error.message : "Workflow failed" };
      if (!prepared) await store.publish("outcome", failure);
      return failure;
    }
  };
  const running = executeOrRecover(); active.set(directory, { digest, promise: running });
  try { return await running; } finally { if (active.get(directory)?.promise === running) active.delete(directory); }
}
