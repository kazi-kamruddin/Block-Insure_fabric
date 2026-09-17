import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspaceClient } from "@/components/workspace-client";
import { findDemoAccount, workspaceForAccount } from "@/lib/auth/accounts";
import { currentSession } from "@/lib/auth/current-session";
import { loadRoleDashboard } from "@/lib/dashboard/load-dashboard";

export const dynamic = "force-dynamic";

type PageContext = { params: Promise<{ workspace: string }> };

export default async function RoleWorkspacePage({ params }: PageContext) {
  const session = await currentSession().catch(() => null);
  if (!session) redirect("/workspace");

  const account = findDemoAccount(session.accountId);
  if (!account) redirect("/workspace");

  const canonicalWorkspace = workspaceForAccount(account);
  if ((await params).workspace !== canonicalWorkspace) {
    redirect(`/workspace/${canonicalWorkspace}`);
  }

  const dashboard = await loadRoleDashboard(session).catch(() => null);
  const portalName = canonicalWorkspace === "hospital"
    ? account.displayName
    : canonicalWorkspace === "bank"
      ? "Bangladesh Demo Commercial Bank"
      : "Block-Insure";
  const portalMark = canonicalWorkspace === "hospital" ? "HC" : canonicalWorkspace === "bank" ? "DB" : "BI";
  return (
    <main className={`workspacePage workspacePage-${canonicalWorkspace}`}>
      <nav className="shell nav" aria-label={`${account.displayName} navigation`}>
        <Link className="brand" href="/">
          <span className="brandMark">{portalMark}</span>
          <span>{portalName}</span>
        </Link>
        <span className="networkPill"><i /> {canonicalWorkspace} workspace</span>
      </nav>
      <WorkspaceClient initialAccount={account} initialDashboard={dashboard} />
    </main>
  );
}
