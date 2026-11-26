import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";
import { ledgerIdSchema } from "@/lib/fabric/validation";
import { checkMutationOrigin } from "@/lib/security/request-origin";
import { processDueCollection } from "@/lib/banking/collections";

export const runtime = "nodejs";

async function bankSession() {
  const session = await currentSession().catch(() => null);
  return session?.role === "bankOfficer" ? session : null;
}

// The Bank's work queue: link requests and mandates to review, and premium
// collections to process. It shows account display values and balances, which
// the Bank already holds, but no policy or medical facts.
export async function GET() {
  if (!await bankSession()) return NextResponse.json({ message: "A Bank officer session is required" }, { status: 403 });
  try {
    const [links, mandates, collections, accounts] = await Promise.all([
      ledger.listBankAccountLinks(), ledger.listBankMandates(), ledger.listPremiumCollections(), ledger.listBankAccountReferences(),
    ]);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const mandateById = new Map(mandates.map((mandate) => [mandate.id, mandate]));
    const display = (id: string) => {
      const account = byId.get(id);
      return account ? { id: account.id, ownerId: account.ownerId, accountLabel: account.accountLabel, maskedAccount: account.maskedAccount, balanceMinor: account.balanceMinor } : null;
    };
    return NextResponse.json({
      links: links.filter((link) => link.status === "PENDING"),
      mandates: mandates.filter((mandate) => mandate.status === "PENDING").map((mandate) => ({ ...mandate, account: display(mandate.accountReferenceId) })),
      collections: collections.filter((collection) => ["DUE", "RETRY", "BOUNCED"].includes(collection.status))
        .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id))
        .map((collection) => ({ ...collection, account: display(mandateById.get(collection.mandateId)?.accountReferenceId ?? "") })),
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "The Bank work queue is unavailable" }, { status: 409 });
  }
}

const actionSchema = z.object({ action: z.literal("processCollection"), collectionId: ledgerIdSchema });

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });
  if (!await bankSession()) return NextResponse.json({ message: "A Bank officer session is required" }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Invalid Bank action" }, { status: 400 });
  try {
    const collection = await ledger.readPremiumCollection(parsed.data.collectionId);
    if (!["DUE", "RETRY"].includes(collection.status)) return NextResponse.json({ message: `Collection is ${collection.status}, not due` }, { status: 409 });
    return NextResponse.json({ result: await processDueCollection(collection) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Collection processing failed" }, { status: 409 });
  }
}
