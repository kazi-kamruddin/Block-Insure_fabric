import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { resolveStatusTone, StatusBadge } from "@/components/status-badge";
import { currentSession } from "@/lib/auth/current-session";
import { loadResearchSnapshot } from "@/lib/research/load-snapshot";

export const dynamic = "force-dynamic";

const formatMinor = (value: number) => new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT" }).format(value / 100);
const formatDuration = (value: number | null) => value === null ? "Not available" : `${(value / 1_000).toFixed(2)} s`;

function Breakdown({ title, values }: { title: string; values: Record<string, number> }) {
  const rows = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  return (
    <article className="workCard">
      <span className="kicker">Distribution</span>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="emptyState">No ledger observations recorded yet.</p>
      ) : (
        <div className="distributionList">
          {rows.map(([label, value]) => {
            const pct = total > 0 ? Math.round((value / total) * 100) : 0;
            const tone = resolveStatusTone(label);
            return (
              <div className="distributionItem" key={label}>
                <div className="distributionHeader">
                  <StatusBadge status={label} tone={tone} />
                  <span>{value} ({pct}%)</span>
                </div>
                <div className="distributionTrack" aria-hidden="true">
                  <div className={`distributionFill distributionFill-${tone}`} style={{ width: `${Math.max(pct, value > 0 ? 4 : 0)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

export default async function ResearchPage() {
  const session = await currentSession().catch(() => null);
  if (!session || (session.role !== "insurerAdmin" && session.role !== "auditor")) redirect("/workspace");

  const snapshot = await loadResearchSnapshot().catch(() => null);

  return (
    <>
      <SiteHeader activeRoute="/research" showResearch workspaceHref={`/workspace/${session.role === "auditor" ? "auditor" : "insurer"}`} />
      <main id="main-content" tabIndex={-1} className="workspacePage">
        <div className="shell workspace researchSection">
          <header className="workspaceHeader">
            <div>
              <span className="kicker">Ledger-derived research</span>
              <h1 className="workspaceTitle">Block-Insure thesis dashboard</h1>
              <p>Descriptive measurements with explicit provenance and interpretation boundaries.</p>
            </div>
            <Link className="secondary button" href="/workspace">Back to workspace</Link>
          </header>

          {!snapshot ? (
            <section className="dashboardUnavailable" aria-live="polite">
              <div>
                <StatusBadge status="DEGRADED" label="Ledger snapshot unavailable" tone="pending" />
                <h2>Fabric peer connectivity is required for live thesis metrics</h2>
                <p>Retry when the Fabric network is available, or return to your workspace.</p>
              </div>
              <div className="evidenceActions">
                <form action="/research" method="get">
                  <button className="primary button" type="submit">Retry snapshot</button>
                </form>
                <Link className="secondary button" href="/workspace">Return to workspace</Link>
              </div>
            </section>
          ) : (
            <>
              <section className="roleDashboard">
                <div className="dashboardIntro">
                  <div>
                    <span className="kicker">Reproducible snapshot</span>
                    <h2>Fabric schema {snapshot.provenance.ledgerSchemaVersion}</h2>
                  </div>
                  <p>Hash <code className="monoWrap">{snapshot.reproducibilityHash}</code></p>
                </div>

                <div className="researchBand">
                  <div className="researchBandHeading">
                    <span className="kicker">Band 1</span>
                    <h2>Portfolio &amp; governed adjudication</h2>
                    <p>Active world-state counts, requested liability totals, and multi-auditor review latency.</p>
                  </div>
                  <div className="metricGrid">
                    <article className="metricCard"><span>Policies</span><strong>{snapshot.portfolio.policies}</strong><small>Current world state</small></article>
                    <article className="metricCard"><span>Claims</span><strong>{snapshot.portfolio.claims}</strong><small>{formatMinor(snapshot.portfolio.claimAmountMinor)} requested</small></article>
                    <article className="metricCard"><span>Open liability</span><strong>{formatMinor(snapshot.financialOperations.openLiabilityMinor)}</strong><small>Unpaid claim and benefit obligations</small></article>
                    <article className="metricCard"><span>Review rounds</span><strong>{snapshot.adjudication.reviewRounds}</strong><small>{formatDuration(snapshot.adjudication.meanClosureLatencyMs)} mean closure</small></article>
                    <article className="metricCard"><span>Appeals</span><strong>{snapshot.adjudication.appeals}</strong><small>{snapshot.adjudication.voteAlignmentBps === null ? "No finalized votes" : `${(snapshot.adjudication.voteAlignmentBps / 100).toFixed(1)}% final-outcome alignment`}</small></article>
                  </div>
                </div>

                <div className="researchBand">
                  <div className="researchBandHeading">
                    <span className="kicker">Band 2</span>
                    <h2>Oracle consensus &amp; privacy-preserving verification</h2>
                    <p>Certificate-bound 2-of-3 Oracle quorum stability and zero-violation agreement checks.</p>
                  </div>
                  <div className="metricGrid">
                    <article className="metricCard"><span>Oracle requests</span><strong>{snapshot.oracleConsensus.requests}</strong><small>{formatDuration(snapshot.oracleConsensus.meanFinalizationLatencyMs)} mean finalization</small></article>
                    <article className="metricCard"><span>Oracle agreement</span><strong>{snapshot.oracleConsensus.agreementBps === null ? "—" : `${(snapshot.oracleConsensus.agreementBps / 100).toFixed(1)}%`}</strong><small>{snapshot.oracleConsensus.revealedResults} certificate-bound reveals</small></article>
                    <article className="metricCard"><span>Quorum reached with two reveals</span><strong>{snapshot.oracleConsensus.quorumReachedWithTwoReveals}</strong><small>{snapshot.oracleConsensus.meanRevealParticipationBps === null ? "No finalized requests" : `${(snapshot.oracleConsensus.meanRevealParticipationBps / 100).toFixed(1)}% mean reveal participation`}</small></article>
                    <article className="metricCard"><span>Finalizations with competing results</span><strong>{snapshot.oracleConsensus.competingResultFinalizations}</strong><small>More than one distinct result hash</small></article>
                    <article className="metricCard"><span>Fault survival</span><strong>{snapshot.oracleConsensus.faultSurvival}</strong><small>Recorded fault-injection trials reaching consensus</small></article>
                    <article className="metricCard"><span>Oracle safety violations</span><strong>{snapshot.oracleConsensus.safetyViolations}</strong><small>Multiple quorum hashes in one request</small></article>
                    <article className="metricCard"><span>Private credentials / proofs</span><strong>{snapshot.privacyPreservingVerification.credentials} / {snapshot.privacyPreservingVerification.presentations}</strong><small>{snapshot.privacyPreservingVerification.privacyBoundOracleRequests} Oracle requests proof-bound</small></article>
                  </div>
                </div>

                <div className="researchBand">
                  <div className="researchBandHeading">
                    <span className="kicker">Band 3</span>
                    <h2>Fraud advisory boundary, evidence &amp; provenance</h2>
                    <p>Advisory decision-support bounds, explicit access grants, and event projection checkpoint.</p>
                  </div>
                  <div className="metricGrid">
                    <article className="metricCard"><span>Fraud assessments</span><strong>{snapshot.fraudDecisionSupport.assessments}</strong><small>{snapshot.fraudDecisionSupport.advisoryOnly ? "All advisory" : "Authority boundary violation"}</small></article>
                    <article className="metricCard"><span>Indexed events</span><strong>{snapshot.provenance.indexedEvents}</strong><small>{snapshot.provenance.checkpoint ? `${snapshot.provenance.retainedEvents} retained; through block ${snapshot.provenance.checkpoint.blockNumber}` : "No checkpoint"}</small></article>
                    <article className="metricCard"><span>Evidence grants</span><strong>{snapshot.evidenceGovernance.grants}</strong><small>{snapshot.evidenceGovernance.grantBackedAccesses} grant-backed accesses</small></article>
                  </div>
                </div>
              </section>

              <div className="workGrid" style={{ marginTop: 28 }}>
                <Breakdown title="Claim status" values={snapshot.portfolio.claimStatus} />
                <Breakdown title="Review outcomes" values={snapshot.adjudication.reviewStatus} />
                <Breakdown title="Appeal outcomes" values={snapshot.adjudication.appealStatus} />
                <Breakdown title="Oracle outcomes" values={snapshot.oracleConsensus.outcomes} />
                <Breakdown title="Fraud risk bands" values={snapshot.fraudDecisionSupport.riskLevels} />
                <Breakdown title="Evidence grant state" values={snapshot.evidenceGovernance.grantState} />
                <Breakdown title="Evidence access purposes" values={snapshot.evidenceGovernance.accessPurpose} />
                <article className="workCard workCardWide">
                  <span className="kicker">Interpretation contract</span>
                  <h2>What these numbers do not prove</h2>
                  <ul>{snapshot.interpretationBoundaries.map((boundary) => <li key={boundary}>{boundary}</li>)}</ul>
                  <div className="evidenceActions">
                    <a className="primary button" download href="/api/research/snapshot?download=1">Download machine-readable snapshot</a>
                    <a className="secondary button" href="/api/operations/events">Inspect projected events</a>
                  </div>
                </article>
              </div>
            </>
          )}
        </div>
      </main>
      <footer className="shell footer">
        <span>Block-Insure Fabric Research</span>
        <span>Reproducible ledger snapshot · Interpretation boundaries enforced</span>
      </footer>
    </>
  );
}
