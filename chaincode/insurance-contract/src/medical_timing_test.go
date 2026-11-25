package insurance

import (
	"testing"
	"time"
)

func TestMedicalProtocolWaits(t *testing.T) {
	for _, tc := range []struct {
		profile string
		want    medicalProtocolWaits
	}{
		{"REAL", medicalProtocolWaits{
			commit: time.Minute, reveal: 2 * time.Minute, activation: 10 * time.Minute,
			escalation: 24 * time.Hour, replacement: 5 * time.Minute, escalationPrepare: 7 * 24 * time.Hour,
			appeal: 30 * 24 * time.Hour, reviewMin: time.Minute, reviewMax: 14 * 24 * time.Hour,
			prepareDefault: 48 * time.Hour, voteDefault: 24 * time.Hour,
		}},
		{"DEMO", medicalProtocolWaits{
			commit: 15 * time.Second, reveal: 30 * time.Second, activation: 30 * time.Second,
			escalation: 2 * time.Minute, replacement: 30 * time.Second, escalationPrepare: 10 * time.Minute,
			appeal: 30 * time.Minute, reviewMin: 15 * time.Second, reviewMax: 20 * time.Minute,
			prepareDefault: 3 * time.Minute, voteDefault: 2 * time.Minute,
		}},
	} {
		t.Run(tc.profile, func(t *testing.T) {
			if got := timingWaits(tc.profile); got != tc.want {
				t.Fatalf("%s waits = %+v, want %+v", tc.profile, got, tc.want)
			}
		})
	}
}

func TestMedicalPreparationAndVotingUsePinnedProfile(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	c, ctx := f.contract, f.context
	now := ctx.stub.timestamp.AsTime()
	setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
	before, err := c.createMedicalPreparation(ctx, f.claim, "real-preparation", "", medicalPanel, true, "")
	requireNoError(t, err)
	_, err = c.ProposeMedicalTimingProfile(ctx, "demo-timing", "DEMO")
	requireNoError(t, err)
	setIdentity(ctx, "auditor", "AuditorMSP", "auditor", nil)
	_, err = c.ApproveMedicalTimingProfile(ctx, "demo-timing")
	requireNoError(t, err)
	historical, err := c.ReadClaimReview(ctx, before.ID)
	requireNoError(t, err)
	if historical.TimingProfile != "REAL" || historical.PrepareBy != now.Add(48*time.Hour).Format(time.RFC3339Nano) {
		t.Fatal("switch changed REAL preparation")
	}
	demo, err := c.createMedicalPreparation(ctx, f.claim, "demo-preparation", "", medicalPanel, true, "")
	requireNoError(t, err)
	if demo.TimingProfile != "DEMO" || demo.PrepareBy != now.Add(3*time.Minute).Format(time.RFC3339Nano) {
		t.Fatal("DEMO preparation did not pin its deadline")
	}
	for _, review := range []*ClaimReview{historical, demo} {
		deadline, err := medicalReviewDeadline(ctx, "", review.TimingProfile, timingWaits(review.TimingProfile).voteDefault)
		requireNoError(t, err)
		want := 24 * time.Hour
		if review == demo {
			want = 2 * time.Minute
		}
		if !deadline.Equal(now.Add(want)) {
			t.Fatalf("%s voting default = %s, want %s", review.TimingProfile, deadline, now.Add(want))
		}
	}
}

func TestMedicalTimingGovernanceAndPinnedDeadlines(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	c, ctx := f.contract, f.context
	profile, err := c.ReadMedicalTimingProfile(ctx)
	requireNoError(t, err)
	if profile.Profile != "REAL" {
		t.Fatal("missing profile did not default to REAL")
	}
	now := ctx.stub.timestamp.AsTime()
	closeTime := now.Format(time.RFC3339Nano)
	oldRequest := &OracleRequest{ClaimVersion: f.claim.Version, Status: "FAILED", FinalizedAt: closeTime}
	f.claim.UpdatedAt = closeTime
	oldEscalation, _, err := c.medicalEscalationDue(ctx, f.claim, oldRequest)
	requireNoError(t, err)
	prior := &ClaimReview{ID: "historical-review", Status: "REJECTED", ClosedAt: closeTime}
	priorEnd, _, err := medicalRejectionWindow(prior, f.claim)
	requireNoError(t, err)
	setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
	_, err = c.ProposeMedicalTimingProfile(ctx, "demo-timing", "DEMO")
	requireNoError(t, err)
	_, err = c.ApproveMedicalTimingProfile(ctx, "demo-timing")
	requireError(t, err, "AuditorMSP")
	setIdentity(ctx, "auditor", "AuditorMSP", "auditor", nil)
	profile, err = c.ApproveMedicalTimingProfile(ctx, "demo-timing")
	requireNoError(t, err)
	if profile.Profile != "DEMO" || profile.TransactionID == "" {
		t.Fatal("missing active DEMO governance record")
	}
	postSwitchEnd, _, err := medicalRejectionWindow(prior, f.claim)
	requireNoError(t, err)
	if postSwitchEnd != priorEnd || postSwitchEnd != now.Add(30*24*time.Hour) {
		t.Fatal("switch changed a historical deadline")
	}
	postSwitchEscalation, _, err := c.medicalEscalationDue(ctx, f.claim, oldRequest)
	requireNoError(t, err)
	if postSwitchEscalation != oldEscalation || postSwitchEscalation != now.Add(24*time.Hour) {
		t.Fatal("switch changed a historical escalation deadline")
	}
	oldRequest.TimingProfile = "DEMO"
	demoEscalation, _, err := c.medicalEscalationDue(ctx, f.claim, oldRequest)
	requireNoError(t, err)
	if demoEscalation != now.Add(2*time.Minute) {
		t.Fatal("new DEMO failure did not get the scaled escalation window")
	}
	prior.TimingProfile = profile.Profile
	demoEnd, _, err := medicalRejectionWindow(prior, f.claim)
	requireNoError(t, err)
	if demoEnd != now.Add(30*time.Minute) {
		t.Fatal("new DEMO rejection did not get the scaled window")
	}
	_, err = c.ApproveMedicalTimingProfile(ctx, "demo-timing")
	requireError(t, err, "stale")
	ctx.stub.channelID = medicalCandidateChannel
	profile, err = c.ReadMedicalTimingProfile(ctx)
	requireNoError(t, err)
	if profile.Profile != "REAL" {
		t.Fatal("medical acceptance channel inherited DEMO")
	}
	_, err = c.ApproveMedicalTimingProfile(ctx, "demo-timing")
	requireError(t, err, "dev-lite")
}
