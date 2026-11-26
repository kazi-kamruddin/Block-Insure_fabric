import { redirect } from "next/navigation";
import { SiteHeader } from "./site-header";
import { CustomerAccess } from "./customer-access";
import { onboardingEnabled } from "@/lib/customers/settings";

export function CustomerAccessPage({ mode }: { mode: "signup" | "login" }) {
  if (!onboardingEnabled()) redirect("/workspace");
  return (
    <>
      <SiteHeader activeRoute="/workspace" />
      <main id="main-content" tabIndex={-1} className="workspacePage">
        <CustomerAccess mode={mode} />
      </main>
    </>
  );
}
