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
  return (
    <main className="workspacePage">
      <nav className="shell nav" aria-label={`${account.displayName} navigation`}>
        <Link className="brand" href="/">
          <span className="brandMark">BI</span>
          <span>Block-Insure</span>
        </Link>
        <span className="networkPill"><i /> {canonicalWorkspace} workspace</span>
      </nav>
      <WorkspaceClient initialAccount={account} initialDashboard={dashboard} />
    </main>
  );
}
