import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { loadFabricConfig } from "@/lib/fabric/config";
import { checkMutationOrigin } from "@/lib/security/request-origin";
import { workflowCommandSchema } from "@/lib/workflows/commands";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!loadFabricConfig().externalBankCustody) return new NextResponse(null, { status: 404 });
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  if (session.role !== "bankOfficer") return NextResponse.json({ message: "Bank account required" }, { status: 403 });

  const parsed = workflowCommandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.operation !== "confirmSettlement") {
    return NextResponse.json({ message: "Expected a settlement confirmation request" }, { status: 400 });
  }
  const { settlementId, transferId, bankReferenceHash } = parsed.data;
  return NextResponse.json({ settlementId, transferId, bankReferenceHash }, {
    headers: { "Cache-Control": "no-store", "Content-Disposition": "attachment; filename=bank-signing-request.json" },
  });
}
