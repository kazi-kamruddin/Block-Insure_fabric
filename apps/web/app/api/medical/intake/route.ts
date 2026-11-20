import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { loadFabricConfig } from "@/lib/fabric/config";
import { ledger } from "@/lib/fabric/ledger";
import { ledgerIdSchema } from "@/lib/fabric/validation";
import { isMedicalChannel } from "@/lib/fabric/medical-channel";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await currentSession().catch(() => null);
  if (!session || (session.role !== "policyholder" && session.role !== "insurerAdmin")) {
    return NextResponse.json({ message: "Insurer or policyholder access required" }, { status: 403 });
  }
  if (!isMedicalChannel(loadFabricConfig().channelName)) return NextResponse.json({ message: "Medical candidate unavailable" }, { status: 404 });
  const reply = (body: unknown) => NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  try {
    const query = new URL(request.url).searchParams;
    const revision = query.get("revision");
    if (revision !== null) {
      if (session.role !== "policyholder" || !/^[1-9][0-9]{0,8}$/.test(revision)) {
        return NextResponse.json({ message: "Invalid episode revision" }, { status: 400 });
      }
      if (query.has("claim")) return reply({ quote: await ledger.quoteMedicalCorrection(ledgerIdSchema.parse(query.get("claim")), revision) });
      return reply({ quote: await ledger.quoteMedicalClaim(ledgerIdSchema.parse(query.get("policy")), ledgerIdSchema.parse(query.get("episode")), revision) });
    }
    const episodes = await ledger.listMedicalEpisodes(session.role);
    if (session.role === "insurerAdmin") return reply({ episodes });
    const [policies, claims] = await Promise.all([ledger.listPolicies(), ledger.listClaims()]);
    return reply({ episodes,
      policies: policies.filter(policy => policy.policyholderId === session.subjectId && policy.medicalRulesVersion === 1),
      claims: claims.filter(claim => claim.claimantId === session.subjectId && claim.episodeId),
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Medical intake unavailable" }, { status: 409 });
  }
}
