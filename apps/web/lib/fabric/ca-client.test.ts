import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import { signers } from "@hyperledger/fabric-gateway";
import { describe, expect, it, vi } from "vitest";
import { createCaAuthorization, createCustomerCsr, createCustomerKey, registerCustomer } from "./ca-client";

vi.mock("server-only", () => ({}));

function readDer(bytes: Buffer, offset = 0) {
  const tag = bytes[offset];
  const first = bytes[offset + 1];
  const headerLength = first < 128 ? 2 : 3;
  if (first >= 128) expect(first).toBe(0x81);
  const length = first < 128 ? first : bytes[offset + 2];
  const next = offset + headerLength + length;
  expect(next).toBeLessThanOrEqual(bytes.length);
  return { tag, next, value: bytes.subarray(offset + headerLength, next), encoded: bytes.subarray(offset, next) };
}

describe("Fabric CA onboarding wire format", () => {
  it("matches the pinned authorization digest and header vector", async () => {
    const signer = vi.fn<(digest: Uint8Array) => Promise<Uint8Array>>(async () => Buffer.from("3006020101020101", "hex"));
    const authorization = await createCaAuthorization(
      "/api/v1/register?caname=ca-insurer",
      Buffer.from('{"id":"BI-7K3Q9XMP"}'),
      Buffer.from("test-certificate\n"),
      signer,
    );
    expect(authorization).toBe("dGVzdC1jZXJ0aWZpY2F0ZQo=.MAYCAQECAQE=");
    expect(Buffer.from(signer.mock.calls[0][0]).toString("hex")).toBe(
      "b2ca021cfa0fd57f0e02a3ade8c8344dc1dae94accdb813d2dd4327840dfc2dc",
    );
  });

  it("produces a low-S DER registrar signature that binds exactly the transmitted bytes", async () => {
    const key = createPrivateKey(createCustomerKey());
    const uri = "/api/v1/register";
    const body = Buffer.from('{"id":"BI-7K3Q9XMP","type":"client"}');
    const cert = Buffer.from("synthetic certificate bytes");
    const authorization = await createCaAuthorization(uri, body, cert, signers.newPrivateKeySigner(key));
    const [encodedCert, encodedSignature] = authorization.split(".");
    const signature = Buffer.from(encodedSignature, "base64");
    const integers = readDer(signature).value;
    const s = BigInt(`0x${readDer(integers, readDer(integers).next).value.toString("hex")}`);
    const p256Order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    expect(s).toBeLessThanOrEqual(p256Order / 2n);
    const payload = `POST.${Buffer.from(uri).toString("base64")}.${body.toString("base64")}.${encodedCert}`;
    const publicKey = createPublicKey(key);
    expect(verify("sha256", Buffer.from(payload), publicKey, signature)).toBe(true);
    expect(verify("sha256", Buffer.from(`${payload}.`), publicKey, signature)).toBe(false);
  });

  it("round-trips a P-256 CSR through an independent Node parser and rejects signature tampering", () => {
    const key = createCustomerKey();
    const pem = createCustomerCsr("BI-7K3Q9XMP", key);
    const csr = readDer(Buffer.from(pem.split("\n").slice(1, -2).join(""), "base64"));
    expect(csr.tag).toBe(0x30);
    const info = readDer(csr.value);
    const algorithm = readDer(csr.value, info.next);
    const signature = readDer(csr.value, algorithm.next);
    expect(signature.next).toBe(csr.value.length);
    expect(readDer(algorithm.value).value.toString("hex")).toBe("2a8648ce3d040302");
    expect(signature.tag).toBe(0x03);
    expect(signature.value[0]).toBe(0);

    const version = readDer(info.value);
    expect(version.value.toString("hex")).toBe("00");
    const subject = readDer(info.value, version.next);
    const attribute = readDer(readDer(subject.value).value);
    const commonName = readDer(attribute.value);
    expect(commonName.value.toString("hex")).toBe("550403");
    expect(readDer(attribute.value, commonName.next).value.toString()).toBe("BI-7K3Q9XMP");
    const spki = readDer(info.value, subject.next);
    const publicKey = createPublicKey({ key: spki.encoded, format: "der", type: "spki" });
    expect(publicKey.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    expect(createPublicKey(createPrivateKey(key)).equals(publicKey)).toBe(true);
    expect(readDer(info.value, spki.next)).toMatchObject({ tag: 0xa0, next: info.value.length });
    const rawSignature = signature.value.subarray(1);
    expect(verify("sha256", info.encoded, publicKey, rawSignature)).toBe(true);
    const altered = Buffer.from(rawSignature);
    altered[altered.length - 1] ^= 1;
    expect(verify("sha256", info.encoded, publicKey, altered)).toBe(false);
    expect(() => createCustomerCsr("../../not-a-member", key)).toThrow("Invalid customer member ID");
  });

  it("refuses registration outside the LevelDB dev-lite onboarding profile", async () => {
    vi.stubEnv("DEV_LITE_ONBOARDING", "true");
    vi.stubEnv("FABRIC_CHANNEL_NAME", "insurance-medical-reimbursement");
    try {
      await expect(registerCustomer("BI-7K3Q9XMP", "A".repeat(43))).rejects.toThrow("Insurer CA onboarding requires LevelDB dev-lite");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
