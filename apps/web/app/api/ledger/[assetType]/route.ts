import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";

const assetTypeSchema = z.enum(["package", "policy", "claim", "evidence", "settlement"]);
type RouteContext = { params: Promise<{ assetType: string }> };

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });

  const assetType = assetTypeSchema.safeParse((await context.params).assetType);
  if (!assetType.success) return NextResponse.json({ message: "Invalid asset collection" }, { status: 400 });

  try {
    let result: unknown[];
    switch (assetType.data) {
      case "package":
        result = await ledger.listPolicyPackages();
        break;
      case "policy": {
        const policies = await ledger.listPolicies();
        result = session.role === "policyholder"
          ? policies.filter((policy) => policy.policyholderId === session.subjectId)
          : policies;
        break;
      }
      case "claim": {
        const claims = await ledger.listClaims();
        result = session.role === "policyholder"
          ? claims.filter((claim) => claim.claimantId === session.subjectId)
          : claims;
        break;
      }
      case "evidence": {
        const evidence = await ledger.listEvidenceReferences();
        result = session.role === "policyholder"
          ? evidence.filter((item) => item.submittedBy === session.subjectId)
          : evidence;
        break;
      }
      case "settlement": {
        const settlements = await ledger.listSettlements();
        if (session.role !== "policyholder") {
          result = settlements;
          break;
        }
        const ownedClaimIds = new Set(
          (await ledger.listClaims())
            .filter((claim) => claim.claimantId === session.subjectId)
            .map((claim) => claim.id),
        );
        result = settlements.filter((settlement) => ownedClaimIds.has(settlement.claimId));
        break;
      }
    }
    return NextResponse.json({ result });
  } catch (error) {
    console.error("Ledger collection query failed", error);
    return NextResponse.json({ message: "Ledger collection query failed" }, { status: 502 });
  }
}
