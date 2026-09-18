import type { FabricRole } from "@/lib/fabric/config";

type PresentationStage = {
  number: string;
  label: string;
  roles: readonly FabricRole[];
};

const stages: readonly PresentationStage[] = [
  { number: "01", label: "Partner network", roles: ["insurerAdmin"] },
  { number: "02", label: "Hospital invoice", roles: ["hospitalOfficer"] },
  { number: "03", label: "Policy & premium", roles: ["policyholder", "bankOfficer"] },
  { number: "04", label: "Claim verification", roles: ["policyholder", "insurerAdmin"] },
  { number: "05", label: "Oracle consensus", roles: ["insurerAdmin"] },
  { number: "06", label: "Auditor fallback", roles: ["auditor"] },
  { number: "07", label: "Settlement", roles: ["insurerAdmin", "bankOfficer"] },
];

const guides: Record<FabricRole, { title: string; show: string; proves: string; boundary: string; handoff: string }> = {
  insurerAdmin: {
    title: "Insurer orchestration",
    show: "Partner agreements, policy packages, invoice cross-checks, Oracle requests, governed review, and settlement authorization.",
    proves: "The insurer coordinates the process but cannot rewrite Hospital invoices, cast auditor votes, or confirm Bank execution.",
    boundary: "InsurerMSP · insurerAdmin certificate role",
    handoff: "Hospital for invoice facts, Oracles for deterministic checks, Auditors for fallback, then Bank for payment.",
  },
  policyholder: {
    title: "Customer journey",
    show: "Policy acquisition, email-OTP premium payment, EFT mandate control, claim/evidence submission, appeal, and final statement.",
    proves: "The customer owns coverage and evidence consent while private files remain encrypted outside Fabric.",
    boundary: "InsurerMSP · policyholder subject ownership",
    handoff: "Bank authorizes premium execution; insurer and contracted Hospital verify the submitted claim.",
  },
  hospitalOfficer: {
    title: "Independent Hospital register",
    show: "Create and finalize the Hospital's own patient invoice before any insurance claim references it.",
    proves: "The Hospital maintains its operational record independently; the insurer receives agreement-scoped read-only facts.",
    boundary: "HospitalMSP · hospital subject scoped records",
    handoff: "Give the finalized invoice reference to the policyholder; the insurer later performs a read-only cross-check.",
  },
  auditor: {
    title: "Independent manual review",
    show: "Open assignment, evidence access trail, immutable certificate-bound vote, and fixed quorum progress.",
    proves: "One auditor cannot decide a claim and prior votes are never erased by an appeal or later round.",
    boundary: "AuditorMSP · assigned certificate subject",
    handoff: "The finalized quorum returns the claim to the insurer for rejection handling or settlement authorization.",
  },
  bankOfficer: {
    title: "External Bank simulation",
    show: "Customer/insurer balances, EFT mandate review, scheduled debit settlement or bounce, reversals, and payout confirmation.",
    proves: "The Bank executes money-side decisions; the insurer cannot force a debit or override insufficient funds.",
    boundary: "BankMSP · bankOfficer certificate role",
    handoff: "Successful premium execution activates coverage; confirmed settlement closes the insurer's liability.",
  },
};

export function PresentationGuide({ role }: { role: FabricRole }) {
  const guide = guides[role];
  return (
    <aside className="presentationGuide" aria-label="Presentation guide">
      <div className="presentationGuideHeading">
        <div><span className="kicker">Presenter mode · role boundary</span><h2>{guide.title}</h2></div>
        <nav className="presentationJumps" aria-label="Workspace sections">
          <a href="#overview">Overview</a>
          <a href="#operations">Operations</a>
          <a href="#transaction-console">Transaction</a>
          <a href="#ledger-tools">Ledger proof</a>
        </nav>
      </div>

      <ol className="presentationJourney" aria-label="End-to-end insurance journey">
        {stages.map((stage) => (
          <li className={stage.roles.includes(role) ? "isCurrent" : ""} key={stage.number}>
            <span>{stage.number}</span><strong>{stage.label}</strong>
          </li>
        ))}
      </ol>

      <div className="presenterBrief">
        <div><span>Show now</span><p>{guide.show}</p></div>
        <div><span>What it proves</span><p>{guide.proves}</p></div>
        <div><span>Next handoff</span><p>{guide.handoff}</p><small>{guide.boundary}</small></div>
      </div>
    </aside>
  );
}
