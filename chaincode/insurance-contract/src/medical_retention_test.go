package insurance

import (
	"crypto/sha256"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *memoryStub) GetPrivateDataHash(collection, key string) ([]byte, error) {
	value, err := s.GetPrivateData(collection, key)
	if err != nil || value == nil {
		return nil, err
	}
	digest := sha256.Sum256(value)
	return digest[:], nil
}

func (s *memoryStub) PurgePrivateData(collection, key string) error {
	delete(s.privateState[collection], key)
	return nil
}

func TestDevLiteTerminalAppealNoteRetention(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	c, ctx := f.contract, f.context
	_, err := f.authorize()
	requireNoError(t, err)
	settled, err := f.confirm("retention-payment")
	requireNoError(t, err)
	claim, err := c.ReadClaim(ctx, f.claim.ID)
	requireNoError(t, err)
	claim.CurrentAppealID = "retention-appeal"
	requireNoError(t, overwriteAsset(ctx, "claim", claim.ID, claim))
	requireNoError(t, putState(ctx, "claimAppeal", claim.CurrentAppealID,
		&ClaimAppeal{ID: claim.CurrentAppealID, ClaimID: claim.ID, ClaimVersion: claim.Version, ClaimantID: claim.ClaimantID, Status: "OVERTURNED"}))
	requireNoError(t, putPrivateState(ctx, "medicalAppealExplanation", claim.CurrentAppealID, &MedicalAppealExplanation{Text: "synthetic-envelope"}))
	_, err = c.PlanMedicalAppealNoteDisposal(ctx, claim.CurrentAppealID)
	requireError(t, err, "access denied")
	setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
	plan, err := c.PlanMedicalAppealNoteDisposal(ctx, claim.CurrentAppealID)
	requireNoError(t, err)
	_, err = c.PurgeMedicalAppealNote(ctx, claim.CurrentAppealID, plan.PreviousHash)
	requireError(t, err, "retention window")
	eligible, err := time.Parse(time.RFC3339Nano, plan.EligibleAt)
	requireNoError(t, err)
	ctx.stub.timestamp = timestamppb.New(eligible)
	_, err = c.PurgeMedicalAppealNote(ctx, claim.CurrentAppealID, strings.Repeat("e", 64))
	requireError(t, err, "exact current")
	disposed, err := c.PurgeMedicalAppealNote(ctx, claim.CurrentAppealID, plan.PreviousHash)
	requireNoError(t, err)
	explanation, err := c.ReadMedicalAppealExplanation(ctx, claim.CurrentAppealID)
	requireNoError(t, err)
	cert, err := c.ReadMedicalApprovalCertificate(ctx, claim.ID, claim.Version)
	requireNoError(t, err)
	if !explanation.Purged || explanation.Text != "" || disposed.PreviousHash != plan.PreviousHash ||
		cert.Hash != settled.ApprovalCertificateHash || cert.AmountMinor != settled.AmountMinor {
		t.Fatal("purge did not preserve the public receipt or untouched settlement evidence")
	}
}
