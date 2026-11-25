import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const devLiteProfile = Object.freeze(JSON.parse(
  readFileSync(new URL("./profiles/dev-lite-190.json", import.meta.url), "utf8"),
));

const repoRoot = devLiteProfile.repoRoot ?? fileURLToPath(new URL("..", import.meta.url));
const peerIdentity = {
  insurer: { mspId: "InsurerMSP", port: 31051, user: "insurerAdmin" },
  hospital: { mspId: "HospitalMSP", port: 31151, user: "hospitalOfficer" },
  auditor: { mspId: "AuditorMSP", port: 31251, user: "auditor1" },
  bank: { mspId: "BankMSP", port: 31351, user: "bankOfficer" },
  oracle: { mspId: "OracleMSP", port: 31451, user: "oracle1" },
};

export const devLiteOrganizations = Object.freeze(Object.keys(peerIdentity));

export async function withDevLitePeer(org, action) {
  if (!Object.hasOwn(peerIdentity, org)) throw new Error("Unknown dev-lite organization");
  const { mspId, port, user } = peerIdentity[org];
  const { connectOracleGateway } = await import("../services/oracle-worker/src/gateway.mjs");
  const domain = `${org}.blockinsure.test`;
  const organizationRoot = path.join(repoRoot, "data", "dev-lite", "organizations", "peerOrganizations", domain);
  const peerHostAlias = `peer0.${domain}`;
  const connection = await connectOracleGateway({
    fabric: {
      mspId,
      peerHostAlias,
      peerEndpoint: `localhost:${port}`,
      channelName: devLiteProfile.channel,
      chaincodeName: devLiteProfile.chaincodeName,
      tlsCertificatePath: path.join(organizationRoot, "peers", peerHostAlias, "tls", "ca.crt"),
      userMspPath: path.join(organizationRoot, "users", `${user}@${domain}`, "msp"),
    },
  });
  try {
    return await action({ network: connection.network, contract: connection.contract });
  } finally {
    connection.close();
  }
}
