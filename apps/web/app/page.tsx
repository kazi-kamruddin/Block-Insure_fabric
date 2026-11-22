import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { StatusBadge } from "@/components/status-badge";
import { ledger } from "@/lib/fabric/ledger";

export const dynamic = "force-dynamic";

const capabilities = [
  ["Insurer", "Issue policies, govern packages, and authorize settlements"],
  ["Policyholder", "Submit claims and register tamper-evident evidence references"],
  ["Hospital", "Maintain an independent invoice register under a contracted provider agreement"],
  ["Oracle", "Reach two-certificate commit/reveal consensus over versioned registry facts"],
  ["Auditor", "Record independent approval or rejection decisions"],
  ["Bank", "Operate connected mandates and payment confirmations through a distinct partner portal"],
];

function money(minor: number) {
  return new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT" }).format(minor / 100);
}

export default async function Home() {
  const [packages, agreements] = await Promise.all([
    ledger.listPolicyPackages().then((items) => items.filter((item) => item.status === "PUBLISHED")).catch(() => []),
    ledger.listPartnerAgreements().then((items) => items.filter((item) => item.status === "ACTIVE")).catch(() => []),
  ]);
  const partnerName = new Map(agreements.map((item) => [item.partnerId, item.name]));
  const showcasePackage = packages.find((item) => item.id === "showcase-health-v1");
  const featuredPackages = showcasePackage ? [showcasePackage] : packages.slice(0, 5);
  const remainingPackages = packages.filter((item) => !featuredPackages.some((featured) => featured.id === item.id));
  const packageCard = (item: (typeof packages)[number]) => (
    <article className="capability" key={item.id}>
      <StatusBadge status={item.status} label={`v${item.version} · Published`} />
      <h3>{item.name}</h3>
      <p>{item.description || "Published governed health coverage"}</p>
      <p><strong>{money(item.premiumMinor)}</strong> premium · {money(item.coverageLimitMinor)} limit</p>
      <p><strong>Hospitals:</strong> {(item.hospitalIds ?? []).map((id) => partnerName.get(id) ?? id).join(", ") || "Not configured"}</p>
      <p><strong>Banks:</strong> {(item.bankIds ?? []).map((id) => partnerName.get(id) ?? id).join(", ") || "Not configured"}</p>
    </article>
  );
  return (
    <>
      <SiteHeader activeRoute="/" brandHref="#top" />
      <main id="main-content" tabIndex={-1}>
        <section className="shell hero" id="top">
          <div className="eyebrow">Hyperledger Fabric · Permissioned by design</div>
          <h1>Insurance coordination with proof built in.</h1>
          <p className="lede">
            Health insurance shared between insurers, policyholders, hospitals, auditors and banks.
            Every organisation works from its own portal, and every decision is recorded and verifiable.
          </p>
          <div className="actions">
            <Link className="primary" href="/signup">Get covered</Link>
            <Link className="secondary" href="/workspace">Sign in</Link>
            <Link className="secondary" href="/showcase">How it works</Link>
          </div>
        </section>

        <section className="shell network" id="policies">
          <div className="sectionHeading">
            <div><h2>Published coverage packages</h2></div>
            <p>Current packages from our partner network. Create an account to buy cover and manage it online.</p>
          </div>
          <div className="capabilityGrid featuredCatalog">
            {featuredPackages.length ? featuredPackages.map(packageCard) : <article className="capability"><h3>Catalog unavailable</h3><p>Packages are temporarily unavailable. Please try again shortly.</p></article>}
          </div>
          {remainingPackages.length > 0 && (
            <details className="catalogMore">
              <summary>Browse {remainingPackages.length} more published package versions</summary>
              <div className="capabilityGrid">{remainingPackages.map(packageCard)}</div>
            </details>
          )}
        </section>

        <section className="shell network" id="network">
          <div className="sectionHeading">
            <div>
              <h2>Five organizations. Six operational roles.</h2>
            </div>
            <p>Each organisation acts only through its own issued identity, and the shared ledger checks every action against it.</p>
          </div>
          <div className="capabilityGrid">
            {capabilities.map(([role, description], index) => (
              <article className="capability" key={role}>
                <span className="index">0{index + 1}</span>
                <h3>{role}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="shell footer">
        <span>Block-Insure</span>
        <span><Link href="/showcase">How it works</Link> · <Link href="/signin">Customer sign-in</Link> · <Link href="/workspace">Staff sign-in</Link></span>
      </footer>
    </>
  );
}
