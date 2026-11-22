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
  { index: "A", title: "Premium integrity", flow: "Policyholder → Bank → Insurer", detail: "A one-time code or a scheduled EFT debit creates one linked transfer and payment. Simulated funds move customer-to-insurer or bounce without changing coverage dates." },
  { index: "B", title: "Claim integrity", flow: "Hospital → Policyholder → Insurer → Oracles", detail: "A claim binds to a finalized contracted-Hospital invoice. The insurer starts processing, and Oracle workers compare invoice facts before a version-bound 2-of-3 result." },
  { index: "C", title: "Governed fallback", flow: "Oracles → Auditors → Insurer → Bank", detail: "Negative, conflicting, or timed-out Oracle work enters fixed quorum review. Approval creates a liability; Bank confirmation closes it." },
] as const;


export default function ShowcasePage() {
  return (
    <>
      <SiteHeader activeRoute="/showcase" />
      <main id="main-content" tabIndex={-1} className="showcasePage">
        <section className="shell showcaseHero">
          <span className="eyebrow">How it works</span>
          <h1>One insurance journey. Five institutional boundaries.</h1>
          <p className="lede">Block-Insure is the coordination layer. Hospitals keep invoices, the Bank simulates transfers, assigned Auditors cast separate votes, and Fabric preserves the shared proof.</p>
          <div className="actions">
            <Link className="primary" href="/signup">Get covered</Link>
            <Link className="secondary" href="/#policies">View packages</Link>
          </div>
        </section>

        <section className="shell showcaseSection">
          <div className="sectionHeading">
            <div><h2>Authority stays with the organization that owns it.</h2></div>
            <p>Each organisation has its own portal, and every change is checked against the identity that organisation issued.</p>
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
            <div><h2>Three journeys, each with a verifiable record.</h2></div>
            <p>Every journey ends with a ledger record that the organisations involved can check independently.</p>
          </div>
          <div className="storyGrid">
            {stories.map((story) => <article key={story.index}>
              <span className="storyIndex">{story.index}</span><small>{story.flow}</small><h3>{story.title}</h3><p>{story.detail}</p>
            </article>)}
          </div>
        </section>

      </main>
      <footer className="shell footer"><span>Block-Insure</span><span><Link href="/">Home</Link> · <Link href="/workspace">Sign in</Link></span></footer>
    </>
  );
}
