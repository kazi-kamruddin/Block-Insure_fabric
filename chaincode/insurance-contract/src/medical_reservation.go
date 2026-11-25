package insurance

import (
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// A rejected medical claim keeps its coverage reservation while it can still
// change. On the certificate channel that window is fixed at 30 days after the
// rejecting review round closes. It is a chaincode constant, not an issued
// rules field, so it is not covered by the policy terms digest.
const medicalAppealWindow = 30 * 24 * time.Hour

// medicalRejectionWindow returns when appeal or procedural recovery for the
// current rejection stops being available, and whether one is still unused.
func medicalRejectionWindow(review *ClaimReview, claim *Claim) (time.Time, bool, error) {
	closed, err := time.Parse(time.RFC3339Nano, review.ClosedAt)
	if err != nil {
		return time.Time{}, false, fmt.Errorf("rejecting review %s has no close time", review.ID)
	}
	var remaining bool
	switch review.Status {
	case "REJECTED":
		remaining = claim.AppealCount < maxAppealsPerClaim
	case "TIMED_OUT", "ACCESS_FAILED":
		remaining = !claim.MedicalRecoveryUsed
	default:
		return time.Time{}, false, fmt.Errorf("review %s is not a closed rejection", review.ID)
	}
	return closed.Add(medicalAppealWindow), remaining, nil
}

// requireOpenMedicalRejection refuses appeal or recovery once the reservation is
// released or, on the certificate channel, once the window has closed.
func requireOpenMedicalRejection(ctx contractapi.TransactionContextInterface, review *ClaimReview, claim *Claim) error {
	if claim.MedicalReserveReleasedAt != "" {
		return fmt.Errorf("the coverage reservation for this rejected claim was released")
	}
	if !usesMedicalApprovalCertificates(ctx) {
		return nil
	}
	until, _, err := medicalRejectionWindow(review, claim)
	if err != nil {
		return err
	}
	tx, err := ledgerNow(ctx)
	if err != nil {
		return fmt.Errorf("read transaction timestamp: %w", err)
	}
	if tx.After(until) {
		return fmt.Errorf("the appeal and recovery window closed at %s", until.UTC().Format(time.RFC3339))
	}
	return nil
}

// ReleaseMedicalReservation returns a finally rejected claim's reserved amount
// to the policy's remaining cover. The claimant or the insurer may call it
// once no appeal or recovery can change the rejection, either because both are
// used or because the window has closed. The claim stays REJECTED.
func (c *Contract) ReleaseMedicalReservation(ctx contractapi.TransactionContextInterface, claimID string) (*Claim, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("reservation release requires the medical development channel")
	}
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	if msp != "InsurerMSP" || (role != "insurerAdmin" && role != "policyholder") {
		return nil, fmt.Errorf("access denied: only the claimant or the insurer can release a reservation")
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if role == "policyholder" {
		subject, err := callerSubject(ctx)
		if err != nil || subject != claim.ClaimantID {
			return nil, fmt.Errorf("access denied: claim %s belongs to another policyholder", claimID)
		}
	}
	if claim.EpisodeID == "" || claim.Status != "REJECTED" || claim.CurrentReviewID == "" {
		return nil, fmt.Errorf("only a rejected medical claim can release its reservation")
	}
	if claim.MedicalReserveReleasedAt != "" {
		return nil, fmt.Errorf("the coverage reservation for claim %s was already released", claimID)
	}
	review, _, err := c.currentMedicalReview(ctx, claim.CurrentReviewID)
	if err != nil {
		return nil, err
	}
	until, remaining, err := medicalRejectionWindow(review, claim)
	if err != nil {
		return nil, err
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	current, err := time.Parse(time.RFC3339Nano, now)
	if err != nil {
		return nil, err
	}
	if remaining && !current.After(until) {
		return nil, fmt.Errorf("an appeal or recovery remains available until %s", until.UTC().Format(time.RFC3339))
	}
	coverage, err := getState[MedicalCoverage](ctx, "medicalCoverage", claim.PolicyID)
	if err != nil {
		return nil, err
	}
	if claim.AmountMinor < 0 || coverage.UsedMinor < claim.AmountMinor {
		return nil, fmt.Errorf("invalid remaining coverage state")
	}
	coverage.UsedMinor -= claim.AmountMinor
	if err := overwriteAsset(ctx, "medicalCoverage", claim.PolicyID, coverage); err != nil {
		return nil, err
	}
	claim.MedicalReserveReleasedAt, claim.UpdatedAt = now, now
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	return claim, emit(ctx, "MedicalReservationReleased", claim)
}
