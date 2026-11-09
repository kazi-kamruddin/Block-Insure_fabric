import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { deliverBankCommunication } from "./email-gateway";

it("keeps a stable gateway key across accepted delivery followed by a lost response", async () => {
  const accepted = new Map<string, string>(), keys: string[] = [];
  let calls = 0;
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    calls++;
    const key = String(request.headers["idempotency-key"] ?? `unkeyed-${calls}`);
    keys.push(key);
    if (!accepted.has(key)) accepted.set(key, `message-${accepted.size + 1}`);
    if (calls === 1) { request.socket.destroy(); return; }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ messageId: accepted.get(key) }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("EMAIL_GATEWAY_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  vi.stubEnv("EMAIL_GATEWAY_TOKEN", "");
  try {
    const input = { recipient: "synthetic-owner@example.invalid", template: "bank-transaction-status", variables: { transferId: "transfer-test" }, idempotencyKey: "deployment-event-recipient-key" };
    await expect(deliverBankCommunication(input)).rejects.toThrow();
    const retried = await deliverBankCommunication(input);
    expect(keys).toEqual([input.idempotencyKey, input.idempotencyKey]);
    expect(accepted.size).toBe(1);
    expect(retried.messageId).toBe("message-1");
  } finally {
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
