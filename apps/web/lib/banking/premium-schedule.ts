import type { BankAccountReference, Policy } from "@/lib/fabric/types";
import { formatBdt } from "@/lib/money";

export { formatBdt };

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

export const defaultGracePeriodDays = 15;

type StandingPolicy = Pick<Policy, "status" | "startDate" | "endDate" | "nextPremiumDueDate"> &
  Partial<Pick<Policy, "medicalRulesVersion" | "gracePeriodDays" | "coverStartDate" | "reinstatedDate">>;

// Mirrors the chaincode's medical premium timing rules so the interface only
// offers payments the ledger will accept. The chaincode remains the authority.
export function premiumStanding(policy: StandingPolicy, today: string): { canPay: boolean; note: string } {
  if (policy.status === "CANCELLED" || policy.status === "EXPIRED") return { canPay: false, note: `This policy is ${policy.status.toLowerCase()}.` };
  if (!policy.medicalRulesVersion) return { canPay: true, note: "" };
  const grace = policy.gracePeriodDays || defaultGracePeriodDays;
  if (policy.status === "PENDING_PAYMENT") {
    const lastDay = addDays(policy.startDate, grace);
    if (today > lastDay) return { canPay: false, note: `The first premium had to be paid by ${lastDay}. This offer has expired; buy a new policy.` };
    return { canPay: true, note: policy.startDate > today
      ? `Cover begins on ${policy.startDate} once the first premium is paid.`
      : `Cover begins on the day the first premium is paid (last day ${lastDay}).` };
  }
  if (policy.status === "LAPSED") {
    return policy.reinstatedDate === today && policy.nextPremiumDueDate === today
      ? { canPay: true, note: `Reinstated today. Cover resumes once today's installment is paid; the lapse gap is not covered and waiting periods restart.` }
      : { canPay: false, note: "This policy has lapsed. Missed installments cannot be paid; ask the Insurer to reinstate it." };
  }
  const due = policy.nextPremiumDueDate || policy.startDate;
  const graceEnd = addDays(due, grace);
  if (today > graceEnd) return { canPay: false, note: `The grace period for the installment due ${due} ended on ${graceEnd}. The policy has lapsed; ask the Insurer to reinstate it.` };
  if (today > due) return { canPay: true, note: `In grace until ${graceEnd}. Paying now keeps cover continuous.` };
  return { canPay: true, note: "" };
}

export function maskAccountNumber(lastDigits: string) {
  const digits = lastDigits.replace(/\D/g, "");
  if (digits.length < 2 || digits.length > 6) throw new Error("Enter the last 2 to 6 digits of the account number");
  return `**** ${digits}`;
}
