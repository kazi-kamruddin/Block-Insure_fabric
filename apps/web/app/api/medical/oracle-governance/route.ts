import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth/current-session";
import { findDemoAccount } from "@/lib/auth/accounts";
import { ledger } from "@/lib/fabric/ledger";
import { oracleGovernanceActions, type GovernanceAction, type GovernanceRecord, type GovernanceRole } from "@/lib/fabric/oracle-governance";
import { checkMutationOrigin } from "@/lib/security/request-origin";

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const roles = ["insurerAdmin", "auditor", "hospitalOfficer"];
const schema = z.strictObject({ action: z.string().max(80), args: z.array(z.string().trim().max(4096)).max(10) });

export async function GET() {
  const session = await currentSession().catch(() => null);
  if (!session || !roles.includes(session.role)) return reply({ message: "Source governance access required" }, 403);
  try {
    if (!await ledger.supportsMedicalOracleV2()) return reply({ supported: false });
    const [issuers, feeds, rosters, releases] = await Promise.all([
      ledger.readOracleGovernance<GovernanceRecord[]>("ListSourceIssuers"), ledger.readOracleGovernance<GovernanceRecord[]>("ListSourceFeeds"),
      ledger.readOracleGovernance<GovernanceRecord[]>("ListOracleRosters"), ledger.readOracleGovernance<GovernanceRecord[]>("ListMedicalModelReleases"),
    ]);
    if (session.role === "hospitalOfficer") {
      const owned = issuers.filter(issuer => issuer.kind === "HOSPITAL_HIS" && issuer.hospitalId === session.subjectId);
      return reply({ supported: true, issuers: owned, feeds: feeds.filter(feed => owned.some(issuer => issuer.issuerId === feed.issuerId)), rosters: [], releases: [] });
    }
    return reply({ supported: true, issuers, feeds, rosters, releases });
  } catch {
    return reply({ message: "Could not read source governance" }, 409);
  }
}

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return reply({ message: trust.reason }, 403);
  const session = await currentSession().catch(() => null);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success || !Object.hasOwn(oracleGovernanceActions, input.data.action)) return reply({ message: "Check the governance action" }, 400);
  const action = input.data.action as GovernanceAction;
  const definition = oracleGovernanceActions[action];
  if (!session || !(definition.roles as GovernanceRole[]).includes(session.role as GovernanceRole)) return reply({ message: "This role cannot perform the action" }, 403);
  const args = [...input.data.args];
  if (args.length !== definition.fields.length || definition.fields.some((field, index) =>
    (!("optional" in field && field.optional) && !args[index]) || ("type" in field && field.type === "number" && !/^[1-9][0-9]{0,8}$/.test(args[index])))) {
    return reply({ message: "Check the governance fields" }, 400);
  }
  try {
    if (!await ledger.supportsMedicalOracleV2()) return reply({ message: "Oracle v2 governance is unavailable" }, 404);
    if (session.role === "hospitalOfficer") {
      const issuer = await ledger.readSourceIssuer(args[0], args[1]);
      if (issuer.hospitalId !== session.subjectId || issuer.kind !== "HOSPITAL_HIS") return reply({ message: "Select your hospital's issuer" }, 403);
    }
    if (action === "ApproveMedicalModelRelease") args.push("");
    await ledger.writeOracleGovernance(session.role as GovernanceRole, action, args, findDemoAccount(session.accountId)?.fabricUserName);
    return reply({ confirmed: true });
  } catch {
    return reply({ message: "The governance action was not confirmed. Refresh the ledger status and check the action requirements." }, 409);
  }
}
