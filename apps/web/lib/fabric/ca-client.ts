import "server-only";

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request } from "node:https";
import path from "node:path";
import { signers } from "@hyperledger/fabric-gateway";
import { loadFabricConfig } from "./config";
import { findSingleCredential } from "./credentials";
import { medicalDevLiteChannel } from "./medical-channel";

const caName = "ca-insurer";
const duplicateIdentityCode = 74; // Fabric CA 1.5.17 ErrDupIdentityReg.
const memberIdPattern = /^BI-[0-9A-HJKMNP-TV-Z]{8}$/;
const enrollmentSecretPattern = /^[A-Za-z0-9_-]{43}$/;
const sha256WithECDSA = Buffer.from("2a8648ce3d040302", "hex");
const commonNameOid = Buffer.from("550403", "hex");

function checkMemberId(memberId: string) {
  if (!memberIdPattern.test(memberId)) throw new Error("Invalid customer member ID");
}

function checkEnrollmentSecret(secret: string) {
  if (!enrollmentSecretPattern.test(secret)) throw new Error("Invalid internal enrollment credential");
}

// Only the fixed PKCS#10 shape below is encoded here. Its longest DER field
// fits in one length octet after the long-form marker.
function der(tag: number, ...parts: Buffer[]) {
  const value = Buffer.concat(parts);
  if (value.length > 255) throw new Error("Customer CSR exceeds the supported size");
  const length = value.length < 128 ? Buffer.of(value.length) : Buffer.of(0x81, value.length);
  return Buffer.concat([Buffer.of(tag), length, value]);
}

const sequence = (...parts: Buffer[]) => der(0x30, ...parts);

export function createCustomerKey(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

export function createCustomerCsr(memberId: string, keyPem: string): string {
  checkMemberId(memberId);
  const key = createPrivateKey(keyPem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("Customer key must be P-256");
  }
  const spki = createPublicKey(key).export({ format: "der", type: "spki" });
  const commonName = sequence(der(0x06, commonNameOid), der(0x0c, Buffer.from(memberId, "utf8")));
  const subject = sequence(der(0x31, commonName));
  // RFC 2986 version, subject, subjectPublicKeyInfo and empty attributes.
  const info = sequence(der(0x02, Buffer.of(0)), subject, spki, der(0xa0));
  const signature = sign("sha256", info, { key, dsaEncoding: "der" });
  const csr = sequence(info, sequence(der(0x06, sha256WithECDSA)), der(0x03, Buffer.of(0), signature));
  const pemBody = csr.toString("base64").replace(/.{64}(?=.)/g, "$&\n");
  return `-----BEGIN CERTIFICATE REQUEST-----\n${pemBody}\n-----END CERTIFICATE REQUEST-----\n`;
}

// Fabric CA 1.5.17 util.GenECDSAToken signs method.URI.body.certificate,
// where the last three fields use standard padded Base64.
export async function createCaAuthorization(
  requestUri: string,
  body: Buffer,
  certificate: Buffer,
  signer: (digest: Uint8Array) => Promise<Uint8Array>,
) {
  const encodedCertificate = certificate.toString("base64");
  const encodedUri = Buffer.from(requestUri, "utf8").toString("base64");
  const payload = `POST.${encodedUri}.${body.toString("base64")}.${encodedCertificate}`;
  const digest = createHash("sha256").update(payload).digest();
  const signature = Buffer.from(await signer(digest)).toString("base64");
  return `${encodedCertificate}.${signature}`;
}

export class FabricCaRequestError extends Error {
  constructor(action: "registration" | "enrollment", readonly status: number | null) {
    super(status === null ? `Insurer CA ${action} was unavailable.` : `Insurer CA ${action} failed (HTTP ${status}).`);
    this.name = "FabricCaRequestError";
  }
}

function caPaths() {
  const config = loadFabricConfig();
  const root = config.networkRoot;
  if (process.env.DEV_LITE_ONBOARDING !== "true" || config.channelName !== medicalDevLiteChannel ||
      path.basename(root) !== "dev-lite" || path.basename(path.dirname(root)) !== "data") {
    throw new Error("Insurer CA onboarding requires LevelDB dev-lite.");
  }
  const organizations = path.join(root, "organizations");
  return {
    registrar: path.join(organizations, "peerOrganizations", "insurer.blockinsure.test", "msp"),
    tlsRoot: path.join(organizations, "fabric-ca", "insurer", "ca-cert.pem"),
  };
}

type CaResult = { status: number; body: { success?: boolean; result?: { Cert?: string }; errors?: Array<{ code?: number }> } };

function sendCaRequest(action: "registration" | "enrollment", requestUri: string, body: Buffer, authorization: string, ca: Buffer) {
  return new Promise<CaResult>((resolve, reject) => {
    const fail = () => reject(new FabricCaRequestError(action, null));
    const req = request({
      hostname: "127.0.0.1",
      port: 31054,
      servername: "localhost",
      path: requestUri,
      method: "POST",
      ca,
      rejectUnauthorized: true,
      agent: false,
      headers: { "Content-Type": "application/json", "Content-Length": body.length, Authorization: authorization },
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        text += chunk;
        if (text.length > 64 * 1024) {
          fail();
          response.destroy();
        }
      });
      response.on("aborted", fail);
      response.on("error", fail);
      response.on("end", () => {
        const status = response.statusCode ?? 502;
        try {
          const result: CaResult["body"] = JSON.parse(text);
          if (!result || typeof result !== "object") throw new Error();
          resolve({ status, body: result });
        } catch {
          reject(new FabricCaRequestError(action, status));
        }
      });
    });
    req.on("error", fail);
    req.setTimeout(10_000, () => req.destroy(new FabricCaRequestError(action, null)));
    req.end(body);
  });
}

export async function registerCustomer(memberId: string, secret: string): Promise<{ status: number; alreadyRegistered: boolean }> {
  checkMemberId(memberId);
  checkEnrollmentSecret(secret);
  const { registrar, tlsRoot } = caPaths();
  const requestUri = "/api/v1/register";
  const body = Buffer.from(JSON.stringify({
    id: memberId, type: "client", secret, caname: caName, max_enrollments: 3,
    attrs: [{ name: "role", value: "policyholder", ecert: true }, { name: "subjectId", value: memberId, ecert: true }],
  }), "utf8");
  let ca: Buffer;
  let authorization: string;
  try {
    const [certificate, keyFile, trustRoot] = await Promise.all([
      readFile(path.join(registrar, "signcerts", "cert.pem")),
      findSingleCredential(path.join(registrar, "keystore")),
      readFile(/* turbopackIgnore: true */ tlsRoot),
    ]);
    ca = trustRoot;
    const key = await readFile(keyFile);
    try {
      const signer = signers.newPrivateKeySigner(createPrivateKey(key));
      authorization = await createCaAuthorization(requestUri, body, certificate, signer);
    } finally {
      key.fill(0);
    }
  } catch {
    throw new FabricCaRequestError("registration", null);
  }
  const { status, body: response } = await sendCaRequest("registration", requestUri, body, authorization, ca);
  if (status === 201 && response.success === true) return { status, alreadyRegistered: false };
  if (status === 409 && Array.isArray(response.errors) &&
      response.errors.some((error) => error?.code === duplicateIdentityCode)) {
    return { status, alreadyRegistered: true };
  }
  throw new FabricCaRequestError("registration", status);
}

export async function enrollCustomer(memberId: string, secret: string, keyPem: string): Promise<{ status: number; certificate: string }> {
  checkEnrollmentSecret(secret);
  const { tlsRoot } = caPaths();
  const csr = createCustomerCsr(memberId, keyPem);
  const body = Buffer.from(JSON.stringify({ certificate_request: csr, caname: caName }), "utf8");
  const authorization = `Basic ${Buffer.from(`${memberId}:${secret}`, "utf8").toString("base64")}`;
  const ca = await readFile(/* turbopackIgnore: true */ tlsRoot).catch(() => { throw new FabricCaRequestError("enrollment", null); });
  const { status, body: response } = await sendCaRequest("enrollment", "/api/v1/enroll", body, authorization, ca);
  if (status !== 201 || response.success !== true || typeof response.result?.Cert !== "string") {
    throw new FabricCaRequestError("enrollment", status);
  }
  try {
    const certificate = Buffer.from(response.result.Cert, "base64").toString("utf8");
    const issued = new X509Certificate(certificate);
    if (issued.toLegacyObject().subject?.CN !== memberId || !issued.checkPrivateKey(createPrivateKey(keyPem)) ||
        !issued.verify(new X509Certificate(ca).publicKey)) throw new Error();
    return { status, certificate };
  } catch {
    throw new FabricCaRequestError("enrollment", status);
  }
}
