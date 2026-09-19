package insurance

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (c *Contract) AuthorizeSettlement(ctx contractapi.TransactionContextInterface, settlementID, claimID, sourceAccountID, destinationAccountID string) (*Settlement, error) {
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
	if _, _, err := c.validateSettlementAccounts(ctx, claim, sourceAccountID, destinationAccountID); err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	settlement := &Settlement{
		AssetType: "settlement", SchemaVersion: SchemaVersion, ID: settlementID,
		ClaimID: claimID, SourceAccountID: sourceAccountID, DestinationAccountID: destinationAccountID,
		AmountMinor: claim.AmountMinor, Currency: "BDT", Status: "AUTHORIZED", AuthorizedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "settlement", settlementID, settlement); err != nil {
		return nil, err
	}
	liability := &Liability{
		AssetType: "liability", SchemaVersion: SchemaVersion, ID: "liability-claim-" + claimID,
		SourceType: "CLAIM", SourceID: claimID, PolicyID: claim.PolicyID,
		AmountMinor: claim.AmountMinor, Status: "PAYMENT_READY", CreatedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "liability", liability.ID, liability); err != nil {
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

func (c *Contract) validateSettlementAccounts(ctx contractapi.TransactionContextInterface, claim *Claim, sourceAccountID, destinationAccountID string) (*BankAccountReference, *BankAccountReference, error) {
	source, err := c.ReadBankAccountReference(ctx, sourceAccountID)
	if err != nil {
		return nil, nil, err
	}
	destination, err := c.ReadBankAccountReference(ctx, destinationAccountID)
	if err != nil {
		return nil, nil, err
	}
	if source.Status != "VERIFIED" || destination.Status != "VERIFIED" || source.BankID == "" || source.BankID != destination.BankID {
		return nil, nil, fmt.Errorf("settlement accounts must be verified accounts at the same contracted bank")
	}
	if source.AccountType != "INSURER" || source.OwnerID != "insurer" {
		return nil, nil, fmt.Errorf("settlement source must be an insurer account")
	}
	if destination.AccountType != "CUSTOMER" || destination.OwnerID != claim.ClaimantID {
		return nil, nil, fmt.Errorf("settlement destination must belong to the claimant")
	}
	policy, err := c.ReadPolicy(ctx, claim.PolicyID)
	if err != nil {
		return nil, nil, err
	}
	if !slices.Contains(policy.BankIDs, source.BankID) {
		return nil, nil, fmt.Errorf("bank %s is not in policy %s's partner network", source.BankID, policy.ID)
	}
	if _, err := c.requireActivePartner(ctx, "BANK", source.BankID); err != nil {
		return nil, nil, err
	}
	return source, destination, nil
}

func (c *Contract) ConfirmSettlement(ctx contractapi.TransactionContextInterface, settlementID, transferID, bankReferenceHash string) (*Settlement, error) {
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
	if settlement.Status != "AUTHORIZED" && settlement.Status != "PAYMENT_FAILED" {
		return nil, fmt.Errorf("settlement %s must be AUTHORIZED or PAYMENT_FAILED to confirm", settlementID)
	}
	claim, err := c.ReadClaim(ctx, settlement.ClaimID)
	if err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	source, destination, err := c.validateSettlementAccounts(ctx, claim, settlement.SourceAccountID, settlement.DestinationAccountID)
	if err != nil {
		return nil, err
	}
	transfer := &BankTransfer{
		AssetType: "bankTransfer", SchemaVersion: SchemaVersion, ID: transferID,
		BankID: source.BankID, SourceAccountID: source.ID, DestinationAccountID: destination.ID,
		PolicyID: claim.PolicyID, SettlementID: settlement.ID, AmountMinor: settlement.AmountMinor,
		Currency: "BDT", Method: "CLAIM_PAYOUT", ExternalReferenceHash: strings.ToLower(bankReferenceHash), CreatedAt: now,
	}
	if err := c.settlePremiumTransfer(ctx, transfer, source, destination); err != nil {
		return nil, err
	}
	settlement.TransferID = transfer.ID
	settlement.BankReferenceHash = strings.ToLower(bankReferenceHash)
	settlement.UpdatedAt = now
	if transfer.Status == "BOUNCED" {
		settlement.Status = "PAYMENT_FAILED"
		settlement.FailureCode = transfer.FailureCode
		if err := overwriteAsset(ctx, "settlement", settlementID, settlement); err != nil {
			return nil, err
		}
		if err := emit(ctx, "SettlementPaymentFailed", settlement); err != nil {
			return nil, err
		}
		return settlement, nil
	}
	settlement.Status = "CONFIRMED"
	settlement.FailureCode = ""
	settlement.ConfirmedAt = now
	if err := overwriteAsset(ctx, "settlement", settlementID, settlement); err != nil {
		return nil, err
	}
	claim.Status = "SETTLED"
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	liability, err := c.ReadLiability(ctx, "liability-claim-"+claim.ID)
	if err != nil {
		return nil, err
	}
	liability.Status = "PAID"
	liability.BankReferenceHash = settlement.BankReferenceHash
	liability.UpdatedAt = now
	if err := overwriteAsset(ctx, "liability", liability.ID, liability); err != nil {
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

func (c *Contract) ReadEvidenceAccessGrant(ctx contractapi.TransactionContextInterface, id string) (*EvidenceAccessGrant, error) {
	return getState[EvidenceAccessGrant](ctx, "evidenceGrant", id)
}

func (c *Contract) ReadHospitalVerification(ctx contractapi.TransactionContextInterface, id string) (*HospitalVerification, error) {
	return getState[HospitalVerification](ctx, "hospitalVerification", id)
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
