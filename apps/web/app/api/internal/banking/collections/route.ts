import { NextResponse } from "next/server";
import { z } from "zod";
import { createHmac } from "node:crypto";
import { ledger } from "@/lib/fabric/ledger";
import { verifyBearerToken } from "@/lib/security/bearer-token";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("listDue"), asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("run"), asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({
    action: z.literal("process"), collectionId: z.string().min(3), paymentId: z.string().min(3),
    transferId: z.string().min(3), destinationAccountId: z.string().min(3),
    periodEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    externalReferenceHash: z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase()),
  }),
]);

export const runtime = "nodejs";

function authorized(request: Request) {
  return verifyBearerToken(request.headers.get("authorization"), process.env.BANKING_WORKER_SECRET);
}

function addDays(value: string, days: number) {
  const result = new Date(`${value}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function earlier(left: string, right: string) {
  return left < right ? left : right;
}

function stableHash(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function POST(request: Request) {
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
      const secret = process.env.BANKING_WORKER_SECRET ?? "";
      const destinationAccountId = process.env.INSURER_PREMIUM_ACCOUNT_ID ?? "bank-insurer-premium";
      const [mandates, existingCollections] = await Promise.all([ledger.listBankMandates(), ledger.listPremiumCollections()]);
      const existingKeys = new Set(existingCollections.map((item) => `${item.mandateId}:${item.dueDate}`));
      const hasUnmaterializedDueDate = mandates.some((item) => item.status === "ACTIVE" && Boolean(item.nextDebitDate) && item.nextDebitDate <= asOfDate && item.nextDebitDate <= item.expiryDate && !existingKeys.has(`${item.id}:${item.nextDebitDate}`));
      const scheduled = hasUnmaterializedDueDate ? await ledger.schedulePremiumCollections(asOfDate) : [];
      const currentCollections = scheduled.length > 0 ? await ledger.listPremiumCollections() : existingCollections;
      const collections = currentCollections
        .filter((item) => ["DUE", "RETRY"].includes(item.status) && item.dueDate <= asOfDate)
        .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id));
      const results: Array<{ collectionId: string; status: string; message?: string }> = [];
      for (const collection of collections) {
        try {
          const [mandate, policy] = await Promise.all([
            ledger.readBankMandate(collection.mandateId),
            ledger.readPolicy(collection.policyId),
          ]);
          const periodEndDate = earlier(earlier(addDays(collection.dueDate, Math.max(1, mandate.intervalDays) - 1), mandate.expiryDate), policy.endDate);
          const attempt = Math.max(1, collection.attemptCount + 1);
          const baseId = `${collection.id}-a${attempt}`;
          const result = await ledger.processPremiumCollection({
            collectionId: collection.id,
            paymentId: `payment-${baseId}`,
            transferId: `transfer-${baseId}`,
            destinationAccountId,
            periodEndDate,
            externalReferenceHash: stableHash(secret, `block-insure-eft:${baseId}`),
          });
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
