package insurance

import (
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const medicalAppealNoteRetention = 365 * 24 * time.Hour

type MedicalNoteDisposal struct {
	AppealID     string `json:"appealId"`
	ClaimID      string `json:"claimId"`
	SettlementID string `json:"settlementId"`
	PreviousHash string `json:"previousHash"`
	EligibleAt   string `json:"eligibleAt"`
	PurgedAt     string `json:"purgedAt"`
}

func (c *Contract) medicalAppealNoteDisposal(ctx contractapi.TransactionContextInterface, id string) (*MedicalNoteDisposal, string, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, "", fmt.Errorf("appeal-note disposal requires dev-lite")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, "", err
	}
	appeal, err := c.ReadClaimAppeal(ctx, id)
	if err != nil {
		return nil, "", err
	}
	claim, err := c.ReadClaim(ctx, appeal.ClaimID)
	if err != nil {
		return nil, "", err
	}
	if appeal.Status != "OVERTURNED" || claim.Status != "SETTLED" || claim.EpisodeID == "" ||
		appeal.ClaimVersion != claim.Version || claim.CurrentAppealID != id || claim.MedicalSettlementID == "" {
		return nil, "", fmt.Errorf("only an overturned appeal on a settled medical claim is eligible")
	}
	settlement, err := c.ReadSettlement(ctx, claim.MedicalSettlementID)
	if err != nil {
		return nil, "", err
	}
	if settlement.Status != "CONFIRMED" || settlement.ClaimID != claim.ID || settlement.ApprovalCertificateHash == "" {
		return nil, "", fmt.Errorf("confirmed certificate-backed settlement required")
	}
	confirmed, err := time.Parse(time.RFC3339Nano, settlement.ConfirmedAt)
	if err != nil {
		return nil, "", err
	}
	key, err := privateStateKey(ctx, "medicalAppealExplanation", id)
	if err != nil {
		return nil, "", err
	}
	hash, err := ctx.GetStub().GetPrivateDataHash(oracleProofCollection, key)
	if err != nil {
		return nil, "", err
	}
	if len(hash) != 32 {
		return nil, "", fmt.Errorf("appeal note has no available private-state hash")
	}
	return &MedicalNoteDisposal{AppealID: id, ClaimID: claim.ID, SettlementID: settlement.ID,
		PreviousHash: hex.EncodeToString(hash), EligibleAt: confirmed.Add(medicalAppealNoteRetention).Format(time.RFC3339Nano)}, key, nil
}

func (c *Contract) PlanMedicalAppealNoteDisposal(ctx contractapi.TransactionContextInterface, id string) (*MedicalNoteDisposal, error) {
	plan, _, err := c.medicalAppealNoteDisposal(ctx, id)
	return plan, err
}

func (c *Contract) PurgeMedicalAppealNote(ctx contractapi.TransactionContextInterface, id, expectedHash string) (*MedicalNoteDisposal, error) {
	plan, key, err := c.medicalAppealNoteDisposal(ctx, id)
	if err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	eligible, err := time.Parse(time.RFC3339Nano, plan.EligibleAt)
	if err != nil || now.Before(eligible) {
		return nil, fmt.Errorf("appeal-note retention window has not elapsed")
	}
	if !strings.EqualFold(expectedHash, plan.PreviousHash) {
		return nil, fmt.Errorf("disposal requires the exact current private-state hash")
	}
	plan.PurgedAt = now.UTC().Format(time.RFC3339Nano)
	if err := putState(ctx, "medicalNoteDisposal", id, plan); err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PurgePrivateData(oracleProofCollection, key); err != nil {
		return nil, err
	}
	return plan, emit(ctx, "MedicalAppealNotePurged", plan)
}
