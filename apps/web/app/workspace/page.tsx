import Link from "next/link";
import { redirect } from "next/navigation";
import { findDemoAccount, workspaceForAccount } from "@/lib/auth/accounts";
import { currentSession } from "@/lib/auth/current-session";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceClient } from "@/components/workspace-client";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const session = await currentSession().catch(() => null);
  const account = session ? findDemoAccount(session.accountId) ?? null : null;
  if (account) redirect(`/workspace/${workspaceForAccount(account)}`);

  return (
    <main className="workspacePage">
      <header className="floatingNavWrapper">
        <nav className="shell nav">
          <Link className="brand" href="/">
            <span className="brandMark">BI</span>
            <span>Block-Insure</span>
          </Link>
          <div className="navLinks">
            <Link className="networkPill" href="/showcase"><span className="status-dot-pulse" aria-hidden="true" /> presentation board</Link>
            <ThemeToggle />
          </div>
        </nav>
      </header>
      <WorkspaceClient initialAccount={null} initialDashboard={null} />
    </main>
  );
}
