import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { syncFabricEvents } from "./sync";
import { readEventProjection } from "./store";

const doubles = vi.hoisted(() => ({ getEvents: vi.fn(), close: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/fabric/gateway", () => ({
  withFabricContract: (_role: string, callback: (contract: unknown, gateway: unknown) => unknown) =>
    callback({}, { getNetwork: () => ({ getChaincodeEvents: doubles.getEvents }) }),
}));
vi.mock("./deliver-communications", () => ({
  deliverPendingBankCommunications: async () => ({ delivered: 0, failed: 0 }),
}));

let root: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

it("uses the persisted position to finish catch-up past 5,000 events", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fabric-event-catchup-"));
  vi.stubEnv("EVENT_PROJECTION_ROOT", root);
  const observed: Array<[bigint | undefined, string | undefined]> = [];
  doubles.getEvents.mockImplementation((_chaincode, { checkpoint }) => {
    const block = checkpoint.getBlockNumber();
    observed.push([block, checkpoint.getTransactionId()]);
    return {
      close: doubles.close,
      async *[Symbol.asyncIterator]() {
        for (let index = Number(block ?? 0) + 1; index <= 5003; index++) {
          yield { eventName: "MedicalAuditSelectionResolved", transactionId: `tx-${index}`,
            blockNumber: BigInt(index), payload: Buffer.from('{"claimId":"claim-1"}') };
        }
      },
    };
  });
  const first = await syncFabricEvents();
  expect(first).toMatchObject({ processed: 5000, limitReached: true, totalEvents: 5000 });
  const loaded = await readEventProjection();
  expect(loaded.checkpoint).toEqual({ blockNumber: "5000", transactionId: "tx-5000" });
  const second = await syncFabricEvents();
  expect(second).toMatchObject({ processed: 3, limitReached: false, totalEvents: 5003,
    countsByName: { MedicalAuditSelectionResolved: 5003 } });
  expect(observed).toEqual([[undefined, undefined], [5000n, "tx-5000"]]);
  expect((await readEventProjection()).events).toHaveLength(5000);
  expect(doubles.close).toHaveBeenCalledTimes(2);
});
