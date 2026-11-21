package insurance

import (
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

var reservationClosedAt = time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)

type reservationFixture struct {
	contract *Contract
	context  *testContext
}

func newReservationFixture(t *testing.T) reservationFixture {
	t.Helper()
	contract, ctx := medicalTestContext()
	ctx.stub.channelID = medicalDevLiteChannel
	return reservationFixture{contract: contract, context: ctx}
}

// rejected stores a rejected medical claim, its closed review and a reservation
// of amount on the shared policy coverage record.
func (f reservationFixture) rejected(t *testing.T, id, reviewStatus string, amount int64, mutate func(*Claim)) *Claim {
	t.Helper()
	claim := &Claim{ID: id, PolicyID: "policy", ClaimantID: "owner", EpisodeID: strings.Repeat("e", 63) + id[len(id)-1:],
		EpisodeRevision: 1, Version: 1, Status: "REJECTED", AmountMinor: amount, CurrentReviewID: "review-" + id}
	if mutate != nil {
		mutate(claim)
	}
	review := &ClaimReview{ID: claim.CurrentReviewID, ClaimID: id, MedicalVersion: claim.Version, Status: reviewStatus,
		ClosedAt: reservationClosedAt.Format(time.RFC3339Nano)}
	requireNoError(t, putState(f.context, "claim", id, claim))
	requireNoError(t, putState(f.context, "claimReview", review.ID, review))
	coverage := &MedicalCoverage{}
	if existing, err := getState[MedicalCoverage](f.context, "medicalCoverage", "policy"); err == nil {
		coverage = existing
	}
	coverage.UsedMinor += amount
	requireNoError(t, overwriteAsset(f.context, "medicalCoverage", "policy", coverage))
	return claim
}

func (f reservationFixture) at(offset time.Duration) {
	f.context.stub.timestamp = timestamppb.New(reservationClosedAt.Add(offset))
}

func (f reservationFixture) as(role string) {
	if role == "insurerAdmin" {
		setIdentity(f.context, "insurer", "InsurerMSP", "insurerAdmin", nil)
		return
	}
	setIdentity(f.context, role, "InsurerMSP", "policyholder", map[string]string{"subjectId": role})
}

func (f reservationFixture) used(t *testing.T) int64 {
	t.Helper()
	coverage, err := getState[MedicalCoverage](f.context, "medicalCoverage", "policy")
	requireNoError(t, err)
	return coverage.UsedMinor
}

func TestMedicalReservationReleaseAfterPanelRejection(t *testing.T) {
	f := newReservationFixture(t)
	claim := f.rejected(t, "claim-1", "REJECTED", 4_000, nil)
	f.as("owner")

	f.at(29 * 24 * time.Hour)
	_, err := f.contract.ReleaseMedicalReservation(f.context, claim.ID)
	requireError(t, err, "remains available")

	f.at(medicalAppealWindow + time.Second)
	_, err = f.contract.SubmitMedicalAppeal(f.context, "late-appeal", claim.ID, "decision", strings.Repeat("a", 64), 0, "")
	requireError(t, err, "window closed")
	released, err := f.contract.ReleaseMedicalReservation(f.context, claim.ID)
	requireNoError(t, err)
	if released.Status != "REJECTED" || released.MedicalReserveReleasedAt == "" || f.used(t) != 0 {
		t.Fatalf("release did not return the reservation: %+v used=%d", released, f.used(t))
	}
	_, err = f.contract.ReleaseMedicalReservation(f.context, claim.ID)
	requireError(t, err, "already released")
	if f.used(t) != 0 {
		t.Fatal("a second release changed coverage")
	}

	_, err = f.contract.SubmitMedicalAppeal(f.context, "after-release", claim.ID, "decision", strings.Repeat("a", 64), 0, "")
	requireError(t, err, "was released")
	_, err = f.contract.QuoteMedicalAppeal(f.context, claim.ID, 2)
	requireError(t, err, "was released")
	_, err = f.contract.QuoteMedicalCorrection(f.context, claim.ID, 2)
	requireError(t, err, "only an unpaid claim")
}

func TestMedicalReservationReleasesAtOnceWhenNoPathRemains(t *testing.T) {
	f := newReservationFixture(t)
	appealed := f.rejected(t, "claim-1", "REJECTED", 3_000, func(c *Claim) { c.AppealCount = maxAppealsPerClaim })
	recovered := f.rejected(t, "claim-2", "TIMED_OUT", 2_000, func(c *Claim) { c.MedicalRecoveryUsed = true })
	f.at(time.Minute)
	f.as("insurerAdmin")
	_, err := f.contract.ReleaseMedicalReservation(f.context, appealed.ID)
	requireNoError(t, err)
	f.as("owner")
	_, err = f.contract.ReleaseMedicalReservation(f.context, recovered.ID)
	requireNoError(t, err)
	if f.used(t) != 0 {
		t.Fatalf("coverage not fully released: %d", f.used(t))
	}
}

func TestMedicalReservationRecoveryWindow(t *testing.T) {
	f := newReservationFixture(t)
	claim := f.rejected(t, "claim-1", "TIMED_OUT", 2_500, nil)
	f.as("owner")
	f.at(time.Hour)
	_, err := f.contract.ReleaseMedicalReservation(f.context, claim.ID)
	requireError(t, err, "remains available")

	f.at(medicalAppealWindow + time.Second)
	f.as("insurerAdmin")
	_, err = f.contract.RecoverMedicalReview(f.context, "review-"+claim.ID, "late-recovery", reservationClosedAt.Add(medicalAppealWindow+48*time.Hour).Format(time.RFC3339))
	requireError(t, err, "window closed")
	_, err = f.contract.ReleaseMedicalReservation(f.context, claim.ID)
	requireNoError(t, err)
}

func TestMedicalReservationReleaseBoundaries(t *testing.T) {
	f := newReservationFixture(t)
	claim := f.rejected(t, "claim-1", "REJECTED", 1_000, func(c *Claim) { c.AppealCount = maxAppealsPerClaim })
	approved := f.rejected(t, "claim-2", "APPROVED", 1_000, func(c *Claim) { c.Status = "APPROVED" })
	f.at(time.Minute)

	f.as("intruder")
	_, err := f.contract.ReleaseMedicalReservation(f.context, claim.ID)
	requireError(t, err, "another policyholder")
	setIdentity(f.context, "bank", "BankMSP", "bankOfficer", nil)
	_, err = f.contract.ReleaseMedicalReservation(f.context, claim.ID)
	requireError(t, err, "only the claimant or the insurer")
	f.as("owner")
	_, err = f.contract.ReleaseMedicalReservation(f.context, approved.ID)
	requireError(t, err, "only a rejected medical claim")

	f.context.stub.channelID = medicalCandidateChannel
	_, err = f.contract.ReleaseMedicalReservation(f.context, claim.ID)
	requireError(t, err, "development channel")
	if f.used(t) != 2_000 {
		t.Fatalf("refused releases changed coverage: %d", f.used(t))
	}
}

// Coverage used must always equal the sum of reservations not yet released.
func TestMedicalReservationCoverageInvariant(t *testing.T) {
	f := newReservationFixture(t)
	amounts := []int64{1_200, 800, 4_000, 350, 2_650}
	claims := make([]*Claim, len(amounts))
	for index, amount := range amounts {
		claims[index] = f.rejected(t, "claim-"+string(rune('a'+index)), "REJECTED", amount, func(c *Claim) { c.AppealCount = maxAppealsPerClaim })
	}
	f.at(time.Minute)
	f.as("owner")
	outstanding := int64(0)
	for _, amount := range amounts {
		outstanding += amount
	}
	for _, index := range []int{3, 0, 4} {
		_, err := f.contract.ReleaseMedicalReservation(f.context, claims[index].ID)
		requireNoError(t, err)
		outstanding -= amounts[index]
		if f.used(t) != outstanding {
			t.Fatalf("coverage %d does not equal unreleased reservations %d", f.used(t), outstanding)
		}
	}
}
