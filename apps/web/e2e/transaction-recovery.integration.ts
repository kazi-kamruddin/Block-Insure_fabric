import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { Contract, Gateway } from "@hyperledger/fabric-gateway";
vi.mock("server-only", () => ({})); // Next's build marker only; no ledger/transport mocks.
import { ledger } from "../lib/fabric/ledger";
import { loadFabricConfig } from "../lib/fabric/config";
import { withFabricContract } from "../lib/fabric/gateway";
import { runRecoverableOperation, submitJournaled } from "../lib/workflows/operation-journal";

const enabled = process.env.RUN_ISOLATED_FABRIC_RECOVERY === "true";
const sha = (x: string) => createHash("sha256").update(x).digest("hex");
const session = { accountId: "bank-officer", role: "bankOfficer" as const, issuedAt: 0, expiresAt: 9999999999 };
const secret = "isolated integration journal secret never used for production";
function settings() {
  if (process.env.FABRIC_CHANNEL_NAME !== "insurance-workflow-alignment-20261108") throw new Error("Live journal tests require the exact existing isolated alignment channel");
  const evidence = path.resolve(process.env.RECOVERY_EVIDENCE_ROOT ?? "../../.local-reference/alignment-2026-11-09-recovery");
  const relative = path.relative(path.dirname(loadFabricConfig().networkRoot), evidence).split(path.sep).join("/");
  if (!relative.startsWith(".local-reference/")) throw new Error("Use an ignored directory inside this Fabric checkout");
  return { evidence, root: path.join(evidence, "live-journals") };
}
async function account(id: string) {
  return ledger.openBankAccount({ id, bankId: "bank-demo", ownerId: "insurer", accountType: "INSURER", accountLabel: "Synthetic journal integration", maskedAccount: "**** 2468", accountTokenHash: sha(id), openingBalanceMinor: 1000 });
}
function credit(accountId: string, suffix: string, amount: number) {
  const command = { operation: "adjustBankAccountBalance", transferId: `recovery-credit-${suffix}`, accountId, direction: "CREDIT", amountMinor: amount, externalReferenceHash: sha(suffix) };
  return { command, args: [command.transferId, accountId, "CREDIT", String(amount), command.externalReferenceHash] };
}

it.skipIf(!enabled)("actual Gateway/store recovers VALID after an expired status RPC and reconnect without resubmission", async () => {
  const { evidence, root } = settings(), suffix = randomUUID(), accountId = `recovery-lost-${suffix}`;
  await account(accountId); const instruction = credit(accountId, suffix, 100), requestId = randomUUID(); let endorsements = 0;
  const pending = await withFabricContract("bankOfficer", (contract, gateway, identity) => {
    const expiredGateway = { newCommit: (bytes: Uint8Array) => {
      const commit = gateway.newCommit(bytes);
      return { getStatus: () => commit.getStatus({ deadline: new Date(Date.now() - 1) }) };
    } } as unknown as Gateway;
    return runRecoverableOperation({ requestId, command: instruction.command, session, secret, root }, async () => {
      endorsements++;
      const bytes = await submitJournaled(contract, expiredGateway, identity, "bankOfficer", "AdjustBankAccountBalance", instruction.args);
      return JSON.parse(Buffer.from(bytes).toString());
    });
  });
  expect(pending.state).toBe("PENDING"); expect(pending.transactionId).toBeTruthy();
  const neverSubmit = vi.fn();
  const recovered = await runRecoverableOperation({ requestId, command: instruction.command, session, secret, root, recoverOnly: true }, neverSubmit);
  expect(recovered).toMatchObject({ state: "COMMITTED", validationCode: 0, transactionId: pending.transactionId });
  expect(neverSubmit).not.toHaveBeenCalled(); expect(endorsements).toBe(1);
  expect((await ledger.readBankAccountReference(accountId)).balanceMinor).toBe(1100);
  const replay = await runRecoverableOperation({ requestId, command: instruction.command, session, secret, root }, neverSubmit);
  expect(replay).toMatchObject({ state: "COMMITTED", recovered: true, transactionId: pending.transactionId });
  expect((await ledger.readBankAccountReference(accountId)).balanceMinor).toBe(1100);
  await fs.writeFile(path.join(evidence, "live-journal-lost-status.json"), JSON.stringify({ accountId, pending, recovered, replay, endorsements }, null, 2));
});

it.skipIf(!enabled)("actual journaled transactions distinguish VALID and MVCC when both endorsements read the same version", async () => {
  const { evidence, root } = settings(), suffix = randomUUID(), accountId = `recovery-mvcc-${suffix}`;
  await account(accountId); let arrived = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const instructions = [100, 200].map(amount => credit(accountId, `${suffix}-${amount}`, amount));
  const outcomes = await Promise.all(instructions.map(instruction => withFabricContract("bankOfficer", (contract, gateway, identity) => {
    const heldContract = { newProposal: (name: string, options: { arguments: string[] }) => ({ endorse: async () => {
      // Real endorsements are held before real submit RPCs to reproduce MVCC.
      const endorsed = await contract.newProposal(name, options).endorse();
      if (++arrived === 2) release();
      await Promise.race([barrier, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("Real endorsement barrier did not receive both participants")), 30000); timer.unref(); })]);
      return endorsed;
    } }) } as unknown as Contract;
    return runRecoverableOperation({ requestId: randomUUID(), command: instruction.command, session, secret, root }, async () => JSON.parse(Buffer.from(await submitJournaled(heldContract, gateway, identity, "bankOfficer", "AdjustBankAccountBalance", instruction.args)).toString()));
  })));
  expect(outcomes.map(row => row.validationCode).sort()).toEqual([0, 11]);
  expect(outcomes.map(row => row.state).sort()).toEqual(["COMMITTED", "INVALID"]);
  const winner = outcomes.findIndex(row => row.state === "COMMITTED"), loser = 1 - winner;
  expect((await ledger.readBankAccountReference(accountId)).balanceMinor).toBe(1000 + instructions[winner].command.amountMinor);
  await expect(ledger.readBankTransfer(instructions[loser].command.transferId)).rejects.toThrow(/does not exist/);
  await fs.writeFile(path.join(evidence, "live-journal-mvcc.json"), JSON.stringify({ accountId, instructions, outcomes }, null, 2));
});
