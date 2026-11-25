import { generateKeyPairSync } from "node:crypto";
import { connectivityState } from "@grpc/grpc-js";
import { expect, it, vi } from "vitest";
import { withFabricContract } from "./gateway";

const { clients, gateways, loadRoleCredentials, readFile } = vi.hoisted(() => ({
  clients: [] as { state: number; close: () => void }[],
  gateways: [] as { client: unknown; identity: { mspId: string }; close: () => void }[],
  loadRoleCredentials: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-session", () => ({ currentSession: vi.fn() }));
vi.mock("@/lib/customers/wallet", () => ({ loadCustomerCredentials: vi.fn() }));
vi.mock("./credentials", () => ({ loadRoleCredentials }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, promises: { ...fs.promises, readFile } };
});
vi.mock("@grpc/grpc-js", async (importOriginal) => {
  const grpc = await importOriginal<typeof import("@grpc/grpc-js")>();
  return {
    ...grpc,
    Client: class {
      state = grpc.connectivityState.IDLE as number;
      constructor() { clients.push(this); }
      getChannel() { return { getConnectivityState: () => this.state }; }
      close() { this.state = grpc.connectivityState.SHUTDOWN; }
    },
  };
});
vi.mock("@hyperledger/fabric-gateway", async (importOriginal) => {
  const fabric = await importOriginal<typeof import("@hyperledger/fabric-gateway")>();
  return {
    ...fabric,
    connect({ client, identity }: Parameters<typeof fabric.connect>[0]) {
      const gateway = { client, identity, close: vi.fn(), getNetwork: () => ({ getContract: () => ({}) }) };
      gateways.push(gateway);
      return gateway;
    },
  };
});

it("reuses a healthy peer connection while closing a distinct Gateway for every request", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { format: "pem", type: "pkcs8" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  loadRoleCredentials.mockResolvedValue({ certificate: Buffer.from("test-certificate"), privateKey });
  readFile.mockResolvedValue(Buffer.from("root-ca"));

  await withFabricContract("insurerAdmin", async () => {});
  await withFabricContract("insurerAdmin", async () => {});

  expect(gateways[0]).not.toBe(gateways[1]);
  expect(gateways[0]?.client).toBe(gateways[1]?.client);
  expect(gateways[1]?.identity.mspId).toBe("InsurerMSP");
  expect(gateways[0]?.close).toHaveBeenCalledOnce();
  expect(gateways[1]?.close).toHaveBeenCalledOnce();
  expect(clients[0]?.state).not.toBe(connectivityState.SHUTDOWN);
});

it("replaces a failed channel without closing a connection still serving an earlier request", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { format: "pem", type: "pkcs8" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  loadRoleCredentials.mockResolvedValue({ certificate: Buffer.from("test-certificate"), privateKey });
  readFile.mockResolvedValue(Buffer.from("another-root-ca"));
  const ready = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const pending = withFabricContract("hospitalOfficer", async () => {
    ready.resolve();
    await finish.promise;
  });
  await ready.promise;
  const firstClient = clients.at(-1)!;
  firstClient.state = connectivityState.TRANSIENT_FAILURE;

  try {
    await withFabricContract("hospitalOfficer", async () => {});
    expect(gateways.at(-1)?.client).not.toBe(firstClient);
    expect(firstClient.state).toBe(connectivityState.TRANSIENT_FAILURE);
  } finally {
    finish.resolve();
    await pending;
  }
  expect(firstClient.state).toBe(connectivityState.SHUTDOWN);
  const replacement = clients.at(-1);
  await withFabricContract("hospitalOfficer", async () => {});
  expect(gateways.at(-1)?.client).toBe(replacement);
});
