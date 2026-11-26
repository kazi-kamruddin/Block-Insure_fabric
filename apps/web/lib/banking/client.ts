import { sha256Hex } from "@/lib/evidence/browser-crypto";
import type { WorkflowCommand } from "@/lib/workflows/commands";

export async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
  return body;
}

export async function postWorkflow<T = unknown>(command: WorkflowCommand) {
  const body = await readJson<{ result: T }>(await fetch("/api/workflows", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command),
  }));
  return body.result;
}

export function textHash(value: string) {
  return sha256Hex(new TextEncoder().encode(value));
}

export function randomToken(prefix: string) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function shortId(prefix: string) {
  return randomToken(prefix).slice(0, prefix.length + 13);
}
