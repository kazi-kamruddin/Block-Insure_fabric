import { workflowCommandSchema, type WorkflowCommand } from "./commands";

export type SavedWorkflowAction = { requestId: string; command: WorkflowCommand; state?: string };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export function savedActionKey(deployment: string, accountId: string) {
  return "fabric-workflow-action-v1:" + JSON.stringify([deployment, accountId]);
}
export function readSavedAction(storage: Storage, key: string): SavedWorkflowAction | null {
  return parseSavedAction(storage.getItem(key));
}
export function parseSavedAction(text: string | null): SavedWorkflowAction | null {
  if (!text) return null;
  const action = JSON.parse(text) as SavedWorkflowAction;
  const parsed = workflowCommandSchema.safeParse(action?.command);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(action?.requestId ?? "") || !parsed.success ||
      (action.state !== undefined && !["PENDING", "INVALID", "REJECTED", "NOT_SUBMITTED"].includes(action.state))) throw new Error("Saved action is invalid; preserve it for recovery");
  return { ...action, command: parsed.data };
}
export function saveAction(storage: Storage, key: string, action: SavedWorkflowAction) {
  parseSavedAction(JSON.stringify(action));
  storage.setItem(key, JSON.stringify(action));
  if (storage.getItem(key) !== JSON.stringify(action)) throw new Error("Cannot durably save this action; nothing was sent");
}
