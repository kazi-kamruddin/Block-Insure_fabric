import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";

const idSchema = z.string().min(3).max(128).regex(/^[a-zA-Z0-9._:-]+$/);
type RouteContext = { params: Promise<{ id: string }> };
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ message: "Invalid policy ID" }, { status: 400 });
  try {
    const policy = await ledger.readPolicy(id.data);
    if (session.role === "policyholder" && policy.policyholderId !== session.subjectId) {
      return NextResponse.json({ message: "Policy is not owned by this account" }, { status: 403 });
    }
    const [payments, adjustments, mandates, collections, claims, benefits, liabilities] = await Promise.all([
      ledger.listPremiumPayments(), ledger.listPremiumAdjustments(), ledger.listBankMandates(),
      ledger.listPremiumCollections(), ledger.listClaims(), ledger.listBenefitRequests(), ledger.listLiabilities(),
    ]);
    const policyPayments = payments.filter((item) => item.policyId === policy.id);
    const policyAdjustments = adjustments.filter((item) => item.policyId === policy.id);
    const statement = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      policy,
      summary: {
        grossPremiumMinor: policyPayments.reduce((sum, item) => sum + item.amountMinor, 0),
        adjustedPremiumMinor: policyAdjustments.reduce((sum, item) => sum + item.amountMinor, 0),
        netPremiumMinor: policyPayments.reduce((sum, item) => sum + item.amountMinor, 0) - policyAdjustments.reduce((sum, item) => sum + item.amountMinor, 0),
        nextPremiumDueDate: policy.nextPremiumDueDate ?? null,
      },
      payments: policyPayments,
      adjustments: policyAdjustments,
      mandates: mandates.filter((item) => item.policyId === policy.id),
      collections: collections.filter((item) => item.policyId === policy.id),
      claims: claims.filter((item) => item.policyId === policy.id),
      benefits: benefits.filter((item) => item.policyId === policy.id),
      liabilities: liabilities.filter((item) => item.policyId === policy.id),
    };
    return NextResponse.json(statement, { headers: { "content-disposition": `attachment; filename="${policy.id}-statement.json"`, "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Statement generation failed" }, { status: 404 });
  }
}
