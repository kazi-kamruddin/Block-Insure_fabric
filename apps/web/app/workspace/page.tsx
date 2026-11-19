import { redirect } from "next/navigation";
import { findDemoAccount, workspaceForAccount } from "@/lib/auth/accounts";
import { currentSession } from "@/lib/auth/current-session";
import { SiteHeader } from "@/components/site-header";
import { WorkspaceClient } from "@/components/workspace-client";
import { loadFabricConfig } from "@/lib/fabric/config";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const config = loadFabricConfig();
  const session = await currentSession().catch(() => null);
  const account = session ? findDemoAccount(session.accountId) ?? null : null;
  if (account) redirect(`/workspace/${workspaceForAccount(account)}`);

  return (
    <>
      <SiteHeader activeRoute="/workspace" pillText="presentation board" pillHref="/showcase" />
      <main id="main-content" tabIndex={-1} className="workspacePage">
        <WorkspaceClient initialAccount={null} initialDashboard={null} deployment={`${config.channelName}/${config.chaincodeName}`} />
      </main>
      <footer className="shell footer">
        <span>Block-Insure Fabric</span>
        <span>Server-side Gateway · Identity-scoped sessions</span>
      </footer>
    </>
  );
}
