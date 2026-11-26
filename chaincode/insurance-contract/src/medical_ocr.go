package insurance

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

var ocrEngineVersionPattern = regexp.MustCompile("^[a-z0-9.:-]{1,80}$")

type MedicalOCRRecord struct {
	ID              string `json:"id"`
	EvidenceID      string `json:"evidenceId"`
	ClaimID         string `json:"claimId"`
	ClaimVersion    int    `json:"claimVersion"`
	EngineVersion   string `json:"engineVersion"`
	SourceHash      string `json:"sourceHash"`
	SuggestionsHash string `json:"suggestionsHash"`
	ConfirmedHash   string `json:"confirmedHash"`
	LowConfidence   bool   `json:"lowConfidence"`
	ConfirmedBy     string `json:"confirmedBy"`
	ConfirmedAt     string `json:"confirmedAt"`
}

func (c *Contract) RecordMedicalOCR(ctx contractapi.TransactionContextInterface, id, evidenceID, engineVersion, sourceHash, suggestionsHash, confirmedHash string, lowConfidence bool, accessID string) (*MedicalOCRRecord, error) {
	if !isMedicalCandidate(ctx) {
		return nil, fmt.Errorf("isolated medical channel required")
	}
	identity, msp, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	doc, err := c.ReadEvidenceReference(ctx, evidenceID)
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, doc.ClaimID)
	if err != nil {
		return nil, err
	}
	if claim.EpisodeID == "" || !strings.EqualFold(doc.ContentHash, sourceHash) {
		return nil, fmt.Errorf("OCR source must match the original medical evidence")
	}
	switch {
	case msp == "InsurerMSP" && role == "policyholder" && subject == claim.ClaimantID && subject == doc.SubmittedBy:
	case msp == "AuditorMSP" && role == "auditor":
		review, _, err := c.currentMedicalReview(ctx, claim.CurrentReviewID)
		if err != nil {
			return nil, err
		}
		access, err := getState[EvidenceAccessRecord](ctx, "evidenceAccess", accessID)
		if err != nil {
			return nil, err
		}
		if access.EvidenceID != doc.ID || access.AccessorIdentity != identity || access.Purpose != "AUDIT" || access.GrantID == "" {
			return nil, fmt.Errorf("current auditor evidence receipt required")
		}
		grant, err := c.ReadEvidenceAccessGrant(ctx, access.GrantID)
		if err != nil {
			return nil, err
		}
		if err := checkMedicalAuditGrant(claim, review, doc.ID, subject, grant); err != nil {
			return nil, err
		}
		if grant.Status != "ACTIVE" {
			return nil, fmt.Errorf("active evidence grant required")
		}
		if _, err := medicalReviewClockForGrant(ctx, grant.ExpiresAt); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("only the evidence owner or assigned reviewer may record OCR")
	}
	if !ocrEngineVersionPattern.MatchString(engineVersion) {
		return nil, fmt.Errorf("OCR engine version required")
	}
	for _, value := range []string{sourceHash, suggestionsHash, confirmedHash} {
		if err := validateHash("OCR hash", value); err != nil {
			return nil, err
		}
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	record := &MedicalOCRRecord{ID: id, EvidenceID: doc.ID, ClaimID: claim.ID, ClaimVersion: claim.Version, EngineVersion: engineVersion,
		SourceHash: strings.ToLower(sourceHash), SuggestionsHash: strings.ToLower(suggestionsHash), ConfirmedHash: strings.ToLower(confirmedHash),
		LowConfidence: lowConfidence, ConfirmedBy: subject, ConfirmedAt: now}
	if err := putState(ctx, "medicalOCR", id, record); err != nil {
		return nil, err
	}
	return record, emit(ctx, "MedicalOCRConfirmed", record)
}
