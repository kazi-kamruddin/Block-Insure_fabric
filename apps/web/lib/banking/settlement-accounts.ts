import type { BankAccountReference } from "@/lib/fabric/types";

export type AccountChoice = Pick<BankAccountReference, "id" | "bankId" | "accountLabel" | "maskedAccount" | "balanceMinor">;

function choice(account: BankAccountReference): AccountChoice {
  const { id, bankId, accountLabel, maskedAccount, balanceMinor } = account;
  return { id, bankId, accountLabel, maskedAccount, balanceMinor };
}

// Suggests the accounts for a claim payout at one of the policy's Banks: the
// claimant's newest verified customer account, and the Insurer's verified
// claims reserve there (an account labelled "reserve" or "claim" first, then
// the largest balance). The Insurer still reviews and submits the choice, and
// the chaincode re-checks ownership, Bank and balance when it authorizes.
export function suggestSettlementAccounts(accounts: readonly BankAccountReference[], policyBankIds: readonly string[], claimantId: string) {
  for (const bankId of policyBankIds) {
    const verified = accounts.filter(account => account.bankId === bankId && account.status === "VERIFIED");
    const destination = verified
      .filter(account => account.accountType === "CUSTOMER" && account.ownerId === claimantId)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
    const source = verified
      .filter(account => account.accountType === "INSURER" && account.ownerId === "insurer")
      .sort((left, right) => Number(/reserve|claim/i.test(right.accountLabel)) - Number(/reserve|claim/i.test(left.accountLabel))
        || right.balanceMinor - left.balanceMinor || left.id.localeCompare(right.id))[0];
    if (destination && source) return { bankId, source: choice(source), destination: choice(destination) };
  }
  return null;
}
