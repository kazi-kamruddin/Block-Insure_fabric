import Link from "next/link";

const organizations = [
  ["InsurerMSP", "Coordinates policies, verification, and liabilities", "Cannot edit Hospital records or confirm Bank execution"],
  ["HospitalMSP", "Owns the independent patient invoice register", "Cannot approve or settle insurance claims"],
  ["BankMSP", "Owns balances, mandates, transfers, and bounce decisions", "Cannot approve claims or change policy terms"],
  ["AuditorMSP", "Casts assigned certificate-bound review votes", "One vote cannot finalize a governed review"],
  ["OracleMSP", "Runs two subject-isolated commit/reveal workers", "Cannot settle a claim or expose unrevealed results"],
] as const;

const stories = [
  { index: "A", title: "Premium integrity", flow: "Policyholder → Bank → Insurer", detail: "Manual email OTP or scheduled EFT creates one linked transfer and payment. Funds settle customer-to-insurer or bounce without changing coverage dates." },
  { index: "B", title: "Claim integrity", flow: "Hospital → Policyholder → Insurer → Oracles", detail: "A claim binds to a finalized contracted-Hospital invoice, passes a read-only cross-check, then receives a version-bound two-Oracle result." },
  { index: "C", title: "Governed fallback", flow: "Oracles → Auditors → Insurer → Bank", detail: "Negative, conflicting, or timed-out Oracle work enters fixed quorum review. Approval creates a liability; Bank confirmation closes it." },
] as const;

export default function ShowcasePage() {
  return (
    <main className="showcasePage">
      <nav className="shell nav">
        <Link className="brand" href="/"><span className="brandMark">BI</span><span>Block-Insure</span></Link>
        <span className="networkPill"><i /> presentation board</span>
      </nav>

      <section className="shell showcaseHero">
        <span className="eyebrow">Supervisor demonstration · Phase 3</span>
        <h1>One insurance journey. Five institutional boundaries.</h1>
        <p className="lede">Block-Insure is the coordination layer. Hospitals keep invoices, Banks execute funds, Auditors vote independently, and Fabric preserves the shared proof.</p>
        <div className="actions">
          <Link className="primary" href="/workspace">Start role demonstration</Link>
          <Link className="secondary" href="/#policies">View live policy network</Link>
        </div>
      </section>

      <section className="shell showcaseSection">
        <div className="sectionHeading">
          <div><span className="kicker">Institutional model</span><h2>Authority stays with the organization that owns it.</h2></div>
          <p>The portals share one demonstration application, but every mutation is still checked against its organization-issued Fabric identity.</p>
        </div>
        <div className="organizationBoard">
          {organizations.map(([name, purpose, boundary], index) => (
            <article key={name}><span>0{index + 1}</span><h3>{name}</h3><p>{purpose}</p><small>{boundary}</small></article>
          ))}
        </div>
      </section>

      <section className="shell showcaseSection">
        <div className="sectionHeading">
          <div><span className="kicker">Three proof stories</span><h2>Demonstrate outcomes, then reveal the ledger evidence.</h2></div>
          <p>Use these stories as the presentation spine. Each ends with a durable asset, role boundary, and visible handoff.</p>
        </div>
        <div className="storyGrid">
          {stories.map((story) => <article key={story.index}>
            <span className="storyIndex">{story.index}</span><small>{story.flow}</small><h3>{story.title}</h3><p>{story.detail}</p>
          </article>)}
        </div>
      </section>

      <section className="shell presenterChecklist">
        <div><span className="kicker">Close the demonstration</span><h2>Show the proof, not only the happy path.</h2></div>
        <ol>
          <li><strong>Identity:</strong> point out the portal, MSP, role, and organization-specific visual language.</li>
          <li><strong>Boundary:</strong> explain one action this organization is intentionally unable to perform.</li>
          <li><strong>Failure:</strong> show insufficient-funds bounce or Oracle fallback without hidden manual overrides.</li>
          <li><strong>Audit:</strong> finish with the linked ledger asset, policy statement, claim dossier, or reproducibility snapshot.</li>
        </ol>
      </section>
    </main>
  );
}
