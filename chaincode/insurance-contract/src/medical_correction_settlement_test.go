package insurance

import (
	"strings"
	"testing"
)

// Without approval certificates a correction cannot supersede an authorized
// settlement and liability, so it must be refused before any state changes.
func TestMedicalCorrectionRefusedAfterSettlementWithoutCertificates(t *testing.T) {
	contract, ctx := medicalTestContext()
	claim := &Claim{ID: "authorized-claim", PolicyID: "policy", ClaimantID: "owner", EpisodeID: strings.Repeat("e", 64),
		EpisodeRevision: 1, Version: 1, Status: "SETTLEMENT_AUTHORIZED", AmountMinor: 4_000, MedicalSettlementID: "settlement"}
	requireNoError(t, putState(ctx, "claim", claim.ID, claim))
	setIdentity(ctx, "owner", "InsurerMSP", "policyholder", map[string]string{"subjectId": "owner"})

	_, err := contract.QuoteMedicalCorrection(ctx, claim.ID, 2)
	requireError(t, err, "settlement is already authorized")
	_, err = contract.AcceptMedicalCorrection(ctx, claim.ID, 2, strings.Repeat("a", 64))
	requireError(t, err, "settlement is already authorized")

	stored, err := contract.ReadClaim(ctx, claim.ID)
	requireNoError(t, err)
	if stored.Version != 1 || stored.MedicalSettlementID != "settlement" || stored.Status != "SETTLEMENT_AUTHORIZED" {
		t.Fatalf("refused correction changed the claim: %+v", stored)
	}
}
