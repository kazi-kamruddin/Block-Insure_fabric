package insurance

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// Bind source provenance without an insurer verdict. Keep the existing
// HospitalVerification field for historical requests and protocol compatibility.
// SOURCE_BOUND never means that the claim matches the invoice.
func (c *Contract) bindOracleInvoice(ctx contractapi.TransactionContextInterface, claim *Claim, requestID string) (*HospitalVerification, error) {
	if claim.Status != "SUBMITTED" && claim.Status != "APPEAL_SUBMITTED" && claim.Status != "HOSPITAL_VERIFIED" {
		return nil, fmt.Errorf("claim %s is not ready for Oracle verification", claim.ID)
	}
	invoice, err := c.ReadHospitalInvoice(ctx, claim.HospitalInvoiceID)
	if err != nil {
		return nil, err
	}
	if invoice.PatientReferenceHash != patientSubjectHash(claim.ClaimantID) {
		return nil, fmt.Errorf("hospital invoice patient does not match this policyholder")
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	binding := &HospitalVerification{
		AssetType: "hospitalVerification", SchemaVersion: SchemaVersion,
		ID: "oracle-invoice-" + patientSubjectHash(requestID), ClaimID: claim.ID,
		ClaimVersion: claim.Version, AppealID: claim.CurrentAppealID,
		HospitalIdentity: invoice.HospitalID, Outcome: "SOURCE_BOUND",
		ClinicalReferenceHash: invoice.InvoiceReferenceHash, CreatedAt: now,
	}
	binding.AttestationHash = canonicalProtocolHash("block-insure-invoice-binding-v1",
		claim.ID, strconv.Itoa(claim.Version), invoice.ID, invoice.HospitalID,
		invoice.PatientReferenceHash, invoice.InvoiceReferenceHash, invoice.Status)
	if claim.CurrentAppealID != "" {
		appeal, err := c.ReadClaimAppeal(ctx, claim.CurrentAppealID)
		if err != nil {
			return nil, err
		}
		if (appeal.Status != "SUBMITTED" && appeal.Status != "HOSPITAL_VERIFIED") || appeal.ClaimVersion != claim.Version || appeal.CommitmentHash != appealCommitmentHash(appeal) || !strings.EqualFold(appeal.ProposedClinicalReferenceHash, invoice.InvoiceReferenceHash) {
			return nil, fmt.Errorf("appeal %s commitment is stale or invalid", appeal.ID)
		}
	}
	if err := putState(ctx, "hospitalVerification", binding.ID, binding); err != nil {
		return nil, err
	}
	claim.HospitalVerificationID = binding.ID
	return binding, nil
}
