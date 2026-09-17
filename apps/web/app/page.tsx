import Link from "next/link";
import { ledger } from "@/lib/fabric/ledger";

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
  return (
    <main>
      <nav className="shell nav">
        <a className="brand" href="#top" aria-label="Block-Insure home">
          <span className="brandMark">BI</span>
          <span>Block-Insure</span>
        </a>
        <span className="networkPill"><i /> insurance-channel</span>
      </nav>

      <section className="shell hero" id="top">
        <div className="eyebrow">Hyperledger Fabric · Permissioned by design</div>
        <h1>Insurance coordination with proof built in.</h1>
        <p className="lede">
          A shared ledger for insurers, policyholders, hospitals, auditors, and banks—where
          every organization acts through an issued identity and every transition is verifiable.
        </p>
        <div className="actions">
          <Link className="primary" href="/workspace">Open role workspace</Link>
          <a className="secondary" href="/api/fabric/health">Check ledger connection</a>
        </div>
      </section>

      <section className="shell network" id="policies">
        <div className="sectionHeading">
          <div><span className="kicker">Public policy catalog</span><h2>Published coverage packages</h2></div>
          <p>These package versions are read from the live Fabric ledger. Purchase and policy management remain inside the policyholder workspace.</p>
        </div>
        <div className="capabilityGrid">
          {packages.length ? packages.map((item) => (
            <article className="capability" key={item.id}>
              <span className="index">v{item.version}</span>
              <h3>{item.name}</h3>
              <p>{item.description || "Published governed health coverage"}</p>
              <p><strong>{money(item.premiumMinor)}</strong> premium · {money(item.coverageLimitMinor)} limit</p>
              <p><strong>Hospitals:</strong> {(item.hospitalIds ?? []).map((id) => partnerName.get(id) ?? id).join(", ") || "Not configured"}</p>
              <p><strong>Banks:</strong> {(item.bankIds ?? []).map((id) => partnerName.get(id) ?? id).join(", ") || "Not configured"}</p>
            </article>
          )) : <article className="capability"><h3>Catalog unavailable</h3><p>Start or verify the Fabric network to load published packages.</p></article>}
        </div>
      </section>

      <section className="shell network" id="network">
        <div className="sectionHeading">
          <div>
            <span className="kicker">One governed workflow</span>
            <h2>Five organizations. Six operational roles.</h2>
          </div>
          <p>Private keys stay server-side. The ledger contract validates both MSP membership and certificate role attributes.</p>
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

      <footer className="shell footer">
        <span>Block-Insure Fabric</span>
        <span>Deterministic · Auditable · Organization-scoped</span>
      </footer>
    </main>
  );
}
