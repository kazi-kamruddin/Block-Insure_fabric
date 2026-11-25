import { redirect } from "next/navigation";
import { workspaceAccountForSession, workspaceForAccount } from "@/lib/auth/accounts";
import { currentSession } from "@/lib/auth/current-session";
import { SiteHeader } from "@/components/site-header";
import { WorkspaceClient } from "@/components/workspace-client";
import { loadFabricConfig } from "@/lib/fabric/config";
import { onboardingEnabled } from "@/lib/customers/settings";
import { medicalSourcePublisherEnabled } from "@/lib/oracle/publish-medical-sources";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const config = loadFabricConfig();
  const session = await currentSession().catch(() => null);
  const account = session ? workspaceAccountForSession(session) : undefined;
  if (account) redirect(`/workspace/${workspaceForAccount(account)}`);

  return (
    <>
      <SiteHeader activeRoute="/workspace" />
      <main id="main-content" tabIndex={-1} className="workspacePage">
        <WorkspaceClient initialAccount={null} initialDashboard={null} deployment={`${config.channelName}/${config.chaincodeName}`}
          onboardingEnabled={onboardingEnabled()} demoAuthEnabled={process.env.ENABLE_DEMO_AUTH === "true"}
          showLegacyPolicyholderLogin={process.env.SHOW_LEGACY_POLICYHOLDER_LOGIN === "true"}
          showR2AuditorLogin={medicalSourcePublisherEnabled()} />
      </main>
      <footer className="shell footer">
        <span>Block-Insure</span>
        <span>Secure sign-in for customers and partner staff</span>
      </footer>
    </>
  );
}
