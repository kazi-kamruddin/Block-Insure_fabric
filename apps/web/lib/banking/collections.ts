import "server-only";
import { createHmac } from "node:crypto";
import { ledger } from "@/lib/fabric/ledger";
import type { BankAccountReference, Policy, PremiumCollection } from "@/lib/fabric/types";
import { choosePremiumAccount, installmentEnd } from "./premium-schedule";

// Picks the Insurer's receiving account at a Bank. INSURER_PREMIUM_ACCOUNT_ID
// wins when it names a verified Insurer account at that Bank.
export async function resolveInsurerPremiumAccount(bankId: string, accounts?: BankAccountReference[]) {
  const list = accounts ?? await ledger.listBankAccountReferences();
  const account = choosePremiumAccount(list, bankId, process.env.INSURER_PREMIUM_ACCOUNT_ID);
  if (!account) throw new Error(`No verified Insurer premium account exists at ${bankId}`);
  return account;
}

function stableHash(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function processingSecret() {
  const secret = process.env.BANKING_WORKER_SECRET ?? process.env.OTP_SECRET ?? "";
  if (secret.length < 32) throw new Error("BANKING_WORKER_SECRET must contain at least 32 characters");
  return secret;
}

// Processes one DUE or RETRY collection with identifiers derived from its
// attempt number, so a replayed request reuses the same Bank reference and the
// ledger refuses a second debit.
export async function processDueCollection(collection: PremiumCollection, context: { accounts?: BankAccountReference[]; policy?: Policy } = {}) {
  const [mandate, policy] = await Promise.all([
    ledger.readBankMandate(collection.mandateId),
    context.policy ? Promise.resolve(context.policy) : ledger.readPolicy(collection.policyId),
  ]);
  const source = await ledger.readBankAccountReference(mandate.accountReferenceId);
  const destination = await resolveInsurerPremiumAccount(source.bankId, context.accounts);
  const attempt = Math.max(1, collection.attemptCount + 1);
  const baseId = `${collection.id}-a${attempt}`;
  return ledger.processPremiumCollection({
    collectionId: collection.id,
    paymentId: `payment-${baseId}`,
    transferId: `transfer-${baseId}`,
    destinationAccountId: destination.id,
    periodEndDate: installmentEnd(collection.dueDate, mandate.intervalDays, [mandate.expiryDate, policy.endDate]),
    externalReferenceHash: stableHash(processingSecret(), `block-insure-eft:${baseId}`),
  });
}
