package insurance

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestDevLiteMedicalAuditSelection(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	c, ctx := f.contract, f.context
	seed := strings.Repeat("a", 64)
	setIdentity(ctx, "auditor", "AuditorMSP", "auditor", map[string]string{"subjectId": "auditor1"})
	period, err := c.CommitMedicalAuditPeriod(ctx, "period", "2026-09-05T12:01:00Z", "2026-09-05T12:02:00Z",
		2_500, canonicalProtocolHash("fabric-medical-audit-seed-v1", "period", seed))
	requireNoError(t, err)
	_, err = c.RevealMedicalAuditSeed(ctx, period.ID, seed)
	requireError(t, err, "after the period")
	ctx.stub.timestamp = timestamppb.New(time.Date(2026, 9, 5, 12, 2, 0, 0, time.UTC))
	period, err = c.RevealMedicalAuditSeed(ctx, period.ID, seed)
	requireNoError(t, err)

	count := 0
	digest := strings.Repeat("b", 64)
	for i := range 10_000 {
		request := &OracleRequest{ClaimID: fmt.Sprintf("claim-%d", i), ClaimVersion: 1, ResultHash: digest}
		first := medicalAuditSelection(period, request)
		if first != medicalAuditSelection(period, request) {
			t.Fatal("same version and result produced different audit evidence")
		}
		if first.Selected {
			count++
		}
	}
	t.Logf("selected %d of 10000 deterministic synthetic claims", count)
	if count < 2_350 || count > 2_650 {
		t.Fatalf("observed rate outside pre-set bounds: %d", count)
	}

	request, err := c.ReadOracleRequest(ctx, f.claim.CurrentOracleRequestID)
	requireNoError(t, err)
	request.AuditPeriodID = period.ID
	request.VerifiedResult = true
	f.claim.Version, request.ClaimVersion = 2, 2
	f.claim.Status = "MEDICAL_AUDIT_PENDING"
	for i := 0; !medicalAuditSelection(period, request).Selected; i++ {
		request.ResultHash = canonicalProtocolHash("test-result", fmt.Sprint(i))
	}
	f.claim.OracleResultHash = request.ResultHash
	requireNoError(t, overwriteAsset(ctx, "oracleRequest", request.ID, request))
	requireNoError(t, overwriteAsset(ctx, "claim", f.claim.ID, f.claim))
	selection, err := c.ResolveMedicalAuditSelection(ctx, f.claim.ID)
	requireNoError(t, err)
	resolved, err := c.ReadClaim(ctx, f.claim.ID)
	requireNoError(t, err)
	if !selection.Selected || resolved.Status != "MEDICAL_REVIEW_REQUIRED" {
		t.Fatal("selected claim did not require panel review")
	}
	_, err = c.ResolveMedicalAuditSelection(ctx, f.claim.ID)
	requireError(t, err, "does not await")
}
