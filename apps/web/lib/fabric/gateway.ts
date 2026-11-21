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

// Endorsement failures report "see attached details"; the chaincode's reason is
// only in error.details. Append it to the message so callers and the UI can
// show why the ledger refused. The error object itself is kept for instanceof checks.
export function withPeerReasons(error: unknown) {
  if (!(error instanceof Error)) return error;
  const details = (error as Error & { details?: unknown }).details;
  if (!Array.isArray(details)) return error;
  const reasons = [...new Set(details
    .map((detail) => typeof detail?.message === "string" ? detail.message.replace(/^chaincode response \d+,\s*/, "").trim() : "")
    .filter((reason) => reason && !error.message.includes(reason)))];
  if (reasons.length) error.message = `${error.message}: ${reasons.join("; ")}`;
  return error;
}

export async function withFabricContract<T>(
  role: FabricRole,
  action: (contract: Contract, gateway: Gateway, identity: Identity) => Promise<T>,
  profileUserName?: string,
): Promise<T> {
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
    return await action(contract, gateway, identity);
  } catch (error) {
    throw withPeerReasons(error);
  } finally {
    gateway.close();
    client.close();
  }
}
