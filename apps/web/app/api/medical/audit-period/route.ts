import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { findDemoAccount } from "@/lib/auth/accounts";
import { ledger } from "@/lib/fabric/ledger";
import { ledgerIdSchema as id } from "@/lib/fabric/validation";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const command = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), id, start: timestamp, end: timestamp,
    rateBps: z.number().int().min(1).max(10_000), graceSeconds: z.number().int().min(60).max(604_800) }),
  z.strictObject({ action: z.literal("commit"), id, value: hash }),
  z.strictObject({ action: z.literal("reveal"), id, value: hash }),
  z.strictObject({ action: z.literal("open"), id }),
  z.strictObject({ action: z.literal("finalize"), id }),
  z.strictObject({ action: z.literal("resolve"), id }),
]);
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  const session = await currentSession().catch(() => null);
  if (!session || !["insurerAdmin", "auditor", "hospitalOfficer"].includes(session.role)) return reply({ message: "Audit governance role required." }, 403);
  if (!await ledger.supportsMedicalR2()) return reply({ message: "Audit governance is unavailable on this deployment." }, 404);
  const input = id.safeParse(new URL(request.url).searchParams.get("id"));
  if (!input.success) return reply({ message: "Enter a valid audit period ID." }, 400);
  try {
    const period = await ledger.readMedicalAuditPeriod(input.data);
    return reply({ period: { ...period, shares: period.shares?.map(share => ({ msp: share.msp, revealed: !!share.share })) } });
  } catch {
    return reply({ message: "The audit period could not be read." }, 409);
  }
}

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return reply({ message: trust.reason }, 403);
  const session = await currentSession().catch(() => null);
  const input = command.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ message: "Check the audit period fields." }, 400);
  if (!session) return reply({ message: "Sign in to manage this audit action." }, 403);
  if (!await ledger.supportsMedicalR2()) return reply({ message: "Audit governance is unavailable on this deployment." }, 404);
  const role = session.role;
  const data = input.data;
  try {
    if (data.action === "resolve") {
      if (role !== "insurerAdmin" && role !== "policyholder") return reply({ message: "Claimant or insurer required." }, 403);
      if (role === "policyholder" && (await ledger.readClaim(data.id)).claimantId !== session.subjectId) return reply({ message: "Claim access required." }, 403);
      await ledger.resolveMedicalAuditSelection(role, data.id);
      return reply({ status: "Confirmed" });
    }
    if (role !== "insurerAdmin" && role !== "auditor" && role !== "hospitalOfficer") return reply({ message: "Audit governance role required." }, 403);
    if (data.action === "create" && role !== "insurerAdmin") return reply({ message: "Only the insurer may propose a period." }, 403);
    const user = findDemoAccount(session.accountId)?.fabricUserName;
    const transaction = {
      create: "CreateMedicalAuditPeriod", commit: "CommitMedicalAuditSeedShare", reveal: "RevealMedicalAuditSeedShare",
      open: "OpenMedicalAuditPeriod", finalize: "FinalizeMedicalAuditPeriod",
    }[data.action];
    const args = data.action === "create" ? [data.id, data.start, data.end, data.rateBps, data.graceSeconds]
      : "value" in data ? [data.id, data.value] : [data.id];
    await ledger.medicalAuditAction(role, user, transaction, args);
    return reply({ status: "Confirmed" });
  } catch {
    return reply({ message: "The ledger did not confirm this action. Read the current period before retrying." }, 409);
  }
}
