import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { choosePremiumAccount, dhakaToday, nextInstallment, premiumStanding } from "@/lib/banking/premium-schedule";

export const runtime = "nodejs";

// One read model for the policyholder's bank links, accounts, policies and
// premium schedule. It returns only the policyholder's own records plus the
// display fields of the Insurer account that receives the premium.
export async function GET() {
  const session = await currentSession().catch(() => null);
  if (!session || session.role !== "policyholder" || !session.subjectId) {
    return NextResponse.json({ message: "A policyholder session is required" }, { status: 403 });
  }
  const subject = session.subjectId;
  const today = dhakaToday();
  try {
    const [policies, accounts, links, mandates, collections, agreements] = await Promise.all([
      ledger.listPolicies(), ledger.listBankAccountReferences(), ledger.listBankAccountLinks(),
      ledger.listBankMandates(), ledger.listPremiumCollections(), ledger.listPartnerAgreements(),
    ]);
    const newestFirst = <T extends { createdAt: string; id: string }>(left: T, right: T) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
    const owned = policies.filter((policy) => policy.policyholderId === subject).sort(newestFirst);
    const ownedIds = new Set(owned.map((policy) => policy.id));
    const ownAccounts = accounts.filter((account) => account.ownerId === subject && account.accountType === "CUSTOMER")
      .sort(newestFirst).map(({ accountTokenHash, ...account }) => { void accountTokenHash; return account; });
    return NextResponse.json({
      banks: agreements.filter((item) => item.partnerType === "BANK" && item.status === "ACTIVE")
        .map((item) => ({ id: item.partnerId, name: item.name })),
      accounts: ownAccounts,
      links: links.filter((link) => link.ownerId === subject).sort(newestFirst),
      policies: owned.map((policy) => {
        const insurer = (policy.bankIds ?? []).map((bankId) => choosePremiumAccount(accounts, bankId, process.env.INSURER_PREMIUM_ACCOUNT_ID)).find(Boolean);
        return {
          id: policy.id, packageId: policy.packageId, status: policy.status, createdAt: policy.createdAt, startDate: policy.startDate, endDate: policy.endDate,
          premiumMinor: policy.premiumMinor, paidThroughDate: policy.paidThroughDate ?? "", nextPremiumDueDate: policy.nextPremiumDueDate ?? "",
          bankIds: policy.bankIds ?? [], nextInstallment: ["CANCELLED", "EXPIRED"].includes(policy.status) ? null : nextInstallment(policy),
          coverStartDate: policy.coverStartDate ?? "", reinstatedDate: policy.reinstatedDate ?? "", standing: premiumStanding(policy, today),
          insurerAccount: insurer ? { id: insurer.id, bankId: insurer.bankId, accountLabel: insurer.accountLabel, maskedAccount: insurer.maskedAccount } : null,
        };
      }),
      mandates: mandates.filter((mandate) => mandate.ownerId === subject),
      collections: collections.filter((collection) => ownedIds.has(collection.policyId)),
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Premium details are unavailable" }, { status: 409 });
  }
}
