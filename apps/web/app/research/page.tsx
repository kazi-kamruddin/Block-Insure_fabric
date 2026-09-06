import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/current-session";
import { loadResearchSnapshot } from "@/lib/research/load-snapshot";

const formatMinor = (value: number) => new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT" }).format(value / 100);
const formatDuration = (value: number | null) => value === null ? "Not available" : `${(value / 1_000).toFixed(2)} s`;

function Breakdown({ title, values }: { title: string; values: Record<string, number> }) {
  const rows = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  return <article className="workCard"><span className="kicker">Distribution</span><h2>{title}</h2>{rows.length === 0 ? <p className="emptyState">No ledger observations.</p> : <div className="recentList">{rows.map(([label, value]) => <div className="queueItem" key={label}><strong>{label.replaceAll("_", " ")}</strong><span>{value}</span></div>)}</div>}</article>;
}

export default async function ResearchPage() {
  const session = await currentSession().catch(() => null);
  if (!session || (session.role !== "insurerAdmin" && session.role !== "auditor")) redirect("/workspace");
  const snapshot = await loadResearchSnapshot();
  return <main className="shell workspace">
    <header className="workspaceHeader"><div><span className="kicker">Ledger-derived research</span><h1 className="workspaceTitle">Block-Insure thesis dashboard</h1><p>Descriptive measurements with explicit provenance and interpretation boundaries.</p></div><Link className="secondary button" href="/workspace">Back to workspace</Link></header>
    <section className="roleDashboard">
      <div className="dashboardIntro"><div><span className="kicker">Reproducible snapshot</span><h2>Fabric schema {snapshot.provenance.ledgerSchemaVersion}</h2></div><p>Hash <code>{snapshot.reproducibilityHash}</code></p></div>
      <div className="metricGrid">
        <article className="metricCard"><span>Policies</span><strong>{snapshot.portfolio.policies}</strong><small>Current world state</small></article>
        <article className="metricCard"><span>Claims</span><strong>{snapshot.portfolio.claims}</strong><small>{formatMinor(snapshot.portfolio.claimAmountMinor)} requested</small></article>
        <article className="metricCard"><span>Review rounds</span><strong>{snapshot.adjudication.reviewRounds}</strong><small>{formatDuration(snapshot.adjudication.meanClosureLatencyMs)} mean closure</small></article>
        <article className="metricCard"><span>Appeals</span><strong>{snapshot.adjudication.appeals}</strong><small>{snapshot.adjudication.voteAlignmentBps === null ? "No finalized votes" : `${(snapshot.adjudication.voteAlignmentBps / 100).toFixed(1)}% final-outcome alignment`}</small></article>
        <article className="metricCard"><span>Fraud assessments</span><strong>{snapshot.fraudDecisionSupport.assessments}</strong><small>{snapshot.fraudDecisionSupport.advisoryOnly ? "All advisory" : "Authority boundary violation"}</small></article>
        <article className="metricCard"><span>Indexed events</span><strong>{snapshot.provenance.indexedEvents}</strong><small>{snapshot.provenance.checkpoint ? `${snapshot.provenance.retainedEvents} retained; through block ${snapshot.provenance.checkpoint.blockNumber}` : "No checkpoint"}</small></article>
        <article className="metricCard"><span>Evidence grants</span><strong>{snapshot.evidenceGovernance.grants}</strong><small>{snapshot.evidenceGovernance.grantBackedAccesses} grant-backed accesses</small></article>
        <article className="metricCard"><span>Open liability</span><strong>{formatMinor(snapshot.financialOperations.openLiabilityMinor)}</strong><small>Unpaid claim and benefit obligations</small></article>
      </div>
    </section>
    <div className="workGrid">
      <Breakdown title="Claim status" values={snapshot.portfolio.claimStatus} />
      <Breakdown title="Review outcomes" values={snapshot.adjudication.reviewStatus} />
      <Breakdown title="Appeal outcomes" values={snapshot.adjudication.appealStatus} />
      <Breakdown title="Fraud risk bands" values={snapshot.fraudDecisionSupport.riskLevels} />
      <Breakdown title="Evidence grant state" values={snapshot.evidenceGovernance.grantState} />
      <Breakdown title="Evidence access purposes" values={snapshot.evidenceGovernance.accessPurpose} />
    </div>
    <article className="workCard"><span className="kicker">Interpretation contract</span><h2>What these numbers do not prove</h2><ul>{snapshot.interpretationBoundaries.map((boundary) => <li key={boundary}>{boundary}</li>)}</ul><div className="evidenceActions"><a className="primary button" download href="/api/research/snapshot?download=1">Download machine-readable snapshot</a><a className="secondary button" href="/api/operations/events">Inspect projected events</a></div></article>
  </main>;
}
