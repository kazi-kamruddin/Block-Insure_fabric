package insurance

import (
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (c *Contract) RecordEvidenceAccess(ctx contractapi.TransactionContextInterface, id, evidenceID, purpose string) (*EvidenceAccessRecord, error) {
	evidence, err := c.ReadEvidenceReference(ctx, evidenceID)
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, evidence.ClaimID)
	if err != nil {
		return nil, err
	}

	identity := ctx.GetClientIdentity()
	mspID, err := identity.GetMSPID()
	if err != nil {
		return nil, fmt.Errorf("read caller MSP: %w", err)
	}
	role, found, err := identity.GetAttributeValue("role")
	if err != nil {
		return nil, fmt.Errorf("read caller role: %w", err)
	}
	if !found {
		return nil, fmt.Errorf("access denied: caller role is required")
	}

	authorized := false
	switch {
	case mspID == "InsurerMSP" && role == "insurerAdmin":
		authorized = true
	case mspID == "InsurerMSP" && role == "policyholder":
		subject, subjectErr := callerSubject(ctx)
		if subjectErr != nil {
			return nil, subjectErr
		}
		authorized = subject == claim.ClaimantID && subject == evidence.SubmittedBy
	case mspID == "HospitalMSP" && role == "hospitalOfficer":
		authorized = claim.Status == "SUBMITTED" || claim.HospitalVerificationID != ""
	case mspID == "AuditorMSP" && role == "auditor":
		authorized = claim.Status != "SUBMITTED" && claim.Status != "HOSPITAL_VERIFIED"
	}
	if !authorized {
		return nil, fmt.Errorf("access denied: caller cannot retrieve evidence %s", evidenceID)
	}

	purpose = strings.ToUpper(strings.TrimSpace(purpose))
	if purpose != "DOWNLOAD" && purpose != "VERIFY" && purpose != "AUDIT" {
		return nil, fmt.Errorf("purpose must be DOWNLOAD, VERIFY, or AUDIT")
	}
	callerID, err := identity.GetID()
	if err != nil {
		return nil, fmt.Errorf("read caller identity: %w", err)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	record := &EvidenceAccessRecord{
		AssetType: "evidenceAccess", SchemaVersion: SchemaVersion, ID: id,
		EvidenceID: evidenceID, ClaimID: evidence.ClaimID, AccessorMSP: mspID,
		AccessorRole: role, AccessorIdentity: callerID, Purpose: purpose, CreatedAt: now,
	}
	if err := putState(ctx, "evidenceAccess", id, record); err != nil {
		return nil, err
	}
	if err := emit(ctx, "EvidenceAccessRecorded", record); err != nil {
		return nil, err
	}
	return record, nil
}
