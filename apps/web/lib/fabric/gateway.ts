import "server-only";

import { createPrivateKey } from "node:crypto";
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

function deadlineAfter(seconds: number) {
  return () => new Date(Date.now() + seconds * 1_000);
}

export async function withFabricContract<T>(
  role: FabricRole,
  action: (contract: Contract, gateway: Gateway) => Promise<T>,
  profileUserName?: string,
): Promise<T> {
  const config = loadFabricConfig();
  const profile = role === "auditor" && profileUserName
    ? resolveAuditorProfile(profileUserName, config)
    : role === "hospitalOfficer" && profileUserName
      ? resolveHospitalProfile(profileUserName, config)
      : resolveRoleProfile(role, config);
  const [{ certificate, privateKey }, tlsRootCertificate] = await Promise.all([
    loadRoleCredentials(profile.userMspPath),
    fs.readFile(profile.tlsCertificatePath),
  ]);

  const client = new grpc.Client(
    profile.peerEndpoint,
    grpc.credentials.createSsl(tlsRootCertificate),
    {
      "grpc.ssl_target_name_override": profile.peerHostAlias,
      "grpc.default_authority": profile.peerHostAlias,
    },
  );
  const identity: Identity = { mspId: profile.mspId, credentials: certificate };
  const signer = signers.newPrivateKeySigner(createPrivateKey(privateKey));
  const gateway = connect({
    client,
    identity,
    signer,
    hash: hash.sha256,
    evaluateOptions: () => ({ deadline: deadlineAfter(config.deadlines.evaluate)() }),
    endorseOptions: () => ({ deadline: deadlineAfter(config.deadlines.endorse)() }),
    submitOptions: () => ({ deadline: deadlineAfter(config.deadlines.submit)() }),
    commitStatusOptions: () => ({ deadline: deadlineAfter(config.deadlines.commitStatus)() }),
    chaincodeEventsOptions: () => ({ deadline: deadlineAfter(config.deadlines.eventSync)() }),
  });

  try {
    const network = gateway.getNetwork(config.channelName);
    const contract = network.getContract(config.chaincodeName);
    return await action(contract, gateway);
  } finally {
    gateway.close();
    client.close();
  }
}
