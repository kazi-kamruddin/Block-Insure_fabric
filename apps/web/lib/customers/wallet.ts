import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { memberIdPattern } from "./member-id";
import { customerKey } from "./pii";
import { customerStateRoot } from "./settings";
import { readJson, writeJson } from "./state-file";
import { sealedValue, type SealedValue } from "./store";

export function sealCustomerValue(value: string, context: string, key = customerKey("CUSTOMER_WALLET_KEY")): SealedValue {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`block-insure:wallet:v1:${context}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { version: 1, nonce: nonce.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

export function openCustomerValue(value: SealedValue, context: string, key = customerKey("CUSTOMER_WALLET_KEY")) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.nonce, "base64url"), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(`block-insure:wallet:v1:${context}`));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

const walletSchema = z.object({ privateKey: sealedValue, certificate: z.string().optional(), enrollHttpStatus: z.number().int().optional() }).strict();
type Wallet = z.infer<typeof walletSchema>;

function walletFile(memberId: string) {
  if (!memberIdPattern.test(memberId)) throw new Error("Unknown customer wallet");
  return path.join(customerStateRoot(), "customer-wallet", memberId, "wallet.json");
}

export async function customerWallet(memberId: string) {
  return walletSchema.nullable().parse(await readJson(walletFile(memberId), null));
}

export async function saveCustomerWallet(memberId: string, wallet: Wallet) {
  await writeJson(walletFile(memberId), walletSchema.parse(wallet));
}

export async function loadCustomerCredentials(memberId: string) {
  const wallet = await customerWallet(memberId);
  if (!wallet?.certificate) throw new Error("Customer identity is unavailable");
  return { certificate: Buffer.from(wallet.certificate), privateKey: Buffer.from(openCustomerValue(wallet.privateKey, `${memberId}:key`)) };
}
