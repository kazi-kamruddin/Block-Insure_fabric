import { workspaceAccountForSession, workspaceForAccount } from "@/lib/auth/accounts";
import { currentSession } from "@/lib/auth/current-session";

/** The signed-in visitor's workspace address, for public page headers. */
export async function signedInWorkspaceHref() {
  const session = await currentSession().catch(() => null);
  const account = session ? workspaceAccountForSession(session) : undefined;
  return account ? `/workspace/${workspaceForAccount(account)}` : undefined;
}
