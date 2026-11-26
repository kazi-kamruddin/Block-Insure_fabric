import "server-only";
import { common, peer } from "@hyperledger/fabric-protos";
import { loadFabricConfig } from "./config";
import { withFabricContract } from "./gateway";

export function committedTimestamp(block: common.Block) {
  const flags = block.getMetadata()?.getMetadataList_asU8()[common.BlockMetadataIndex.TRANSACTIONS_FILTER];
  const data = block.getData()?.getDataList_asU8() ?? [];
  for (let index = data.length - 1; index >= 0; index--) {
    if (flags?.[index] !== peer.TxValidationCode.VALID) continue;
    const envelope = common.Envelope.deserializeBinary(data[index]);
    const payload = common.Payload.deserializeBinary(envelope.getPayload_asU8());
    const headerBytes = payload.getHeader()?.getChannelHeader_asU8();
    if (!headerBytes) continue;
    const header = common.ChannelHeader.deserializeBinary(headerBytes);
    const timestamp = header.getTimestamp();
    if (header.getType() !== common.HeaderType.ENDORSER_TRANSACTION || !timestamp) continue;
    const millis = timestamp.getSeconds() * 1000 + Math.floor(timestamp.getNanos() / 1e6);
    if (Number.isSafeInteger(millis) && millis > 0) return millis;
  }
  return null;
}

export async function latestLedgerTimestamp() {
  const { channelName } = loadFabricConfig();
  return withFabricContract("insurerAdmin", async (_contract, gateway) => {
    const qscc = gateway.getNetwork(channelName).getContract("qscc");
    const info = common.BlockchainInfo.deserializeBinary(await qscc.evaluateTransaction("GetChainInfo", channelName));
    const height = info.getHeight();
    if (!Number.isSafeInteger(height)) return null;
    for (let block = height - 1; block >= Math.max(1, height - 16); block--) {
      const bytes = await qscc.evaluateTransaction("GetBlockByNumber", channelName, String(block));
      const timestamp = committedTimestamp(common.Block.deserializeBinary(bytes));
      if (timestamp !== null) return timestamp;
    }
    return null;
  });
}
