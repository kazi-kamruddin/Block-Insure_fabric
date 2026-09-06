import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { readEventProjection } from "@/lib/events/store";

export const runtime = "nodejs";

const querySchema = z.object({
  eventName: z.string().trim().max(100).optional(),
  assetId: z.string().trim().max(128).optional(),
  afterBlock: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: Request) {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  if (session.role !== "insurerAdmin" && session.role !== "auditor") return NextResponse.json({ message: "Operational event access is limited to insurer and auditor roles" }, { status: 403 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ message: "Invalid event query" }, { status: 400 });
  const projection = await readEventProjection();
  const afterBlock = BigInt(parsed.data.afterBlock ?? "0");
  const matchesAsset = (payload: Record<string, unknown>, expected: string) => ["id", "claimId", "policyId", "evidenceId", "reviewId", "appealId"].some((key) => payload[key] === expected);
  const events = projection.events
    .filter((event) => BigInt(event.blockNumber) > afterBlock)
    .filter((event) => !parsed.data.eventName || event.eventName === parsed.data.eventName)
    .filter((event) => !parsed.data.assetId || matchesAsset(event.payload, parsed.data.assetId))
    .slice(-parsed.data.limit)
    .reverse();
  return NextResponse.json({ checkpoint: projection.checkpoint, countsByName: projection.countsByName, events });
}
