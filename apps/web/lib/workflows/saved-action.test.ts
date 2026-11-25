import { expect, it } from "vitest";
import type { WorkflowCommand } from "./commands";
import { pendingPremiumKey, readSavedAction, saveAction, savedActionKey } from "./saved-action";

it("retains original request identity and command across browser reload, account and deployment boundaries", () => {
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); }, removeItem: (key: string) => { records.delete(key); } };
  const key = savedActionKey("channel/contract", "owner"), action = { requestId: "synthetic-request-0000000001", command: { operation: "submitClaim", id: "claim-one", policyId: "policy-one", hospitalId: "hospital-demo", hospitalInvoiceId: "invoice-one", amountMinor: 1000, incidentDate: "2026-11-09", descriptionHash: "a".repeat(64) } as WorkflowCommand };
  saveAction(storage, key, action); expect(readSavedAction(storage, key)).toEqual(action);
  expect(readSavedAction(storage, savedActionKey("other/contract", "owner"))).toBeNull();
  expect(readSavedAction(storage, savedActionKey("channel/contract", "other"))).toBeNull();
});
it("fails before sending when browser persistence is blocked or changes the saved identity", () => {
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  expect(() => saveAction(storage, "key", { requestId: "synthetic-request-0000000001", command: { operation: "submitClaim", id: "claim-one", policyId: "policy-one", hospitalId: "hospital-demo", hospitalInvoiceId: "invoice-one", amountMinor: 1000, incidentDate: "2026-11-09", descriptionHash: "a".repeat(64) } as WorkflowCommand })).toThrow("nothing was sent");
  expect(() => readSavedAction({ ...storage, getItem: () => '{"requestId":"short","command":{}}' }, "key")).toThrow("invalid");
});
it("isolates stored actions and premium intents across two instances of the same channel", () => {
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); }, removeItem: (key: string) => { records.delete(key); } };
  const deployment = "same-channel/contract", account = "owner", original = "a".repeat(64), rebuilt = "b".repeat(64);
  const oldKey = savedActionKey(deployment, account, original);
  const action = { requestId: "synthetic-request-0000000001", command: { operation: "submitClaim", id: "claim-one", policyId: "policy-one", hospitalId: "hospital-demo", hospitalInvoiceId: "invoice-one", amountMinor: 1000, incidentDate: "2026-11-09", descriptionHash: "a".repeat(64) } as WorkflowCommand };
  saveAction(storage, oldKey, action);
  expect(readSavedAction(storage, savedActionKey(deployment, account, rebuilt))).toBeNull();
  expect(readSavedAction(storage, oldKey)).toEqual(action);
  expect(pendingPremiumKey(deployment, account, original)).not.toBe(pendingPremiumKey(deployment, account, rebuilt));
});
it("rejects an invalid developer-console command before writing a saved action", () => {
  let written = false;
  const storage = { getItem: () => null, setItem: () => { written = true; }, removeItem: () => {} };
  expect(() => saveAction(storage, "key", { requestId: "synthetic-request-0000000001", command: { operation: "submitClaim" } as WorkflowCommand })).toThrow();
  expect(written).toBe(false);
});
