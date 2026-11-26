import { fileURLToPath } from "node:url";
import { devLiteProfile, withDevLitePeer } from "./dev-lite-gateway.mjs";
import { selectLedgerInstance } from "./ledger-instance-state.mjs";

const profileRoot = fileURLToPath(new URL("../data/dev-lite", import.meta.url));
try {
  const selected = await withDevLitePeer("insurer", async ({ network, contract }) => {
    const qscc = network.getContract("qscc");
    const block = await qscc.evaluateTransaction("GetBlockByNumber", devLiteProfile.channel, "1");
    let marker = "";
    try {
      const response = Buffer.from(await contract.evaluateTransaction("ReadLedgerInstance")).toString("utf8");
      marker = response.startsWith('"') ? JSON.parse(response) : response;
    } catch (error) {
      const reasons = [error?.message, ...(Array.isArray(error?.details) ? error.details.map(detail => detail?.message) : [])];
      if (!reasons.some(reason => /readledgerinstance/i.test(String(reason)) &&
          /not found|unknown function|does not exist|undefined/i.test(String(reason)))) throw error;
    }
    return selectLedgerInstance(profileRoot, devLiteProfile.channel, block, marker);
  });
  console.log(JSON.stringify(selected));
} catch {
  console.error("Could not verify dev-lite block 1 or select its application state.");
  process.exitCode = 1;
}
