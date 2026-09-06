import { NextResponse } from "next/server";
import { z } from "zod";
import { ledger } from "@/lib/fabric/ledger";
import { verifyBearerToken } from "@/lib/security/bearer-token";

const hash = z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("listDue"), asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("complete"), collectionId: z.string().min(3), paymentId: z.string().min(3), periodEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), externalReferenceHash: hash }),
  z.object({ action: z.literal("fail"), collectionId: z.string().min(3), failureHash: hash }),
]);

export const runtime = "nodejs";

function authorized(request: Request) {
  return verifyBearerToken(request.headers.get("authorization"), process.env.BANKING_WORKER_SECRET);
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
    if (parsed.data.action === "complete") {
      return NextResponse.json({ result: await ledger.completePremiumCollection(parsed.data.collectionId, parsed.data.paymentId, parsed.data.periodEndDate, parsed.data.externalReferenceHash) });
    }
    return NextResponse.json({ result: await ledger.failPremiumCollection(parsed.data.collectionId, parsed.data.failureHash) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Collection worker failed" }, { status: 409 });
  }
}
