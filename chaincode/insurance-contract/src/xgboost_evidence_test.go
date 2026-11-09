package insurance

import "testing"

func TestXGBoostReviewWaitsForCurrentEvidenceAndExactSubjectGrants(t *testing.T) {
	c := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	claim := &Claim{ID: "claim-prepared", Version: 2, ClaimantID: "holder1", CurrentOracleRequestID: "request-prepared"}
	request := &OracleRequest{ID: "request-prepared", ModelVersion: "fabric-xgb-synthetic-v1"}
	requireNoError(t, putState(ctx, "oracleRequest", request.ID, request))
	_, err := c.requireXGBoostEvidence(ctx, claim)
	requireError(t, err, "primary invoice")
	document := &EvidenceReference{ID: "evidence-prepared", ClaimID: claim.ID, ClaimVersion: 2, DocumentType: "APPEAL_DOCUMENT", SubmittedBy: claim.ClaimantID}
	requireNoError(t, putState(ctx, "evidenceReference", document.ID, document))
	panel := []string{"auditor1", "auditor2", "auditor3", "auditor4"}
	err = c.requireXGBoostReviewReadiness(ctx, claim, panel[:3], 2, 2, "2026-09-10T00:00:00Z")
	requireError(t, err, "exactly four")
	err = c.requireXGBoostReviewReadiness(ctx, claim, panel, 3, 2, "2026-09-10T00:00:00Z")
	requireError(t, err, "prepare current evidence grant")
	for _, auditor := range panel {
		grant := &EvidenceAccessGrant{ID: "grant-" + auditor, EvidenceID: document.ID, ClaimID: claim.ID, OwnerID: claim.ClaimantID, GranteeMSP: "AuditorMSP", GranteeRole: "auditor", GranteeSubject: auditor, Purpose: "AUDIT", Status: "ACTIVE", MaxAccesses: 10, ExpiresAt: "2026-09-11T00:00:00Z"}
		requireNoError(t, putState(ctx, "evidenceGrant", grant.ID, grant))
	}
	requireNoError(t, c.requireXGBoostReviewReadiness(ctx, claim, panel, 3, 2, "2026-09-10T00:00:00Z"))
	claim.Version = 3
	_, err = c.requireXGBoostEvidence(ctx, claim)
	requireError(t, err, "primary invoice")
}
