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
	var certificateHash string
	if claim.EpisodeID != "" {
		if usesMedicalApprovalCertificates(ctx) {
			request, err := c.medicalApprovalRequest(ctx, claim)
			if err != nil {
				return nil, err
			}
			cert, err := c.ReadMedicalApprovalCertificate(ctx, claim.ID, claim.Version)
			if err != nil {
				return nil, fmt.Errorf("current medical approval certificate is required: %w", err)
			}
			if cert.Path == "ORACLE_AUTO" {
				if err := c.requireUsableMedicalRelease(ctx, request); err != nil {
					return nil, err
				}
			}
			cert, err = c.verifyMedicalApproval(ctx, claim)
			if err != nil {
				return nil, err
			}
			certificateHash = cert.Hash
		}
		if _, err := currentMedicalHead(ctx, claim); err != nil {
			return nil, err
		}
		policy, err := c.ReadPolicy(ctx, claim.PolicyID)
		if err != nil {
			return nil, err
		}
		if err := c.requirePaidMedicalPeriod(ctx, policy, claim.IncidentDate); err != nil {
			return nil, err
		}
		claim.MedicalSettlementID = settlementID
	}
	if _, _, err := c.validateSettlementAccounts(ctx, claim, sourceAccountID, destinationAccountID); err != nil {
		return nil, err
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	settlement := &Settlement{
		AssetType: "settlement", SchemaVersion: SchemaVersion, ID: settlementID,
		ClaimID: claimID, SourceAccountID: sourceAccountID, DestinationAccountID: destinationAccountID,
		ApprovalCertificateHash: certificateHash,
		AmountMinor:             claim.AmountMinor, Currency: "BDT", Status: "AUTHORIZED", AuthorizedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "settlement", settlementID, settlement); err != nil {
		return nil, err
	}
	liability := &Liability{
		AssetType: "liability", SchemaVersion: SchemaVersion, ID: "liability-claim-" + claimID,
		SourceType: "CLAIM", SourceID: claimID, PolicyID: claim.PolicyID,
		AmountMinor: claim.AmountMinor, Status: "PAYMENT_READY", CreatedAt: now, UpdatedAt: now,
	}
	if err := c.createClaimLiability(ctx, claim, liability); err != nil {
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
	if err := c.requireBankAccountSubject(ctx, settlement.SourceAccountID); err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, settlement.ClaimID)
	if err != nil {
		return nil, err
	}
	var execution *medicalBankExecution
	if claim.EpisodeID != "" {
		if claim.MedicalSettlementID != settlement.ID || claim.Status != "SETTLEMENT_AUTHORIZED" || claim.AmountMinor != settlement.AmountMinor {
			return nil, fmt.Errorf("settlement belongs to a superseded medical claim version")
		}
		if usesMedicalApprovalCertificates(ctx) {
			execution, err = readMedicalBankExecution(ctx, settlement.ID)
			if err != nil {
				return nil, err
			}
			var cert *ApprovalCertificate
			if execution != nil {
				// Execution already verified the source revision, paid period and
				// certificate. Confirm the same effective authorization even if
				// the hospital has since published another episode revision.
				cert, err = c.ReadMedicalApprovalCertificate(ctx, claim.ID, claim.Version)
			} else {
				cert, err = c.verifyMedicalApproval(ctx, claim)
			}
			if err != nil {
				return nil, err
			}
			if cert.SupersededBy != "" || cert.ClaimID != claim.ID || cert.ClaimVersion != claim.Version ||
				cert.Hash != settlement.ApprovalCertificateHash || cert.Currency != settlement.Currency {
				return nil, fmt.Errorf("settlement has no matching effective medical approval certificate")
			}
			if cert.Path == "ORACLE_AUTO" {
				request, err := c.medicalApprovalRequest(ctx, claim)
				if err != nil {
					return nil, err
				}
				held, err := c.heldMedicalRequest(ctx, request)
				if err != nil {
					return nil, err
				}
				if held && execution == nil {
					return nil, fmt.Errorf("model held; settlement requires review")
				}
				settlement.PostPaymentAuditRequired = held
			}
		}
		if execution == nil {
			if _, err := currentMedicalHead(ctx, claim); err != nil {
				return nil, err
			}
			policy, err := c.ReadPolicy(ctx, claim.PolicyID)
			if err != nil {
				return nil, err
			}
			if err := c.requirePaidMedicalPeriod(ctx, policy, claim.IncidentDate); err != nil {
				return nil, err
			}
		}
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	var transfer *BankTransfer
	if execution != nil {
		if execution.Status != "EXECUTED" || execution.TransferID != transferID || execution.ReferenceHash != strings.ToLower(bankReferenceHash) ||
			execution.CertificateHash != settlement.ApprovalCertificateHash {
			return nil, fmt.Errorf("confirmation does not match the executed private Bank transfer")
		}
		transfer, err = c.ReadBankTransfer(ctx, transferID)
		if err != nil || transfer.Status != "SETTLED" || transfer.SettlementID != settlement.ID ||
			transfer.AmountMinor != settlement.AmountMinor || transfer.SourceAccountID != settlement.SourceAccountID ||
			transfer.DestinationAccountID != settlement.DestinationAccountID || transfer.ExternalReferenceHash != execution.ReferenceHash {
			return nil, fmt.Errorf("executed Bank transfer does not match the settlement")
		}
	} else {
		transfer, err = c.executeSettlementTransfer(ctx, claim, settlement, transferID, bankReferenceHash, now)
		if err != nil {
			return nil, err
		}
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
		if err := emitSettlementOutcome(ctx, "SettlementPaymentFailed", settlement, claim); err != nil {
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
	if err := emitSettlementOutcome(ctx, "SettlementConfirmed", settlement, claim); err != nil {
		return nil, err
	}
	return settlement, nil
}

func (c *Contract) executeSettlementTransfer(ctx contractapi.TransactionContextInterface, claim *Claim, settlement *Settlement, transferID, referenceHash, now string) (*BankTransfer, error) {
	source, destination, err := c.validateSettlementAccounts(ctx, claim, settlement.SourceAccountID, settlement.DestinationAccountID)
	if err != nil {
		return nil, err
	}
	if err := c.requireBankSubject(ctx, source.BankID); err != nil {
		return nil, err
	}
	transfer := &BankTransfer{
		AssetType: "bankTransfer", SchemaVersion: SchemaVersion, ID: transferID,
		BankID: source.BankID, SourceAccountID: source.ID, DestinationAccountID: destination.ID,
		PolicyID: claim.PolicyID, SettlementID: settlement.ID, AmountMinor: settlement.AmountMinor,
		Currency: "BDT", Method: "CLAIM_PAYOUT", ExternalReferenceHash: strings.ToLower(referenceHash), CreatedAt: now,
	}
	if err := c.settlePremiumTransfer(ctx, transfer, source, destination); err != nil {
		return nil, err
	}
	return transfer, nil
}

type medicalBankExecution struct {
	Status          string `json:"status"`
	TransferID      string `json:"transferId"`
	ReferenceHash   string `json:"referenceHash"`
	CertificateHash string `json:"certificateHash"`
}

func readMedicalBankExecution(ctx contractapi.TransactionContextInterface, settlementID string) (*medicalBankExecution, error) {
	key, err := stateKey(ctx, "medicalBankExecution", settlementID)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetPrivateData(bankInsurerPrivateCollection, key)
	if err != nil || len(raw) == 0 {
		return nil, err
	}
	var execution medicalBankExecution
	if err := json.Unmarshal(raw, &execution); err != nil {
		return nil, err
	}
	return &execution, nil
}

// ExecuteMedicalSettlementTransfer records the optional two-stage Bank flow.
// The normal ConfirmSettlement flow remains a single atomic debit and close.
func (c *Contract) ExecuteMedicalSettlementTransfer(ctx contractapi.TransactionContextInterface, settlementID, transferID, bankReferenceHash string) (*BankTransfer, error) {
	if _, err := requireIdentity(ctx, "BankMSP", "bankOfficer"); err != nil {
		return nil, err
	}
	if !usesMedicalApprovalCertificates(ctx) || !oracleV2Hash.MatchString(bankReferenceHash) {
		return nil, fmt.Errorf("invalid medical transfer execution")
	}
	settlement, err := c.ReadSettlement(ctx, settlementID)
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, settlement.ClaimID)
	if err != nil {
		return nil, err
	}
	if settlement.Status != "AUTHORIZED" || claim.EpisodeID == "" || claim.Status != "SETTLEMENT_AUTHORIZED" ||
		claim.MedicalSettlementID != settlementID || claim.AmountMinor != settlement.AmountMinor {
		return nil, fmt.Errorf("settlement is not eligible for medical transfer execution")
	}
	cert, err := c.verifyMedicalApproval(ctx, claim)
	if err != nil {
		return nil, err
	}
	if cert.Hash != settlement.ApprovalCertificateHash || cert.Currency != settlement.Currency {
		return nil, fmt.Errorf("settlement does not match its medical certificate")
	}
	if cert.Path == "ORACLE_AUTO" {
		request, err := c.medicalApprovalRequest(ctx, claim)
		if err != nil {
			return nil, err
		}
		if err := c.requireUsableMedicalRelease(ctx, request); err != nil {
			return nil, err
		}
	}
	if previous, err := readMedicalBankExecution(ctx, settlementID); err != nil || previous != nil {
		return nil, fmt.Errorf("medical settlement transfer already executed or is unavailable")
	}
	policy, err := c.ReadPolicy(ctx, claim.PolicyID)
	if err != nil {
		return nil, err
	}
	if err := c.requirePaidMedicalPeriod(ctx, policy, claim.IncidentDate); err != nil {
		return nil, err
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	transfer, err := c.executeSettlementTransfer(ctx, claim, settlement, transferID, bankReferenceHash, now)
	if err != nil {
		return nil, err
	}
	if transfer.Status != "SETTLED" {
		return nil, fmt.Errorf("Bank did not execute the medical settlement transfer")
	}
	key, err := stateKey(ctx, "medicalBankExecution", settlementID)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(medicalBankExecution{Status: "EXECUTED", TransferID: transferID, ReferenceHash: bankReferenceHash, CertificateHash: cert.Hash})
	if err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutPrivateData(bankInsurerPrivateCollection, key, raw); err != nil {
		return nil, err
	}
	return transfer, nil
}

func emitSettlementOutcome(ctx contractapi.TransactionContextInterface, name string, settlement *Settlement, claim *Claim) error {
	// The terminal settlement event replaces BankTransferProcessed in this
	// transaction, so it must carry the policy and recipient for delivery.
	return emit(ctx, name, struct {
		*Settlement
		PolicyID   string `json:"policyId"`
		ClaimantID string `json:"claimantId"`
	}{settlement, claim.PolicyID, claim.ClaimantID})
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
