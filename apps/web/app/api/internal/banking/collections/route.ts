import { NextResponse } from "next/server";
import { z } from "zod";
import { ledgerDateSchema, ledgerIdSchema } from "@/lib/fabric/validation";
import { ledger } from "@/lib/fabric/ledger";
import { verifyBearerToken } from "@/lib/security/bearer-token";
import { checkMutationOrigin } from "@/lib/security/request-origin";
import { processDueCollection } from "@/lib/banking/collections";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("listDue"), asOfDate: ledgerDateSchema }),
  z.object({ action: z.literal("run"), asOfDate: ledgerDateSchema }),
  z.object({
    action: z.literal("process"), collectionId: ledgerIdSchema, paymentId: ledgerIdSchema,
    transferId: ledgerIdSchema, destinationAccountId: ledgerIdSchema,
    periodEndDate: ledgerDateSchema,
    externalReferenceHash: z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase()),
  }),
]);

export const runtime = "nodejs";

function authorized(request: Request) {
  return verifyBearerToken(request.headers.get("authorization"), process.env.BANKING_WORKER_SECRET);
}

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });
  if (!authorized(request)) return NextResponse.json({ message: "Worker authentication failed" }, { status: 401 });
  const parsed = commandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Invalid collection worker command" }, { status: 400 });
  try {
    if (parsed.data.action === "listDue") {
      const asOfDate = parsed.data.asOfDate;
      const collections = await ledger.listPremiumCollections();
      return NextResponse.json({ result: collections.filter((item) => ["DUE", "RETRY"].includes(item.status) && item.dueDate <= asOfDate) });
    }
    if (parsed.data.action === "run") {
      const asOfDate = parsed.data.asOfDate;
      const [mandates, existingCollections] = await Promise.all([ledger.listBankMandates(), ledger.listPremiumCollections()]);
      const existingKeys = new Set(existingCollections.map((item) => `${item.mandateId}:${item.dueDate}`));
      const hasUnmaterializedDueDate = mandates.some((item) => item.status === "ACTIVE" && Boolean(item.nextDebitDate) && item.nextDebitDate <= asOfDate && item.nextDebitDate <= item.expiryDate && !existingKeys.has(`${item.id}:${item.nextDebitDate}`));
      const scheduled = hasUnmaterializedDueDate ? await ledger.schedulePremiumCollections(asOfDate) : [];
      const currentCollections = scheduled.length > 0 ? await ledger.listPremiumCollections() : existingCollections;
      const collections = currentCollections
        .filter((item) => ["DUE", "RETRY"].includes(item.status) && item.dueDate <= asOfDate)
        .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id));
      const accounts = collections.length > 0 ? await ledger.listBankAccountReferences() : [];
      const results: Array<{ collectionId: string; status: string; message?: string }> = [];
      for (const collection of collections) {
        try {
          const result = await processDueCollection(collection, { accounts });
          results.push({ collectionId: collection.id, status: result.status });
        } catch (error) {
          results.push({ collectionId: collection.id, status: "ERROR", message: error instanceof Error ? error.message : "Unknown processing error" });
        }
      }
      return NextResponse.json({ asOfDate, scheduled: scheduled.length, attempted: results.length, results });
    }
    return NextResponse.json({ result: await ledger.processPremiumCollection(parsed.data) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Collection worker failed" }, { status: 409 });
  }
}
