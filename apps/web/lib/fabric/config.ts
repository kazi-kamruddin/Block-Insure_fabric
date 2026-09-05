import path from "node:path";
import { z } from "zod";

export const fabricRoles = [
  "insurerAdmin",
  "policyholder",
  "hospitalOfficer",
  "auditor",
  "bankOfficer",
] as const;

export type FabricRole = (typeof fabricRoles)[number];

const environmentSchema = z.object({
  FABRIC_NETWORK_ROOT: z.string().trim().min(1).default("../../network"),
  FABRIC_CHANNEL_NAME: z.string().trim().min(1).default("insurance-channel"),
  FABRIC_CHAINCODE_NAME: z.string().trim().min(1).default("insurance-contract"),
  FABRIC_EVALUATE_DEADLINE_SECONDS: z.coerce.number().positive().default(5),
  FABRIC_ENDORSE_DEADLINE_SECONDS: z.coerce.number().positive().default(15),
  FABRIC_SUBMIT_DEADLINE_SECONDS: z.coerce.number().positive().default(5),
  FABRIC_COMMIT_STATUS_DEADLINE_SECONDS: z.coerce.number().positive().default(60),
});

export type FabricConfig = ReturnType<typeof loadFabricConfig>;

type RoleDefinition = {
  mspId: string;
  organizationDomain: string;
  userName: string;
  peerPort: number;
};

const roleDefinitions: Record<FabricRole, RoleDefinition> = {
  insurerAdmin: {
    mspId: "InsurerMSP",
    organizationDomain: "insurer.blockinsure.test",
    userName: "insurerAdmin",
    peerPort: 7051,
  },
  policyholder: {
    mspId: "InsurerMSP",
    organizationDomain: "insurer.blockinsure.test",
    userName: "policyholder1",
    peerPort: 7051,
  },
  hospitalOfficer: {
    mspId: "HospitalMSP",
    organizationDomain: "hospital.blockinsure.test",
    userName: "hospitalOfficer",
    peerPort: 8051,
  },
  auditor: {
    mspId: "AuditorMSP",
    organizationDomain: "auditor.blockinsure.test",
    userName: "auditor",
    peerPort: 9051,
  },
  bankOfficer: {
    mspId: "BankMSP",
    organizationDomain: "bank.blockinsure.test",
    userName: "bankOfficer",
    peerPort: 12051,
  },
};

export function loadFabricConfig(environment: NodeJS.ProcessEnv = process.env) {
  const values = environmentSchema.parse(environment);
  const networkRoot = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    values.FABRIC_NETWORK_ROOT,
  );

  return {
    networkRoot,
    channelName: values.FABRIC_CHANNEL_NAME,
    chaincodeName: values.FABRIC_CHAINCODE_NAME,
    deadlines: {
      evaluate: values.FABRIC_EVALUATE_DEADLINE_SECONDS,
      endorse: values.FABRIC_ENDORSE_DEADLINE_SECONDS,
      submit: values.FABRIC_SUBMIT_DEADLINE_SECONDS,
      commitStatus: values.FABRIC_COMMIT_STATUS_DEADLINE_SECONDS,
    },
  };
}

export function resolveRoleProfile(role: FabricRole, config: FabricConfig) {
  const definition = roleDefinitions[role];
  const peerName = `peer0.${definition.organizationDomain}`;
  const organizationRoot = path.join(
    config.networkRoot,
    "organizations",
    "peerOrganizations",
    definition.organizationDomain,
  );

  return {
    role,
    mspId: definition.mspId,
    peerEndpoint: `localhost:${definition.peerPort}`,
    peerHostAlias: peerName,
    tlsCertificatePath: path.join(organizationRoot, "peers", peerName, "tls", "ca.crt"),
    userMspPath: path.join(
      organizationRoot,
      "users",
      `${definition.userName}@${definition.organizationDomain}`,
      "msp",
    ),
  };
}
