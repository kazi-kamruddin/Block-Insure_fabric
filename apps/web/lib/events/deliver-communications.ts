import "server-only";
import { createHash } from "node:crypto";

import { findDemoAccountBySubject } from "@/lib/auth/accounts";
import { activeCustomerTransactionRecipient } from "@/lib/auth/customer-recipient";
import { deliverBankCommunication } from "@/lib/banking/email-gateway";
import { memberIdPattern } from "@/lib/customers/member-id";
import { ledger } from "@/lib/fabric/ledger";
import { loadFabricConfig } from "@/lib/fabric/config";
import { readEventProjection, updateProjectedCommunication } from "./store";

const maximumAttempts = 5;
const initialBackoffMs = 5_000;
const maximumDeliveriesPerCycle = 10;
let activeDelivery: Promise<{ delivered: number; failed: number }> | undefined;

async function resolveRecipient(subject: string, policyId: string) {
  let resolvedSubject = subject;
  if (!resolvedSubject && policyId) resolvedSubject = (await ledger.readPolicy(policyId)).policyholderId;
  if (memberIdPattern.test(resolvedSubject)) return activeCustomerTransactionRecipient(resolvedSubject);
  const configured = findDemoAccountBySubject(resolvedSubject)?.email;
  if (configured) return configured;
  const fallbackSubject = process.env.POLICYHOLDER_TRANSACTION_SUBJECT?.trim();
  return fallbackSubject && fallbackSubject === resolvedSubject ? process.env.POLICYHOLDER_TRANSACTION_EMAIL?.trim() ?? "" : "";
}

async function deliverBatch(now: () => number) {
  const projection = await readEventProjection();
  const config = loadFabricConfig();
  const instance = process.env.FABRIC_LEDGER_INSTANCE_ID;
  const idempotencyKey = (event: string, recipient: string) => createHash("sha256").update(JSON.stringify({
    domain: "fabric-bank-communication-v1", channel: config.channelName, chaincode: config.chaincodeName,
    ...(instance ? { instance } : {}), event, recipient,
  })).digest("hex");
  const priorDeliveries = new Map(projection.communications
    .filter((item) => item.status === "DELIVERED" || item.status === "DEMO")
    .map((item) => [idempotencyKey(item.eventId, item.recipient.toLowerCase()), item]));
  let delivered = 0;
  let failed = 0;
  const pending = projection.communications.filter((item) =>
    (item.status === "PENDING" || (item.status === "FAILED" && item.deliveryAttempts === undefined)) &&
    (!item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now())).slice(0, maximumDeliveriesPerCycle);
  for (const communication of pending) {
    const previousAttempts = communication.deliveryAttempts ?? 0;
    if (previousAttempts >= maximumAttempts) {
      await updateProjectedCommunication(communication.id, {
        status: "FAILED", error: "Delivery acknowledgement unavailable after restart", nextAttemptAt: "",
      });
      failed += 1;
      continue;
    }
    const attempts = previousAttempts + 1;
    const nextAttemptAt = new Date(now() + initialBackoffMs * 2 ** (attempts - 1)).toISOString();
    let failureReason = "Recipient account is unavailable";
    let recipient: string | undefined;
    let outcome: Awaited<ReturnType<typeof deliverBankCommunication>> | undefined;
    try {
      recipient = (await resolveRecipient(communication.recipientSubject, communication.policyId))?.trim().toLowerCase();
    } catch {
      // Keep contact and peer errors out of persisted delivery diagnostics.
    }
    if (recipient) {
      const key = idempotencyKey(communication.eventId, recipient);
      const original = priorDeliveries.get(key);
      if (original) {
        await updateProjectedCommunication(communication.id, {
          status: original.status, adapter: original.adapter, recipient: original.recipient, messageId: original.messageId,
          deliveredAt: original.deliveredAt, error: "", nextAttemptAt: "",
        });
        continue;
      }
      // Persist the attempt before sending. A restart with an unacknowledged
      // send retries the same key and cannot exceed the attempt budget.
      await updateProjectedCommunication(communication.id, {
        status: "PENDING", deliveryAttempts: attempts, nextAttemptAt,
      });
      try {
        outcome = await deliverBankCommunication({
          recipient, template: communication.template, variables: communication.variables,
          idempotencyKey: key,
        });
      } catch {
        failureReason = "Email delivery did not acknowledge the message";
      }
    }
    if (!outcome) {
      const terminal = attempts >= maximumAttempts;
      await updateProjectedCommunication(communication.id, {
        status: terminal ? "FAILED" : "PENDING", deliveryAttempts: attempts, error: failureReason,
        nextAttemptAt: terminal ? "" : nextAttemptAt,
      });
      failed += 1;
      continue;
    }
    const patch = {
      status: outcome.adapter === "demo" ? "DEMO" as const : "DELIVERED" as const,
      adapter: outcome.adapter, recipient: outcome.recipient, messageId: outcome.messageId ?? "",
      error: "", deliveredAt: new Date(now()).toISOString(), deliveryAttempts: attempts, nextAttemptAt: "",
    };
    await updateProjectedCommunication(communication.id, patch);
    priorDeliveries.set(idempotencyKey(communication.eventId, outcome.recipient.toLowerCase()), { ...communication, ...patch });
    delivered += 1;
  }
  return { delivered, failed };
}

export function deliverPendingBankCommunications(now = Date.now) {
  if (activeDelivery) return activeDelivery;
  const operation = deliverBatch(now);
  activeDelivery = operation;
  void operation.finally(() => {
    if (activeDelivery === operation) activeDelivery = undefined;
  }).catch(() => undefined);
  return operation;
}
