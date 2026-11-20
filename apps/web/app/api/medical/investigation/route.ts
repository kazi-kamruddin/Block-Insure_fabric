import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { loadFabricConfig } from "@/lib/fabric/config";
import { ledger } from "@/lib/fabric/ledger";
import { researchFindings } from "@/lib/fabric/research-finding";
import { recordResearchFinding } from "@/lib/fabric/research-finding-store";
import { ledgerIdSchema } from "@/lib/fabric/validation";
import { checkMutationOrigin } from "@/lib/security/request-origin";
import { isMedicalChannel } from "@/lib/fabric/medical-channel";

export const runtime = "nodejs";
const input = z.strictObject({
  claimId: ledgerIdSchema,
  version: z.number().int().positive().safe(),
  outcome: z.enum(Object.keys(researchFindings) as (keyof typeof researchFindings)[]),
  basisHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return reply({ message: trust.reason }, 403);
  const config = loadFabricConfig();
  const root = process.env.MEDICAL_FINDINGS_ROOT?.trim();
  const investigator = process.env.MEDICAL_FINDINGS_INVESTIGATOR?.trim();
  if (!isMedicalChannel(config.channelName) || !root || !path.isAbsolute(root) || !investigator) {
    return reply({ message: "Medical investigation recording is unavailable" }, 404);
  }
  const session = await currentSession().catch(() => null);
  if (session?.role !== "insurerAdmin" || session.accountId !== investigator) {
    return reply({ message: "Authorized insurer investigator required" }, 403);
  }
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ message: "Provide the adjudicated claim version, outcome, and independent investigation reference" }, 400);
  try {
    const claim = await ledger.readClaim(parsed.data.claimId);
    if (!claim.episodeId || claim.version !== parsed.data.version || !["SETTLED", "REJECTED"].includes(claim.status)) {
      return reply({ message: "Load the current adjudicated medical claim version first" }, 409);
    }
    const result = await recordResearchFinding(root, {
      ...parsed.data, channel: config.channelName, chaincode: config.chaincodeName, investigator: session.accountId,
    });
    return result ? reply({ result }) : reply({ message: "A different investigation finding is already recorded for this claim version" }, 409);
  } catch {
    return reply({ message: "The investigation finding could not be confirmed" }, 503);
  }
}
