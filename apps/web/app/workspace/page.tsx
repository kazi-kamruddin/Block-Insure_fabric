import Link from "next/link";
import { findDemoAccount } from "@/lib/auth/accounts";
import { currentSession } from "@/lib/auth/current-session";
import { WorkspaceClient } from "@/components/workspace-client";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const session = await currentSession().catch(() => null);
  const account = session ? findDemoAccount(session.accountId) ?? null : null;

  return (
    <main className="workspacePage">
      <nav className="shell nav">
        <Link className="brand" href="/">
          <span className="brandMark">BI</span>
          <span>Block-Insure</span>
        </Link>
        <span className="networkPill"><i /> role workspace</span>
      </nav>
      <WorkspaceClient initialAccount={account} />
    </main>
  );
}
