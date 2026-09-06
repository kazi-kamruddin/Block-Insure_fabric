import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { canExecute, workflowCommandSchema } from "@/lib/workflows/commands";
import { executeWorkflowCommand } from "@/lib/workflows/execute";
import { checkMutationOrigin } from "@/lib/security/request-origin";

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
    const result = await executeWorkflowCommand(parsed.data, session);
    return NextResponse.json({ result });
  } catch (error) {
    console.error("Workflow command failed", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Workflow command failed" },
      { status: 409 },
    );
  }
}
