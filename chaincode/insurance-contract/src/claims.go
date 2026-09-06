package insurance

import (
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (c *Contract) SubmitClaim(ctx contractapi.TransactionContextInterface, id, policyID string, amountMinor int64, incidentDate, descriptionHash string) (*Claim, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	claimantID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	policy, err := c.ReadPolicy(ctx, policyID)
	if err != nil {
		return nil, err
	}
	if policy.Status != "ACTIVE" && policy.Status != "GRACE" && policy.Status != "EXPIRED" {
		return nil, fmt.Errorf("policy %s was not eligible for claims in its coverage period", policyID)
	}
	if policy.PolicyholderID != claimantID {
		return nil, fmt.Errorf("access denied: policy %s belongs to another policyholder", policyID)
	}
	if amountMinor <= 0 || amountMinor > policy.CoverageLimitMinor {
		return nil, fmt.Errorf("claim amount must be positive and within the policy coverage limit")
	}
	incident, err := validateDate("incidentDate", incidentDate)
	if err != nil {
		return nil, err
	}
	start, _ := validateDate("startDate", policy.StartDate)
	end, _ := validateDate("endDate", policy.EndDate)
	if incident.Before(start) || incident.After(end) {
		return nil, fmt.Errorf("incidentDate is outside the policy coverage period")
	}
	if err := validateHash("descriptionHash", descriptionHash); err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	claim := &Claim{
		AssetType: "claim", SchemaVersion: SchemaVersion, ID: id, PolicyID: policyID,
		ClaimantID: claimantID, AmountMinor: amountMinor, IncidentDate: incidentDate,
		DescriptionHash: strings.ToLower(descriptionHash), EvidenceIDs: []string{},
		Version: 1, Status: "SUBMITTED", CreatedAt: now, UpdatedAt: now,
	}
	if err := putState(ctx, "claim", id, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "ClaimSubmitted", claim); err != nil {
		return nil, err
	}
	return claim, nil
}

func (c *Contract) AddEvidenceReference(ctx contractapi.TransactionContextInterface, claimID, evidenceID, documentType, contentHash, storageReferenceHash string) (*EvidenceReference, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.ClaimantID != subject {
		return nil, fmt.Errorf("access denied: claim %s belongs to another policyholder", claimID)
	}
	if claim.Status != "SUBMITTED" {
		return nil, fmt.Errorf("evidence can only be added while claim %s is SUBMITTED", claimID)
	}
	if strings.TrimSpace(documentType) == "" {
		return nil, fmt.Errorf("documentType is required")
	}
	if err := validateHash("contentHash", contentHash); err != nil {
		return nil, err
	}
	if err := validateHash("storageReferenceHash", storageReferenceHash); err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	evidence := &EvidenceReference{
		AssetType: "evidenceReference", SchemaVersion: SchemaVersion, ID: evidenceID,
		ClaimID: claimID, DocumentType: strings.TrimSpace(documentType),
		ContentHash: strings.ToLower(contentHash), StorageReferenceHash: strings.ToLower(storageReferenceHash),
		SubmittedBy: subject, CreatedAt: now,
	}
	if err := putState(ctx, "evidenceReference", evidenceID, evidence); err != nil {
		return nil, err
	}
	claim.EvidenceIDs = append(claim.EvidenceIDs, evidenceID)
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claim", claimID, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "EvidenceReferenceAdded", evidence); err != nil {
		return nil, err
	}
	return evidence, nil
}

func (c *Contract) VerifyClaim(ctx contractapi.TransactionContextInterface, claimID, verificationID, outcome, clinicalReferenceHash string) (*HospitalVerification, error) {
	hospitalID, err := requireIdentity(ctx, "HospitalMSP", "hospitalOfficer")
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "SUBMITTED" {
		return nil, fmt.Errorf("claim %s must be SUBMITTED for hospital verification", claimID)
	}
	outcome = strings.ToUpper(strings.TrimSpace(outcome))
	if outcome != "VERIFIED" && outcome != "INVALID" {
		return nil, fmt.Errorf("outcome must be VERIFIED or INVALID")
	}
	if err := validateHash("clinicalReferenceHash", clinicalReferenceHash); err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	verification := &HospitalVerification{
		AssetType: "hospitalVerification", SchemaVersion: SchemaVersion, ID: verificationID,
		ClaimID: claimID, HospitalIdentity: hospitalID, Outcome: outcome,
		ClinicalReferenceHash: strings.ToLower(clinicalReferenceHash), CreatedAt: now,
	}
	if err := putState(ctx, "hospitalVerification", verificationID, verification); err != nil {
		return nil, err
	}
	if outcome == "VERIFIED" {
		claim.Status = "HOSPITAL_VERIFIED"
	} else {
		claim.Status = "REJECTED"
	}
	claim.HospitalVerificationID = verificationID
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claim", claimID, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "ClaimHospitalVerified", verification); err != nil {
		return nil, err
	}
	return verification, nil
}
