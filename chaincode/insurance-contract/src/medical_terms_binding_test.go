package insurance

import (
	"strings"
	"testing"
)

func TestDevLiteApprovalPinsPayableBreakdown(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	c, ctx := f.contract, f.context
	digest := strings.Repeat("a", 64)
	_, err := c.CreatePolicyPackage(ctx, "original-product", "Original", "Synthetic coverage", 100, 4_000, digest)
	requireNoError(t, err)
	rules, err := c.ConfigureMedicalRules(ctx, "original-product", "SURGERY", 8_000, 1_000, 1_000, 8_000, 0, 30, false)
	requireNoError(t, err)
	_, err = c.PublishPolicyPackage(ctx, rules.PackageID)
	requireNoError(t, err)
	policy, err := c.ReadPolicy(ctx, f.claim.PolicyID)
	requireNoError(t, err)
	policy.PackageID, policy.MedicalRulesVersion, policy.TermsHash = rules.PackageID, rules.Version, rules.TermsHash
	policy.StartDate, policy.EndDate, policy.PaidThroughDate = "2026-09-01", "2026-12-01", "2026-09-30"
	policy.Status, policy.CoverageLimitMinor, policy.HospitalIDs = "ACTIVE", 4_000, []string{f.claim.HospitalID}
	requireNoError(t, overwriteAsset(ctx, "policy", policy.ID, policy))
	episode := &MedicalEpisode{ID: f.claim.EpisodeID, HospitalID: f.claim.HospitalID, Revision: 1, PatientReferenceHash: digest,
		Service: "SURGERY", ServiceDate: "2026-09-04", AdmissionDate: "2026-09-04", DischargeDate: "2026-09-04", BillMinor: 10_000}
	requireNoError(t, putPrivateState(ctx, "medicalEpisodeRevision", medicalRevisionKey(episode.ID, episode.Revision), episode))
	_, err = c.VerifyMedicalAssociation(ctx, episode.ID, 1, f.claim.ClaimantID, digest, true)
	requireNoError(t, err)
	setIdentity(ctx, "holder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "holder"})
	quote, err := c.QuoteMedicalClaim(ctx, policy.ID, episode.ID, 1)
	requireNoError(t, err)
	_, err = c.PrepareMedicalClaim(ctx, "terms-claim", policy.ID, episode.ID, 1)
	requireNoError(t, err)
	claim, err := c.SubmitMedicalClaim(ctx, "terms-claim", policy.ID, episode.ID, 1, quote.StatementHash)
	requireNoError(t, err)
	claim.CurrentOracleRequestID = "terms-oracle"
	request := &OracleRequest{ID: claim.CurrentOracleRequestID, ClaimID: claim.ID, ClaimVersion: claim.Version, Status: "PENDING"}
	requireNoError(t, putState(ctx, "oracleRequest", request.ID, request))
	now, err := timestamp(ctx)
	requireNoError(t, err)
	requireNoError(t, c.finalizeOracleRequest(ctx, request, claim, true, digest, "EXACT_CONSENSUS", now))
	cert, err := c.ReadMedicalApprovalCertificate(ctx, claim.ID, claim.Version)
	requireNoError(t, err)
	if quote.Terms == nil || cert.PackageID != rules.PackageID || cert.RulesVersion != rules.Version ||
		cert.TermsHash != rules.TermsHash || cert.BreakdownHash != quote.Terms.BreakdownHash ||
		cert.AmountMinor != 4_000 || quote.DeductibleMinor != 800 || quote.InsurerShareMinor != 5_760 {
		t.Fatal("approval did not bind the issued terms and accepted breakdown")
	}

	setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
	_, err = c.ConfigureMedicalRules(ctx, rules.PackageID, "SURGERY", 2_000, 0, 0, 3_000, 0, 30, false)
	requireError(t, err, "once on a draft")
	_, err = c.CreatePolicyPackage(ctx, "successor-product", "Successor", "Synthetic successor coverage", 100, 4_000, digest)
	requireNoError(t, err)
	_, err = c.ConfigureMedicalRules(ctx, "successor-product", "SURGERY", 2_000, 0, 0, 3_000, 0, 30, false)
	requireNoError(t, err)
	_, err = c.PublishPolicyPackage(ctx, "successor-product")
	requireNoError(t, err)

	f.claim = claim
	authorized, err := f.authorize()
	requireNoError(t, err)
	confirmed, err := f.confirm("terms-payout")
	requireNoError(t, err)
	if authorized.AmountMinor != cert.AmountMinor || confirmed.AmountMinor != cert.AmountMinor ||
		confirmed.ApprovalCertificateHash != cert.Hash || confirmed.Status != "CONFIRMED" {
		t.Fatal("the successor product changed the original approval or payout")
	}
}
