package insurance

import (
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

// Claimant branch of recipe 10: after a defaulted audit seed, the claimant can
// escalate a held claim once the period's reveal grace ends. Escalation binds
// the frozen selection and opens panel preparation.
func TestClaimantEscalatesDefaultedAuditHold(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	activateR2Roster(t, f)
	c, ctx, claim := f.contract, f.context, f.claim
	requestID := claim.CurrentOracleRequestID
	claim.Status, claim.CurrentOracleRequestID = "SUBMITTED", ""
	requireNoError(t, overwriteAsset(ctx, "claim", claim.ID, claim))
	now := ctx.stub.timestamp.AsTime()
	start, end := now.Add(time.Minute), now.Add(2*time.Minute)
	setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
	_, err := c.CreateMedicalAuditPeriod(ctx, "escalation-period", start.Format(time.RFC3339), end.Format(time.RFC3339), 2500, 60)
	requireNoError(t, err)
	share := strings.Repeat("c", 64)
	for _, actor := range []struct{ msp, role string }{{"InsurerMSP", "insurerAdmin"}, {"HospitalMSP", "hospitalOfficer"}, {"AuditorMSP", "auditor"}} {
		setIdentity(ctx, actor.role, actor.msp, actor.role, nil)
		_, err = c.CommitMedicalAuditSeedShare(ctx, "escalation-period", canonicalProtocolHash("fabric-medical-audit-share-v2", "escalation-period", actor.msp, share))
		requireNoError(t, err)
	}
	ctx.stub.timestamp = timestamppb.New(start)
	_, err = c.OpenMedicalAuditPeriod(ctx, "escalation-period")
	requireNoError(t, err)

	// The Oracle round reaches consensus inside the period, so the claim waits
	// for the audit outcome. Only the Auditor share is revealed.
	request, err := c.ReadOracleRequest(ctx, requestID)
	requireNoError(t, err)
	request.Status, request.AuditPeriodID, request.FinalizedAt = "CONSENSUS", "escalation-period", start.Format(time.RFC3339Nano)
	requireNoError(t, overwriteAsset(ctx, "oracleRequest", request.ID, request))
	claim, err = c.ReadClaim(ctx, claim.ID)
	requireNoError(t, err)
	claim.Status, claim.CurrentOracleRequestID = "MEDICAL_AUDIT_PENDING", requestID
	requireNoError(t, overwriteAsset(ctx, "claim", claim.ID, claim))
	ctx.stub.timestamp = timestamppb.New(end)
	_, err = c.RevealMedicalAuditSeedShare(ctx, "escalation-period", share)
	requireNoError(t, err)

	setIdentity(ctx, "holder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "holder"})
	_, err = c.EscalateStalledMedicalClaim(ctx, claim.ID)
	requireError(t, err, "deadline has not elapsed")
	ctx.stub.timestamp = timestamppb.New(end.Add(time.Minute))
	setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
	period, err := c.FinalizeMedicalAuditPeriod(ctx, "escalation-period")
	requireNoError(t, err)
	if period.Status != "AUDIT_SEED_DEFAULTED" {
		t.Fatalf("missing shares did not default the period: %+v", period)
	}
	setIdentity(ctx, "holder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "holder"})
	review, err := c.EscalateStalledMedicalClaim(ctx, claim.ID)
	requireNoError(t, err)
	escalated, err := c.ReadClaim(ctx, claim.ID)
	requireNoError(t, err)
	if review.Status != "PREPARING" || escalated.MedicalEscalatedAt == "" || escalated.CurrentReviewID != review.ID {
		t.Fatalf("claimant escalation did not open panel preparation: review=%+v claim=%+v", review, escalated)
	}
	_, err = c.EscalateStalledMedicalClaim(ctx, claim.ID)
	requireError(t, err, "not eligible")
}
