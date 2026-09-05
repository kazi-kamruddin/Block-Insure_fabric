package insurance

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (c *Contract) RecordAuditorDecision(ctx contractapi.TransactionContextInterface, claimID, decisionID, outcome, reasonHash string) (*AuditorDecision, error) {
	auditorID, err := requireIdentity(ctx, "AuditorMSP", "auditor")
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "UNDER_REVIEW" {
		return nil, fmt.Errorf("claim %s must be UNDER_REVIEW for an auditor decision", claimID)
	}
	outcome = strings.ToUpper(strings.TrimSpace(outcome))
	if outcome != "APPROVE" && outcome != "REJECT" {
		return nil, fmt.Errorf("outcome must be APPROVE or REJECT")
	}
	if err := validateHash("reasonHash", reasonHash); err != nil {
		return nil, err
	}
	key, err := decisionKey(ctx, claimID, auditorID)
	if err != nil {
		return nil, err
	}
	existing, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, fmt.Errorf("check auditor decision: %w", err)
	}
	if existing != nil {
		return nil, fmt.Errorf("auditor has already decided claim %s", claimID)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	decision := &AuditorDecision{
		AssetType: "auditorDecision", SchemaVersion: SchemaVersion, ID: decisionID,
		ClaimID: claimID, AuditorIdentity: auditorID, Outcome: outcome,
		ReasonHash: strings.ToLower(reasonHash), CreatedAt: now,
	}
	payload, err := json.Marshal(decision)
	if err != nil {
		return nil, fmt.Errorf("encode auditor decision: %w", err)
	}
	if err := ctx.GetStub().PutState(key, payload); err != nil {
		return nil, fmt.Errorf("write auditor decision: %w", err)
	}
	if outcome == "APPROVE" {
		claim.Status = "APPROVED"
	} else {
		claim.Status = "REJECTED"
	}
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claim", claimID, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "AuditorDecisionRecorded", decision); err != nil {
		return nil, err
	}
	return decision, nil
}

func (c *Contract) AuthorizeSettlement(ctx contractapi.TransactionContextInterface, settlementID, claimID string) (*Settlement, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "APPROVED" {
		return nil, fmt.Errorf("claim %s must be APPROVED to authorize settlement", claimID)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	settlement := &Settlement{
		AssetType: "settlement", SchemaVersion: SchemaVersion, ID: settlementID,
		ClaimID: claimID, AmountMinor: claim.AmountMinor, Status: "AUTHORIZED", AuthorizedAt: now,
	}
	if err := putState(ctx, "settlement", settlementID, settlement); err != nil {
		return nil, err
	}
	claim.Status = "SETTLEMENT_AUTHORIZED"
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claim", claimID, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "SettlementAuthorized", settlement); err != nil {
		return nil, err
	}
	return settlement, nil
}

func (c *Contract) ConfirmSettlement(ctx contractapi.TransactionContextInterface, settlementID, bankReferenceHash string) (*Settlement, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	if err := validateHash("bankReferenceHash", bankReferenceHash); err != nil {
		return nil, err
	}
	settlement, err := c.ReadSettlement(ctx, settlementID)
	if err != nil {
		return nil, err
	}
	if settlement.Status != "AUTHORIZED" {
		return nil, fmt.Errorf("settlement %s must be AUTHORIZED to confirm", settlementID)
	}
	claim, err := c.ReadClaim(ctx, settlement.ClaimID)
	if err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	settlement.Status = "CONFIRMED"
	settlement.BankReferenceHash = strings.ToLower(bankReferenceHash)
	settlement.ConfirmedAt = now
	if err := overwriteAsset(ctx, "settlement", settlementID, settlement); err != nil {
		return nil, err
	}
	claim.Status = "SETTLED"
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "SettlementConfirmed", settlement); err != nil {
		return nil, err
	}
	return settlement, nil
}

func (c *Contract) ReadClaim(ctx contractapi.TransactionContextInterface, id string) (*Claim, error) {
	return getState[Claim](ctx, "claim", id)
}

func (c *Contract) ReadEvidenceReference(ctx contractapi.TransactionContextInterface, id string) (*EvidenceReference, error) {
	return getState[EvidenceReference](ctx, "evidenceReference", id)
}

func (c *Contract) ReadSettlement(ctx contractapi.TransactionContextInterface, id string) (*Settlement, error) {
	return getState[Settlement](ctx, "settlement", id)
}

func (c *Contract) GetClaimHistory(ctx contractapi.TransactionContextInterface, id string) ([]HistoryRecord, error) {
	key, err := stateKey(ctx, "claim", id)
	if err != nil {
		return nil, err
	}
	iterator, err := ctx.GetStub().GetHistoryForKey(key)
	if err != nil {
		return nil, fmt.Errorf("read claim history: %w", err)
	}
	defer iterator.Close()

	history := make([]HistoryRecord, 0)
	for iterator.HasNext() {
		entry, err := iterator.Next()
		if err != nil {
			return nil, fmt.Errorf("iterate claim history: %w", err)
		}
		record := HistoryRecord{
			TxID:      entry.TxId,
			Timestamp: entry.Timestamp.AsTime().UTC().Format("2006-01-02T15:04:05.999999999Z07:00"),
			IsDelete:  entry.IsDelete,
		}
		if !entry.IsDelete {
			var value Claim
			if err := json.Unmarshal(entry.Value, &value); err != nil {
				return nil, fmt.Errorf("decode claim history: %w", err)
			}
			record.Value = &value
		}
		history = append(history, record)
	}
	return history, nil
}
