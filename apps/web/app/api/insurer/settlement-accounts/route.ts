import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { suggestSettlementAccounts } from "@/lib/banking/settlement-accounts";
import { ledger } from "@/lib/fabric/ledger";

export const dynamic = "force-dynamic";
const claimId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/);

export async function GET(request: Request) {
  const session = await currentSession().catch(() => null);
  if (session?.role !== "insurerAdmin") return NextResponse.json({ message: "Insurer access is required" }, { status: 403 });
  const parsed = claimId.safeParse(new URL(request.url).searchParams.get("claim"));
  if (!parsed.success) return NextResponse.json({ message: "Enter a valid claim ID" }, { status: 400 });
  try {
    const claim = await ledger.readClaim(parsed.data);
    const policy = await ledger.readPolicy(claim.policyId);
    const suggestion = suggestSettlementAccounts(await ledger.listBankAccountReferences(), policy.bankIds ?? [], claim.claimantId);
    if (!suggestion) {
      return NextResponse.json({ message: "No verified claimant account and Insurer reserve share one of this policy's Banks" }, { status: 404 });
    }
    return NextResponse.json({ claimId: claim.id, ...suggestion }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ message: "The claim or its accounts could not be read" }, { status: 404 });
  }
}
