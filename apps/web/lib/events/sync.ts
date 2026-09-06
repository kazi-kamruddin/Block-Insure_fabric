import "server-only";

import { status } from "@grpc/grpc-js";
import { loadFabricConfig } from "@/lib/fabric/config";
import { withFabricContract } from "@/lib/fabric/gateway";
import { appendProjectedEvent, readEventProjection } from "./store";

const decoder = new TextDecoder();

export async function syncFabricEvents(maxEvents = 5_000) {
  const before = await readEventProjection();
  const config = loadFabricConfig();
  let processed = 0;
  await withFabricContract("insurerAdmin", async (_contract, gateway) => {
    const checkpoint = {
      getBlockNumber: () => before.checkpoint ? BigInt(before.checkpoint.blockNumber) : undefined,
      getTransactionId: () => before.checkpoint?.transactionId,
    };
    const events = await gateway.getNetwork(config.channelName).getChaincodeEvents(config.chaincodeName, {
      checkpoint,
      startBlock: BigInt(process.env.FABRIC_EVENT_START_BLOCK ?? "0"),
    });
    try {
      for await (const event of events) {
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(decoder.decode(event.payload)) as Record<string, unknown>; } catch { payload = { undecodablePayload: true }; }
        await appendProjectedEvent({
          id: `${event.blockNumber}:${event.transactionId}:${event.eventName}`,
          blockNumber: event.blockNumber.toString(),
          transactionId: event.transactionId,
          eventName: event.eventName,
          payload,
        });
        processed += 1;
        if (processed >= maxEvents) break;
      }
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== status.DEADLINE_EXCEEDED && code !== status.CANCELLED) throw error;
    } finally {
      events.close();
    }
  });
  const projection = await readEventProjection();
  return {
    processed,
    limitReached: processed >= maxEvents,
    checkpoint: projection.checkpoint,
    totalEvents: projection.events.length,
    countsByName: projection.countsByName,
  };
}
