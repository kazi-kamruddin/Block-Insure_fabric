import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { WorkspaceClient } from "@/components/workspace-client";
import { workspaceAccountForSession, workspaceForAccount } from "@/lib/auth/accounts";
import { currentSession } from "@/lib/auth/current-session";
import { loadRoleDashboard } from "@/lib/dashboard/load-dashboard";
import { loadFabricConfig } from "@/lib/fabric/config";
import { onboardingEnabled } from "@/lib/customers/settings";

export const dynamic = "force-dynamic";

type PageContext = { params: Promise<{ workspace: string }> };

export default async function RoleWorkspacePage({ params }: PageContext) {
  const config = loadFabricConfig();
  const session = await currentSession().catch(() => null);
  if (!session) redirect("/workspace");

  const account = workspaceAccountForSession(session);
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
  const showResearch = account.role === "insurerAdmin" || account.role === "auditor";
  const portalVariant = canonicalWorkspace === "hospital" || canonicalWorkspace === "bank" ? canonicalWorkspace : undefined;

  return (
    <>
      <SiteHeader
        activeRoute="/workspace"
        navLabel={`${account.displayName} navigation`}
        brandName={portalName}
        brandMark={portalMark}
        pillText={`${canonicalWorkspace} · presentation`}
        pillHref="/showcase"
        showResearch={showResearch}
        portalVariant={portalVariant}
      />
      <main id="main-content" tabIndex={-1} className={`workspacePage workspacePage-${canonicalWorkspace}`}>
        <WorkspaceClient initialAccount={account} initialDashboard={dashboard} deployment={`${config.channelName}/${config.chaincodeName}`}
          onboardingEnabled={onboardingEnabled()}
          medicalReviewEnabled={process.env.FABRIC_MEDICAL_REVIEW_ENABLED === "true"}
          investigationEnabled={Boolean(process.env.MEDICAL_FINDINGS_ROOT?.trim()) && account.role === "insurerAdmin" &&
            process.env.MEDICAL_FINDINGS_INVESTIGATOR?.trim() === account.id} />
      </main>
      <footer className="shell footer">
        <span>{portalName} · {account.organization}</span>
        <span>{config.channelName}/{config.chaincodeName}</span>
      </footer>
    </>
  );
}
