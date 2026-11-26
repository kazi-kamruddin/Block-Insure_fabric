import { notFound } from "next/navigation";
import { workspaceAccountForSession } from "@/lib/auth/accounts";
import { currentSession } from "@/lib/auth/current-session";
import { onboardingEnabled } from "@/lib/customers/settings";
import { loadFabricConfig } from "@/lib/fabric/config";
import { isMedicalChannel } from "@/lib/fabric/medical-channel";
import { findSection, overviewSection } from "@/lib/workspace/sections";

export const dynamic = "force-dynamic";

// A workspace sub-page. The layout draws its content; this only rejects
// sub-pages that do not exist for the signed-in role.
export default async function WorkspaceSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const session = await currentSession().catch(() => null);
  const account = session ? workspaceAccountForSession(session) : undefined;
  const options = { medical: isMedicalChannel(loadFabricConfig().channelName), onboarding: onboardingEnabled() };
  if (!account || section === overviewSection || !findSection(account.role, section, options)) notFound();
  return null;
}
