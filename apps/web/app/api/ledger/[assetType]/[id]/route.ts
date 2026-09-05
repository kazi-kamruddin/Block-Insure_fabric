import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { ledger } from "@/lib/fabric/ledger";

const routeSchema = z.object({
  assetType: z.enum(["package", "policy", "claim", "evidence", "verification", "decision", "settlement", "claim-history"]),
  id: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/),
});

type RouteContext = { params: Promise<{ assetType: string; id: string }> };

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });

  const parsed = routeSchema.safeParse(await context.params);
  if (!parsed.success) return NextResponse.json({ message: "Invalid asset query" }, { status: 400 });

  try {
    const { assetType, id } = parsed.data;
    let result: unknown;
    switch (assetType) {
      case "package":
        result = await ledger.readPolicyPackage(id);
        break;
      case "policy": {
        const policy = await ledger.readPolicy(id);
        result = policy;
        if (session.role === "policyholder" && policy.policyholderId !== session.subjectId) {
          return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        }
        break;
      }
      case "claim": {
        const claim = await ledger.readClaim(id);
        result = claim;
        if (session.role === "policyholder" && claim.claimantId !== session.subjectId) {
          return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
        }
        break;
      }
      case "evidence": {
        const evidence = await ledger.readEvidenceReference(id);
        result = evidence;
        if (session.role === "policyholder") {
          const claim = await ledger.readClaim(evidence.claimId);
          if (claim.claimantId !== session.subjectId) {
            return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
          }
        }
        break;
      }
      case "verification": {
        const verification = await ledger.readHospitalVerification(id);
        result = verification;
        if (session.role === "policyholder") {
          const claim = await ledger.readClaim(verification.claimId);
          if (claim.claimantId !== session.subjectId) {
            return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
          }
        }
        break;
      }
      case "decision": {
        const decision = await ledger.readAuditorDecision(id);
        result = decision;
        if (session.role === "policyholder") {
          const claim = await ledger.readClaim(decision.claimId);
          if (claim.claimantId !== session.subjectId) {
            return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
          }
        }
        break;
      }
      case "settlement": {
        const settlement = await ledger.readSettlement(id);
        result = settlement;
        if (session.role === "policyholder") {
          const claim = await ledger.readClaim(settlement.claimId);
          if (claim.claimantId !== session.subjectId) {
            return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
          }
        }
        break;
      }
      case "claim-history": {
        if (session.role === "policyholder") {
          const claim = await ledger.readClaim(id);
          if (claim.claimantId !== session.subjectId) {
            return NextResponse.json({ message: "Asset is not owned by this account" }, { status: 403 });
          }
        }
        result = await ledger.claimHistory(id);
        break;
      }
    }

    return NextResponse.json({ result });
  } catch (error) {
    console.error("Ledger query failed", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Ledger query failed" },
      { status: 404 },
    );
  }
}
