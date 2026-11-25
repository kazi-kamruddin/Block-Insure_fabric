import { NextResponse } from "next/server";
import { currentSession, sessionSecret } from "@/lib/auth/current-session";
import { runRecoverableOperation } from "@/lib/workflows/operation-journal";
import { loadFabricConfig } from "@/lib/fabric/config";
import { isMedicalChannel } from "@/lib/fabric/medical-channel";
import { configuredLedgerProvisioningId } from "@/lib/fabric/ledger-instance";
import { canExecute, workflowCommandSchema } from "@/lib/workflows/commands";
import { executeWorkflowCommand } from "@/lib/workflows/execute";
import { checkMutationOrigin } from "@/lib/security/request-origin";
import { redactVoteTallies } from "@/lib/fabric/vote-visibility";

function publicWorkflowResult(result: unknown, viewer: Parameters<typeof redactVoteTallies>[1]) {
  if (!result || typeof result !== "object" || !("assetType" in result)) return result;
  if (result.assetType === "auditorDecision" && "id" in result && "reviewId" in result) {
    return { id: result.id, reviewId: result.reviewId };
  }
  if (result.assetType === "claimReview" && "status" in result && typeof result.status === "string") {
    return redactVoteTallies({ ...result, status: result.status }, viewer);
  }
  return result;
}

export const runtime = "nodejs";

export async function POST(request: Request) {
  const trust = checkMutationOrigin(request);
  if (!trust.trusted) return NextResponse.json({ message: trust.reason }, { status: 403 });

  const session = await currentSession().catch(() => null);
  if (!session) return NextResponse.json({ message: "Authentication required" }, { status: 401 });

  const parsed = workflowCommandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid workflow command", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (!canExecute(session.role, parsed.data.operation)) {
    return NextResponse.json({ message: "This account cannot execute that operation" }, { status: 403 });
  }

  try {
    if (session.role === "hospitalOfficer" && isMedicalChannel(loadFabricConfig().channelName) && parsed.data.operation !== "saveMedicalEpisode") {
      return NextResponse.json({ message: "Hospital accounts can only save factual episode intake." }, { status: 403 });
    }
    const requestId = request.headers.get("idempotency-key");
    if (requestId) {
      const config = loadFabricConfig();
      if (request.headers.get("x-workflow-deployment") !== `${config.channelName}/${config.chaincodeName}`) {
        return NextResponse.json({ message: "Saved action belongs to a different deployment" }, { status: 409 });
      }
      const ledgerId = configuredLedgerProvisioningId();
      if (ledgerId && request.headers.get("x-workflow-ledger-instance") !== ledgerId) {
        return NextResponse.json({ message: "Saved action belongs to a different ledger instance", state: "NOT_SUBMITTED" }, { status: 409 });
      }
      const outcome = await runRecoverableOperation({ requestId, command: parsed.data, session, secret: sessionSecret(), recoverOnly: request.headers.get("x-workflow-recovery") === "true" }, () => executeWorkflowCommand(parsed.data, session));
      return NextResponse.json({ ...outcome, result: publicWorkflowResult(outcome.result, session) }, { status: outcome.state === "COMMITTED" ? 200 : outcome.state === "PENDING" ? 202 : 409 });
    }
    const result = await executeWorkflowCommand(parsed.data, session);
    return NextResponse.json({ result: publicWorkflowResult(result, session) });
  } catch (error) {
    console.error("Workflow command failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Workflow command failed" },
      { status: 409 },
    );
  }
}
