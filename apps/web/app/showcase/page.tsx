import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

const organizations = [
  ["InsurerMSP", "Coordinates policies, verification, and liabilities", "Cannot edit Hospital records or confirm Bank execution"],
  ["HospitalMSP", "Owns the independent patient invoice register", "Cannot approve or settle insurance claims"],
  ["BankMSP", "Owns balances, mandates, transfers, and bounce decisions", "Cannot approve claims or change policy terms"],
  ["AuditorMSP", "Casts assigned certificate-bound review votes", "One vote cannot finalize a governed review"],
  ["OracleMSP", "Runs three certificate-bound commit/reveal workers", "Cannot settle a claim or expose unrevealed results"],
] as const;

const boundaryMatrix = [
  ["InsurerMSP", "Publish packages, issue policies, open claims, create settlement liabilities", "Private hospital register mutation, bank transfer execution, unrevealed Oracle inputs", "bankInsurerPrivateData, oracleProofPrivateData"],
  ["HospitalMSP", "Register & finalize contracted invoices, record medical episode intake", "Approve claims, move bank funds, modify coverage packages", "oracleProofPrivateData"],
  ["BankMSP", "Hold simulated accounts, process OTP/EFT mandates, mark settled or bounced transfers", "Approve insurance claims, alter benefit schedules, read medical files", "bankInsurerPrivateData"],
  ["AuditorMSP", "Inspect granted dossiers, request clarifications, cast quorum review votes", "Self-finalize single votes, trigger bank settlement, edit medical invoices", "Explicit evidence access grants only"],
  ["OracleMSP", "Commit/reveal 2-of-3 invoice verification certificates against hospital records", "Unilateral claim approval, exposure of uncommitted Oracle hashes", "oracleProofPrivateData"],
] as const;

const stories = [
  { index: "A", title: "Premium integrity", flow: "Policyholder → Bank → Insurer", detail: "Demo OTP or scheduled EFT creates one linked transfer and payment. Simulated funds move customer-to-insurer or bounce without changing coverage dates." },
  { index: "B", title: "Claim integrity", flow: "Hospital → Policyholder → Insurer → Oracles", detail: "A claim binds to a finalized contracted-Hospital invoice. The insurer starts processing, and Oracle workers compare invoice facts before a version-bound 2-of-3 result." },
  { index: "C", title: "Governed fallback", flow: "Oracles → Auditors → Insurer → Bank", detail: "Negative, conflicting, or timed-out Oracle work enters fixed quorum review. Approval creates a liability; Bank confirmation closes it." },
] as const;

const rehearsalSpine = [
  ["Part 1 · Clean intake & private OCR", "Hospital extracts and confirms invoice fields (advisory OCR), submits episode intake, and anchors the private hospital record without auto-approving any claim."],
  ["Part 2 · Encrypted evidence & OTP premium", "Policyholder associates an episode, calculates deductible/share reimbursement, anchors client-side AES-256-GCM ciphertext, and authorizes demo OTP payment."],
  ["Part 3 · Oracle commit/reveal & governed review", "Insurer starts verification (advisory model signal shown strictly apart from decision authority); divergence or fallback opens 4-auditor clarification and quorum voting."],
  ["Part 4 · Liability & Bank finality", "Approved liabilities move to Bank settlement confirmation while Auditor exports the tamper-evident claim dossier, Merkle proof, and reproducible thesis snapshot."],
] as const;

export default function ShowcasePage() {
  return (
    <>
      <SiteHeader activeRoute="/showcase" pillText="presentation board" />
      <main id="main-content" tabIndex={-1} className="showcasePage">
        <section className="shell showcaseHero">
          <span className="eyebrow">Supervisor demonstration · Candidate architecture</span>
          <h1>One insurance journey. Five institutional boundaries.</h1>
          <p className="lede">Block-Insure is the coordination layer. Hospitals keep invoices, the Bank simulates transfers, assigned Auditors cast separate votes, and Fabric preserves the shared proof.</p>
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
          <div className="boundaryTableWrap" role="region" aria-labelledby="boundary-table-caption" tabIndex={0}>
            <table className="boundaryTable">
              <caption id="boundary-table-caption">Organizational capability, prohibition, and Private Data Collection (PDC) scope</caption>
              <thead>
                <tr>
                  <th scope="col">MSP identity</th>
                  <th scope="col">Authorized mutations</th>
                  <th scope="col">Enforced exclusions</th>
                  <th scope="col">Private collection scope</th>
                </tr>
              </thead>
              <tbody>
                {boundaryMatrix.map(([msp, authorized, excluded, pdc]) => (
                  <tr key={msp}>
                    <th scope="row"><code>{msp}</code></th>
                    <td>{authorized}</td>
                    <td>{excluded}</td>
                    <td>{pdc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          <div className="capabilityGrid" style={{ marginTop: 24 }}>
            {rehearsalSpine.map(([step, summary], index) => (
              <article className="capability" key={step}>
                <span className="index">Step 0{index + 1}</span>
                <h3>{step}</h3>
                <p>{summary}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="shell presenterChecklist">
          <div><span className="kicker">Close the demonstration</span><h2>Show the proof, not only the happy path.</h2></div>
          <ol>
            <li><span><strong>Identity:</strong> point out the portal, MSP, role, and organization-specific visual language.</span></li>
            <li><span><strong>Boundary:</strong> explain one action this organization is intentionally unable to perform.</span></li>
            <li><span><strong>Failure:</strong> show insufficient-funds bounce or Oracle fallback without hidden manual overrides.</span></li>
            <li><span><strong>Audit:</strong> finish with the linked ledger asset, policy statement, claim dossier, or reproducibility snapshot.</span></li>
          </ol>
        </section>
      </main>
      <footer className="shell footer"><span>Block-Insure Fabric</span><span>Identity · Boundary · Failure · Proof</span></footer>
    </>
  );
}
