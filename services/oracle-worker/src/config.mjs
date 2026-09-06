import path from "node:path";
import { fileURLToPath } from "node:url";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(serviceRoot, "../..");

function required(environment, name) {
  const value = String(environment[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredHash(environment, name) {
  const value = required(environment, name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a 64-character hexadecimal hash`);
  return value;
}

function boundedInteger(environment, name, fallback, minimum, maximum) {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function resolveFromService(value) {
  return path.resolve(serviceRoot, value);
}

export function loadOracleConfig(environment = process.env) {
  const oracleId = required(environment, "ORACLE_ID");
  if (!/^oracle[12]$/.test(oracleId)) throw new Error("ORACLE_ID must be oracle1 or oracle2");
  const networkRoot = environment.FABRIC_NETWORK_ROOT
    ? resolveFromService(environment.FABRIC_NETWORK_ROOT)
    : path.join(projectRoot, "network");
  const domain = "oracle.blockinsure.test";
  const organizationRoot = path.join(networkRoot, "organizations", "peerOrganizations", domain);
  return {
    oracleId,
    label: String(environment.ORACLE_LABEL ?? oracleId),
    registryPath: resolveFromService(required(environment, "ORACLE_REGISTRY_PATH")),
    stateRoot: resolveFromService(environment.ORACLE_STATE_ROOT ?? "../../data/oracle"),
    healthPort: boundedInteger(environment, "ORACLE_HEALTH_PORT", oracleId === "oracle1" ? 3301 : 3302, 1024, 65535),
    pollIntervalMs: boundedInteger(environment, "ORACLE_POLL_INTERVAL_MS", 1_000, 100, 60_000),
    retry: {
      attempts: boundedInteger(environment, "ORACLE_MAX_RETRY_ATTEMPTS", 4, 1, 10),
      baseDelayMs: boundedInteger(environment, "ORACLE_RETRY_BASE_MS", 500, 0, 60_000),
      maximumDelayMs: boundedInteger(environment, "ORACLE_RETRY_MAX_MS", 5_000, 0, 300_000),
    },
    modelVersion: required(environment, "ORACLE_MODEL_VERSION"),
    modelHash: requiredHash(environment, "ORACLE_MODEL_HASH"),
    fabric: {
      networkRoot,
      channelName: environment.FABRIC_CHANNEL_NAME ?? "insurance-channel",
      chaincodeName: environment.FABRIC_CHAINCODE_NAME ?? "insurance-contract",
      peerEndpoint: environment.FABRIC_ORACLE_PEER_ENDPOINT ?? "localhost:13051",
      peerHostAlias: environment.FABRIC_ORACLE_PEER_HOST_ALIAS ?? "peer0.oracle.blockinsure.test",
      mspId: "OracleMSP",
      tlsCertificatePath: path.join(organizationRoot, "peers", `peer0.${domain}`, "tls", "ca.crt"),
      userMspPath: path.join(organizationRoot, "users", `${oracleId}@${domain}`, "msp"),
      startBlock: boundedInteger(environment, "FABRIC_EVENT_START_BLOCK", 0, 0, Number.MAX_SAFE_INTEGER),
    },
  };
}
