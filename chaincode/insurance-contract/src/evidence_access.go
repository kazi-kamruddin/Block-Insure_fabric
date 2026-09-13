package insurance

import (
	"fmt"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func validateEvidencePurpose(purpose string) (string, error) {
	purpose = strings.ToUpper(strings.TrimSpace(purpose))
	if purpose != "DOWNLOAD" && purpose != "VERIFY" && purpose != "AUDIT" {
		return "", fmt.Errorf("purpose must be DOWNLOAD, VERIFY, or AUDIT")
	}
	return purpose, nil
}

func validateEvidenceGrantee(mspID, role, purpose string) error {
	valid := (mspID == "InsurerMSP" && role == "insurerAdmin" && purpose == "DOWNLOAD") ||
		(mspID == "HospitalMSP" && role == "hospitalOfficer" && purpose == "VERIFY") ||
		(mspID == "AuditorMSP" && role == "auditor" && purpose == "AUDIT")
	if !valid {
		return fmt.Errorf("grantee organization, role, and purpose are not an allowed evidence-sharing scope")
	}
	return nil
}

func validateWorkflowEvidencePurpose(mspID, role, purpose string) error {
	valid := (mspID == "InsurerMSP" && (role == "insurerAdmin" || role == "policyholder") && purpose == "DOWNLOAD") ||
		(mspID == "HospitalMSP" && role == "hospitalOfficer" && purpose == "VERIFY") ||
		(mspID == "AuditorMSP" && role == "auditor" && purpose == "AUDIT")
	if !valid {
		return fmt.Errorf("evidence access purpose does not match the caller organization and role")
	}
	return nil
}

func (c *Contract) GrantEvidenceAccess(ctx contractapi.TransactionContextInterface, id, evidenceID, granteeMSP, granteeRole, granteeSubject, purpose, expiresAt string, maxAccesses int) (*EvidenceAccessGrant, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	ownerID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	evidence, err := c.ReadEvidenceReference(ctx, evidenceID)
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, evidence.ClaimID)
	if err != nil {
		return nil, err
	}
	if ownerID != claim.ClaimantID || ownerID != evidence.SubmittedBy {
		return nil, fmt.Errorf("access denied: only the evidence owner can create a grant")
	}
	purpose, err = validateEvidencePurpose(purpose)
	if err != nil {
		return nil, err
	}
	granteeMSP = strings.TrimSpace(granteeMSP)
	granteeRole = strings.TrimSpace(granteeRole)
	granteeSubject = strings.TrimSpace(granteeSubject)
	if err := validateEvidenceGrantee(granteeMSP, granteeRole, purpose); err != nil {
		return nil, err
	}
	if granteeSubject == "" {
		return nil, fmt.Errorf("granteeSubject is required; use * for any identity in the scoped organization role")
	}
	if len(granteeSubject) > 128 {
		return nil, fmt.Errorf("granteeSubject cannot exceed 128 characters")
	}
	if maxAccesses < 1 || maxAccesses > 100 {
		return nil, fmt.Errorf("maxAccesses must be between 1 and 100")
	}
	expiry, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		return nil, fmt.Errorf("expiresAt must be an RFC3339 timestamp")
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	nowTime, _ := time.Parse(time.RFC3339Nano, now)
	if !expiry.After(nowTime) {
		return nil, fmt.Errorf("expiresAt must be after the transaction timestamp")
	}
	if expiry.After(nowTime.AddDate(1, 0, 0)) {
		return nil, fmt.Errorf("expiresAt cannot be more than one year after creation")
	}
	grant := &EvidenceAccessGrant{
		AssetType: "evidenceGrant", SchemaVersion: SchemaVersion, ID: id,
		EvidenceID: evidenceID, ClaimID: evidence.ClaimID, OwnerID: ownerID,
		GranteeMSP: granteeMSP, GranteeRole: granteeRole, GranteeSubject: granteeSubject,
		Purpose: purpose, ExpiresAt: expiry.UTC().Format(time.RFC3339), MaxAccesses: maxAccesses,
		AccessCount: 0, Status: "ACTIVE", CreatedAt: now,
	}
	if err := putState(ctx, "evidenceGrant", id, grant); err != nil {
		return nil, err
	}
	if err := emit(ctx, "EvidenceAccessGranted", grant); err != nil {
		return nil, err
	}
	return grant, nil
}

func (c *Contract) RevokeEvidenceAccess(ctx contractapi.TransactionContextInterface, grantID string) (*EvidenceAccessGrant, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	ownerID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	grant, err := c.ReadEvidenceAccessGrant(ctx, grantID)
	if err != nil {
		return nil, err
	}
	if grant.OwnerID != ownerID {
		return nil, fmt.Errorf("access denied: only the grant owner can revoke it")
	}
	if grant.Status == "REVOKED" {
		return grant, nil
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	grant.Status = "REVOKED"
	grant.RevokedAt = now
	if err := overwriteAsset(ctx, "evidenceGrant", grant.ID, grant); err != nil {
		return nil, err
	}
	if err := emit(ctx, "EvidenceAccessRevoked", grant); err != nil {
		return nil, err
	}
	return grant, nil
}

func (c *Contract) authorizeWorkflowEvidence(ctx contractapi.TransactionContextInterface, claim *Claim, evidence *EvidenceReference, mspID, role string) (bool, error) {
	switch {
	case mspID == "InsurerMSP" && role == "insurerAdmin":
		return true, nil
	case mspID == "InsurerMSP" && role == "policyholder":
		subject, err := callerSubject(ctx)
		return err == nil && subject == claim.ClaimantID && subject == evidence.SubmittedBy, err
	case mspID == "HospitalMSP" && role == "hospitalOfficer":
		subject, err := callerSubject(ctx)
		if err != nil {
			return false, err
		}
		return subject == claim.HospitalID && (claim.Status == "SUBMITTED" || claim.Status == "APPEAL_SUBMITTED"), nil
	case mspID == "AuditorMSP" && role == "auditor":
		if claim.CurrentReviewID == "" {
			return false, nil
		}
		review, err := c.ReadClaimReview(ctx, claim.CurrentReviewID)
		if err != nil {
			return false, err
		}
		subject, err := callerSubject(ctx)
		if err != nil {
			return false, err
		}
		for _, assigned := range review.AssignedAuditorIDs {
			if assigned == subject {
				return true, nil
			}
		}
	}
	return false, nil
}

func (c *Contract) recordEvidenceAccess(ctx contractapi.TransactionContextInterface, id string, evidence *EvidenceReference, purpose, grantID string) (*EvidenceAccessRecord, error) {
	purpose, err := validateEvidencePurpose(purpose)
	if err != nil {
		return nil, err
	}
	callerID, mspID, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	record := &EvidenceAccessRecord{
		AssetType: "evidenceAccess", SchemaVersion: SchemaVersion, ID: id,
		EvidenceID: evidence.ID, ClaimID: evidence.ClaimID, GrantID: grantID,
		AccessorMSP: mspID, AccessorRole: role, AccessorIdentity: callerID,
		Purpose: purpose, CreatedAt: now,
	}
	if err := putState(ctx, "evidenceAccess", id, record); err != nil {
		return nil, err
	}
	if err := emit(ctx, "EvidenceAccessRecorded", record); err != nil {
		return nil, err
	}
	return record, nil
}

func (c *Contract) RecordEvidenceAccess(ctx contractapi.TransactionContextInterface, id, evidenceID, purpose string) (*EvidenceAccessRecord, error) {
	evidence, err := c.ReadEvidenceReference(ctx, evidenceID)
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, evidence.ClaimID)
	if err != nil {
		return nil, err
	}
	_, mspID, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	authorized, err := c.authorizeWorkflowEvidence(ctx, claim, evidence, mspID, role)
	if err != nil {
		return nil, err
	}
	if !authorized {
		return nil, fmt.Errorf("access denied: caller cannot retrieve evidence %s", evidenceID)
	}
	purpose, err = validateEvidencePurpose(purpose)
	if err != nil {
		return nil, err
	}
	if err := validateWorkflowEvidencePurpose(mspID, role, purpose); err != nil {
		return nil, err
	}
	return c.recordEvidenceAccess(ctx, id, evidence, purpose, "")
}

func (c *Contract) RecordGrantedEvidenceAccess(ctx contractapi.TransactionContextInterface, id, evidenceID, grantID, purpose string) (*EvidenceAccessRecord, error) {
	evidence, err := c.ReadEvidenceReference(ctx, evidenceID)
	if err != nil {
		return nil, err
	}
	grant, err := c.ReadEvidenceAccessGrant(ctx, grantID)
	if err != nil {
		return nil, err
	}
	if grant.EvidenceID != evidenceID || grant.ClaimID != evidence.ClaimID {
		return nil, fmt.Errorf("grant %s does not cover evidence %s", grantID, evidenceID)
	}
	purpose, err = validateEvidencePurpose(purpose)
	if err != nil {
		return nil, err
	}
	_, mspID, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	if grant.Status != "ACTIVE" || grant.GranteeMSP != mspID || grant.GranteeRole != role || grant.Purpose != purpose || (grant.GranteeSubject != "*" && grant.GranteeSubject != subject) {
		return nil, fmt.Errorf("access denied: grant scope does not match caller and purpose")
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	nowTime, _ := time.Parse(time.RFC3339Nano, now)
	expiry, _ := time.Parse(time.RFC3339, grant.ExpiresAt)
	if !nowTime.Before(expiry) {
		return nil, fmt.Errorf("access denied: grant %s has expired", grantID)
	}
	if grant.AccessCount >= grant.MaxAccesses {
		return nil, fmt.Errorf("access denied: grant %s access limit is exhausted", grantID)
	}
	grant.AccessCount++
	if err := overwriteAsset(ctx, "evidenceGrant", grant.ID, grant); err != nil {
		return nil, err
	}
	return c.recordEvidenceAccess(ctx, id, evidence, purpose, grant.ID)
}
