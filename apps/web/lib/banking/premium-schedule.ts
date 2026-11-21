import type { BankAccountReference, Policy } from "@/lib/fabric/types";

export const defaultPremiumIntervalDays = 30;

export function addDays(value: string, days: number) {
  const result = new Date(`${value}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

// The last day of the installment that starts on `start`, capped by any later
// limit such as the mandate expiry or policy end date.
export function installmentEnd(start: string, intervalDays: number | undefined, limits: readonly string[]) {
  const end = addDays(start, Math.max(1, intervalDays || defaultPremiumIntervalDays) - 1);
  return [end, ...limits.filter(Boolean)].reduce((earliest, value) => value < earliest ? value : earliest);
}

export function nextInstallment(policy: Pick<Policy, "nextPremiumDueDate" | "startDate" | "endDate" | "premiumIntervalDays" | "premiumMinor">) {
  const start = policy.nextPremiumDueDate || policy.startDate;
  if (!start || start > policy.endDate) return null;
  return { start, end: installmentEnd(start, policy.premiumIntervalDays, [policy.endDate]), amountMinor: policy.premiumMinor };
}

export function choosePremiumAccount(accounts: readonly BankAccountReference[], bankId: string, configuredId?: string) {
  const candidates = accounts.filter((account) => account.accountType === "INSURER" && account.ownerId === "insurer"
    && account.status === "VERIFIED" && account.bankId === bankId);
  const configured = configuredId?.trim();
  if (configured) {
    const match = candidates.find((account) => account.id === configured);
    if (match) return match;
  }
  // Prefer an account labelled as the premium account, then the newest one.
  return [...candidates].sort((left, right) =>
    Number(/premium/i.test(right.accountLabel)) - Number(/premium/i.test(left.accountLabel))
    || String(right.createdAt).localeCompare(String(left.createdAt)) || left.id.localeCompare(right.id))[0] ?? null;
}

// Today's calendar date in Dhaka, the business day the chaincode checks.
export function dhakaToday(now = new Date()) {
  return new Date(now.getTime() + 6 * 3_600_000).toISOString().slice(0, 10);
}

export function formatBdt(minor: number) {
  return `BDT ${(minor / 100).toFixed(2)}`;
}

export function maskAccountNumber(lastDigits: string) {
  const digits = lastDigits.replace(/\D/g, "");
  if (digits.length < 2 || digits.length > 6) throw new Error("Enter the last 2 to 6 digits of the account number");
  return `**** ${digits}`;
}
