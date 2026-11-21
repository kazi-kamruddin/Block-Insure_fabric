import "server-only";
import { createHmac } from "node:crypto";

export function customerKey(name: "CUSTOMER_PII_KEY" | "CUSTOMER_WALLET_KEY") {
  const value = process.env[name] ?? "";
  if (!/^[\da-f]{64}$/i.test(value)) throw new Error("Customer security keys are unavailable");
  return Buffer.from(value, "hex");
}

export function nationalIdFields(nid: string, key = customerKey("CUSTOMER_PII_KEY")) {
  return {
    nidHmac: createHmac("sha256", key).update(`block-insure:nid:${nid}`).digest("hex"),
    nidLast3: nid.slice(-3),
  };
}
