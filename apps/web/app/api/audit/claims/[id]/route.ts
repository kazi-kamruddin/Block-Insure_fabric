import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { loadClaimAuditDossier } from "@/lib/audit/load-claim-dossier";

const idSchema = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._:-]+$/);
type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  if (session.role !== "insurerAdmin" && session.role !== "auditor") {
    return NextResponse.json({ message: "Only insurer and auditor accounts can export claim dossiers" }, { status: 403 });
  }

  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ message: "Invalid claim ID" }, { status: 400 });

  try {
    const dossier = await loadClaimAuditDossier(id.data);
    return NextResponse.json(dossier, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${id.data}-audit.json"`,
      },
    });
  } catch (error) {
    console.error("Claim audit export failed", error);
    return NextResponse.json({ message: "Claim audit dossier was not found" }, { status: 404 });
  }
}
