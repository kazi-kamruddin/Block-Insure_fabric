import "server-only";

import { findDemoAccountBySubject } from "@/lib/auth/accounts";
import { deliverBankCommunication } from "@/lib/banking/email-gateway";
import { ledger } from "@/lib/fabric/ledger";
import { readEventProjection, updateProjectedCommunication } from "./store";

async function resolveRecipient(subject: string, policyId: string) {
  let resolvedSubject = subject;
  if (!resolvedSubject && policyId) resolvedSubject = (await ledger.readPolicy(policyId)).policyholderId;
  return findDemoAccountBySubject(resolvedSubject)?.email ?? process.env.POLICYHOLDER_TRANSACTION_EMAIL?.trim() ?? "";
}

export async function deliverPendingBankCommunications() {
  const projection = await readEventProjection();
  let delivered = 0;
  let failed = 0;
  for (const communication of projection.communications.filter((item) => item.status === "PENDING" || item.status === "FAILED")) {
    try {
      const recipient = await resolveRecipient(communication.recipientSubject, communication.policyId);
      if (!recipient) throw new Error("No policyholder transaction email is configured");
      const result = await deliverBankCommunication({ recipient, template: communication.template, variables: communication.variables });
      await updateProjectedCommunication(communication.id, {
        status: result.adapter === "demo" ? "DEMO" : "DELIVERED",
        adapter: result.adapter,
        recipient: result.recipient,
        messageId: result.messageId ?? "",
        error: "",
        deliveredAt: new Date().toISOString(),
      });
      delivered += 1;
    } catch (error) {
      await updateProjectedCommunication(communication.id, {
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
      });
      failed += 1;
    }
  }
  return { delivered, failed };
}
