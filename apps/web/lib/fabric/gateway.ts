import "server-only";

import { createHash, createPrivateKey } from "node:crypto";
import { promises as fs } from "node:fs";
import * as grpc from "@grpc/grpc-js";
import {
  connect,
  hash,
  signers,
  type Contract,
  type Gateway,
  type Identity,
} from "@hyperledger/fabric-gateway";
import { loadFabricConfig, resolveAuditorProfile, resolveHospitalProfile, resolveRoleProfile, type FabricRole } from "./config";
import { loadRoleCredentials } from "./credentials";
import { currentSession } from "@/lib/auth/current-session";
import { memberForAccount } from "@/lib/customers/member-id";
import { onboardingEnabled } from "@/lib/customers/settings";
import { loadCustomerCredentials } from "@/lib/customers/wallet";
import { withPeerReasons } from "./peer-reasons";

export { withPeerReasons } from "./peer-reasons";

async function policyholderIdentity() {
  const session = await currentSession();
  if (session?.role !== "policyholder") throw new Error("An active policyholder session is required");
  if (session.accountId === "policyholder-1" && session.subjectId === "policyholder1") return;
  const memberId = memberForAccount(session.accountId);
  if (!memberId || memberId !== session.subjectId) throw new Error("An active policyholder session is required");
  return { ...session, subjectId: memberId };
}

function deadlineAfter(seconds: number) {
  return () => new Date(Date.now() + seconds * 1_000);
}

type PeerClient = { client: grpc.Client; activeRequests: number; retired: boolean };
const peerClients = new Map<string, PeerClient>();
const openClients = new Set<grpc.Client>();

function closePeerClient(client: grpc.Client) {
  if (openClients.delete(client)) client.close();
}

process.once("exit", () => {
  for (const client of openClients) closePeerClient(client);
});

function acquirePeerClient(endpoint: string, hostAlias: string, tlsRootCertificate: Buffer) {
  const fingerprint = createHash("sha256").update(tlsRootCertificate).digest("hex");
  const key = JSON.stringify([endpoint, fingerprint, hostAlias]);
  let entry = peerClients.get(key);
  if (entry) {
    const state = entry.client.getChannel().getConnectivityState(false);
    if (state === grpc.connectivityState.TRANSIENT_FAILURE || state === grpc.connectivityState.SHUTDOWN) {
      // Existing Gateways may still have an operation on this channel.
      entry.retired = true;
      if (entry.activeRequests === 0) closePeerClient(entry.client);
      peerClients.delete(key);
      entry = undefined;
    }
  }
  if (!entry) {
    const client = new grpc.Client(endpoint, grpc.credentials.createSsl(tlsRootCertificate), {
      "grpc.ssl_target_name_override": hostAlias,
      "grpc.default_authority": hostAlias,
    });
    entry = { client, activeRequests: 0, retired: false };
    peerClients.set(key, entry);
    openClients.add(client);
  }
  const leased = entry;
  leased.activeRequests += 1;
  return {
    client: leased.client,
    release() {
      leased.activeRequests -= 1;
      if (leased.retired && leased.activeRequests === 0) closePeerClient(leased.client);
    },
  };
}

export async function withFabricContract<T>(
  role: FabricRole,
  action: (contract: Contract, gateway: Gateway, identity: Identity) => Promise<T>,
  profileUserName?: string,
): Promise<T> {
  const customer = role === "policyholder" && onboardingEnabled() ? await policyholderIdentity() : undefined;
  const config = loadFabricConfig();
  if (role === "bankOfficer" && config.externalBankCustody) {
    throw new Error("Dev-lite Bank credentials are managed by the external operator.");
  }
  const profile = role === "auditor" && profileUserName
    ? resolveAuditorProfile(profileUserName, config)
    : role === "hospitalOfficer" && profileUserName
      ? resolveHospitalProfile(profileUserName, config)
      : resolveRoleProfile(role, config);
  const [{ certificate, privateKey }, tlsRootCertificate] = await Promise.all([
    customer ? loadCustomerCredentials(customer.subjectId) : loadRoleCredentials(profile.userMspPath),
    fs.readFile(profile.tlsCertificatePath),
  ]);

  const identity: Identity = { mspId: profile.mspId, credentials: certificate };
  const signer = signers.newPrivateKeySigner(createPrivateKey(privateKey));
  const { client, release } = acquirePeerClient(profile.peerEndpoint, profile.peerHostAlias, tlsRootCertificate);
  let gateway: Gateway | undefined;

  try {
    gateway = connect({
      client,
      identity,
      signer: customer ? async digest => {
        const active = await policyholderIdentity();
        if (active?.accountId !== customer.accountId || active.sessionId !== customer.sessionId) {
          throw new Error("An active policyholder session is required");
        }
        return signer(digest);
      } : signer,
      hash: hash.sha256,
      evaluateOptions: () => ({ deadline: deadlineAfter(config.deadlines.evaluate)() }),
      endorseOptions: () => ({ deadline: deadlineAfter(config.deadlines.endorse)() }),
      submitOptions: () => ({ deadline: deadlineAfter(config.deadlines.submit)() }),
      commitStatusOptions: () => ({ deadline: deadlineAfter(config.deadlines.commitStatus)() }),
      chaincodeEventsOptions: () => ({ deadline: deadlineAfter(config.deadlines.eventSync)() }),
    });
    const network = gateway.getNetwork(config.channelName);
    const contract = network.getContract(config.chaincodeName);
    return await action(contract, gateway, identity);
  } catch (error) {
    throw withPeerReasons(error);
  } finally {
    try { gateway?.close(); } finally { release(); }
  }
}
