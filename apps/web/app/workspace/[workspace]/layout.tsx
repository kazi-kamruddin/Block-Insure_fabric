import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { WorkspaceClient } from "@/components/workspace-client";
import { workspaceAccountForSession, workspaceForAccount } from "@/lib/auth/accounts";
import { currentSession } from "@/lib/auth/current-session";
import { loadRoleDashboard } from "@/lib/dashboard/load-dashboard";
import { loadFabricConfig } from "@/lib/fabric/config";
import { onboardingEnabled } from "@/lib/customers/settings";
import { CustomerStore } from "@/lib/customers/store";

export const dynamic = "force-dynamic";

// The workspace shell stays mounted while the user moves between its
// sub-pages, so a prepared transaction survives switching pages.
export default async function RoleWorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspace: string }> }) {
  const config = loadFabricConfig();
  const session = await currentSession().catch(() => null);
  if (!session) redirect("/workspace");

  const account = workspaceAccountForSession(session);
  if (!account) redirect("/workspace");

  const canonicalWorkspace = workspaceForAccount(account);
  if ((await params).workspace !== canonicalWorkspace) {
    redirect(`/workspace/${canonicalWorkspace}`);
  }

  // A registered customer is shown by their verified name, not a generic label.
  const customerName = account.role === "policyholder" && account.subjectId && account.id === `customer:${account.subjectId}`
    ? await new CustomerStore().find(account.subjectId).then((record) => record?.fullName?.trim(), () => undefined)
    : undefined;
  const shownAccount = customerName ? { ...account, displayName: customerName } : account;

  const dashboard = await loadRoleDashboard(session).catch(() => null);
  const portalName = canonicalWorkspace === "hospital"
    ? account.displayName
    : canonicalWorkspace === "bank"
      ? "Bangladesh Demo Commercial Bank"
      : "Block-Insure";
  const portalMark = canonicalWorkspace === "hospital" ? "HC" : canonicalWorkspace === "bank" ? "DB" : "BI";
  const portalVariant = canonicalWorkspace === "hospital" || canonicalWorkspace === "bank" ? canonicalWorkspace : undefined;

  return (
    <>
      <SiteHeader
        activeRoute="/workspace"
        navLabel={`${portalName} navigation`}
        brandName={portalName}
        brandMark={portalMark}
        brandHref={`/workspace/${canonicalWorkspace}`}
        portalVariant={portalVariant}
        signedIn
      />
      <main id="main-content" tabIndex={-1} className={`workspacePage workspacePage-${canonicalWorkspace}`}>
        <WorkspaceClient initialAccount={shownAccount} initialDashboard={dashboard} deployment={`${config.channelName}/${config.chaincodeName}`}
          workspace={canonicalWorkspace}
          onboardingEnabled={onboardingEnabled()}
          medicalReviewEnabled={process.env.FABRIC_MEDICAL_REVIEW_ENABLED === "true"}
          investigationEnabled={Boolean(process.env.MEDICAL_FINDINGS_ROOT?.trim()) && account.role === "insurerAdmin" &&
            process.env.MEDICAL_FINDINGS_INVESTIGATOR?.trim() === account.id}>
          {children}
        </WorkspaceClient>
      </main>
    </>
  );
}
