const capabilities = [
  ["Insurer", "Issue policies, govern packages, and authorize settlements"],
  ["Policyholder", "Submit claims and register tamper-evident evidence references"],
  ["Hospital", "Attest clinical verification through its own organization identity"],
  ["Auditor", "Record independent approval or rejection decisions"],
  ["Bank", "Confirm settlement references without exposing payment secrets"],
];

export default function Home() {
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
          <a className="primary" href="/workspace">Open role workspace</a>
          <a className="secondary" href="/api/fabric/health">Check ledger connection</a>
        </div>
      </section>

      <section className="shell network" id="network">
        <div className="sectionHeading">
          <div>
            <span className="kicker">One governed workflow</span>
            <h2>Five identities. Clear authority.</h2>
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
