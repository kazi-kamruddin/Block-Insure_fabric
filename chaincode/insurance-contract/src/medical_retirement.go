package insurance

import (
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (c *Contract) RetireInvalidatedApproval(ctx contractapi.TransactionContextInterface, claimID, reasonHash string) (*Claim, error) {
	if !usesMedicalApprovalCertificates(ctx) || !oracleV2Hash.MatchString(reasonHash) {
		return nil, fmt.Errorf("medical dev-lite and an approval retirement reason hash are required")
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if err := requireEligibleClaimDeadlineActor(ctx, claim, nil); err != nil {
		return nil, err
	}
	if claim.MedicalRetirementHash != "" {
		if claim.MedicalRetirementHash == reasonHash {
			return claim, nil
		}
		return nil, fmt.Errorf("approval has already been invalidated")
	}
	if claim.EpisodeID == "" || claim.MedicalReserveReleasedAt != "" ||
		(claim.Status != "APPROVED" && claim.Status != "SETTLEMENT_AUTHORIZED") {
		return nil, fmt.Errorf("only an unpaid medical approval may be retired")
	}
	cert, err := c.ReadMedicalApprovalCertificate(ctx, claim.ID, claim.Version)
	if err != nil {
		return nil, err
	}
	if cert.SupersededBy != "" {
		return nil, fmt.Errorf("only the effective approval may be retired")
	}
	head, err := medicalEpisodeHead(ctx, claim.EpisodeID)
	if err != nil {
		return nil, err
	}
	association, err := getPrivateState[MedicalAssociation](ctx, "medicalAssociation", claim.MedicalAssociationKey)
	if err != nil {
		return nil, err
	}
	if head.Revision == claim.EpisodeRevision && association.Verified && association.BeneficiaryID == claim.ClaimantID {
		return nil, fmt.Errorf("approval is still supported by the current episode and patient association")
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	if claim.MedicalSettlementID != "" {
		settlement, err := c.ReadSettlement(ctx, claim.MedicalSettlementID)
		if err != nil {
			return nil, err
		}
		if settlement.ClaimID != claim.ID || settlement.ConfirmedAt != "" ||
			(settlement.Status != "AUTHORIZED" && settlement.Status != "PAYMENT_FAILED") {
			return nil, fmt.Errorf("only an unpaid settlement may be retired")
		}
		if executed, err := medicalBankExecutionExists(ctx, settlement.ID); err != nil || executed {
			return nil, fmt.Errorf("an executed Bank transfer must be confirmed")
		}
		if settlement.TransferID != "" {
			transfer, err := c.ReadBankTransfer(ctx, settlement.TransferID)
			if err != nil || transfer.Status != "BOUNCED" {
				return nil, fmt.Errorf("a completed or unavailable transfer prevents retirement")
			}
		}
		liability, err := c.ReadLiability(ctx, "liability-claim-"+claim.ID)
		if err != nil {
			return nil, err
		}
		if liability.SourceID != claim.ID || liability.Status != "PAYMENT_READY" {
			return nil, fmt.Errorf("only an unpaid liability may be retired")
		}
		settlement.Status, settlement.UpdatedAt = "RETIRED", now
		liability.Status, liability.UpdatedAt = "RETIRED", now
		if err := overwriteAsset(ctx, "settlement", settlement.ID, settlement); err != nil {
			return nil, err
		}
		if err := overwriteAsset(ctx, "liability", liability.ID, liability); err != nil {
			return nil, err
		}
	}
	coverage, err := getState[MedicalCoverage](ctx, "medicalCoverage", claim.PolicyID)
	if err != nil {
		return nil, err
	}
	if claim.AmountMinor <= 0 || coverage.UsedMinor < claim.AmountMinor {
		return nil, fmt.Errorf("invalid remaining coverage state")
	}
	coverage.UsedMinor -= claim.AmountMinor
	if err := overwriteAsset(ctx, "medicalCoverage", claim.PolicyID, coverage); err != nil {
		return nil, err
	}
	if err := putState(ctx, "medicalCertificateSupersession", cert.Hash, "RETIRED:"+reasonHash); err != nil {
		return nil, err
	}
	claim.MedicalRetirementHash, claim.MedicalReserveReleasedAt = reasonHash, now
	claim.Status, claim.UpdatedAt = "MEDICAL_REVIEW_REQUIRED", now
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	return claim, emit(ctx, "MedicalApprovalRetired", claim)
}
