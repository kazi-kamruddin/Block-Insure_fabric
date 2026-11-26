import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createCustomerKey, enrollCustomer, registerCustomer } from "@/lib/fabric/ca-client";
import { CustomerStore, type CustomerRecord } from "./store";
import { serialized } from "./state-file";
import { customerWallet, openCustomerValue, saveCustomerWallet, sealCustomerValue } from "./wallet";

type Decision = "approve" | "reject" | "suspend" | "reactivate";

// One person, one customer: a national ID already held by a live account
// (active or suspended) must not be approved again under a new member ID.
export function nationalIdHolder(customers: readonly CustomerRecord[], customer: CustomerRecord) {
  if (!customer.nidHmac) return undefined;
  return customers.find(item => item.memberId !== customer.memberId && item.nidHmac === customer.nidHmac
    && (item.status === "ACTIVE" || item.status === "SUSPENDED"));
}

export async function decideCustomer(memberId: string, decision: Decision, by: string, reason: string) {
  const store = new CustomerStore();
  function update(edit: (customer: CustomerRecord) => void) {
    return store.update(customers => {
      const customer = customers.find(item => item.memberId === memberId);
      if (!customer) return undefined;
      edit(customer);
      return customer;
    });
  }
  const decisionRecord = () => ({ by, at: new Date().toISOString(), reasonHash: createHash("sha256").update(reason || decision).digest("hex") });

  return serialized(`${store.file}:issuance:${memberId}`, async () => {
    const record = await store.find(memberId);
    if (!record) return { outcome: "missing" } as const;
    if (decision === "reactivate") {
      // Only a customer who was approved (and so holds a certificate) returns.
      if (record.status !== "SUSPENDED" || !(await customerWallet(memberId))?.certificate) return { outcome: "conflict" } as const;
      if (nationalIdHolder(await store.list(), record)) return { outcome: "duplicate-nid" } as const;
      const customer = await update(item => {
        item.status = "ACTIVE";
        item.kycDecision = decisionRecord();
        delete item.sessionId;
      });
      return { outcome: "ok", customer: customer!, changed: true } as const;
    }
    if (decision !== "approve") {
      const expected = decision === "reject" ? "PENDING_KYC" : "ACTIVE";
      if (record.status !== expected || record.issuance) return { outcome: "conflict" } as const;
      const customer = await update(item => {
        item.status = decision === "reject" ? "REJECTED" : "SUSPENDED";
        item.kycDecision = decisionRecord();
        delete item.sessionId;
      });
      return { outcome: "ok", customer: customer!, changed: true } as const;
    }
    if (record.status === "ACTIVE") return { outcome: "ok", customer: record, changed: false } as const;
    if (record.status !== "PENDING_KYC") return { outcome: "conflict" } as const;
    if (nationalIdHolder(await store.list(), record)) return { outcome: "duplicate-nid" } as const;
    const secretContext = `${memberId}:enrollment`;
    const keyContext = `${memberId}:key`;
    let issuance = record.issuance;
    if (!issuance) {
      const secret = randomBytes(32).toString("base64url");
      const prepared = { phase: "PREPARED" as const, secret: sealCustomerValue(secret, secretContext) };
      await update(item => { item.issuance = prepared; });
      issuance = prepared;
    }
    const encryptedSecret = issuance.secret;
    const secret = openCustomerValue(encryptedSecret, secretContext);
    let registerHttpStatus = issuance.registerHttpStatus;
    if (issuance.phase === "PREPARED") {
      const registered = await registerCustomer(memberId, secret);
      registerHttpStatus = registered.status;
      await update(item => {
        item.issuance = { phase: "REGISTERED", secret: encryptedSecret, registerHttpStatus };
      });
    }
    let wallet = await customerWallet(memberId);
    if (!wallet) {
      wallet = { privateKey: sealCustomerValue(createCustomerKey(), keyContext) };
      await saveCustomerWallet(memberId, wallet);
    }
    let enrollHttpStatus = wallet.enrollHttpStatus;
    if (!wallet.certificate) {
      const enrolled = await enrollCustomer(memberId, secret, openCustomerValue(wallet.privateKey, keyContext));
      enrollHttpStatus = enrolled.status;
      await saveCustomerWallet(memberId, { ...wallet, certificate: enrolled.certificate, enrollHttpStatus });
    }
    if (registerHttpStatus === undefined || enrollHttpStatus === undefined) throw new Error("Customer issuance state is incomplete");
    const certificateIssued = { registerHttpStatus, enrollHttpStatus };
    const customer = await update(item => {
      item.status = "ACTIVE";
      item.kycDecision = decisionRecord();
      item.certificateIssued = certificateIssued;
      delete item.issuance;
    });
    return { outcome: "ok", customer: customer!, changed: true } as const;
  });
}
