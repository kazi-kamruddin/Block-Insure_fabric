package insurance

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (c *Contract) requireXGBoostEvidence(ctx contractapi.TransactionContextInterface, claim *Claim) ([]EvidenceReference, error) {
	all, err := c.ListEvidenceReferences(ctx)
	if err != nil {
		return nil, err
	}
	current := []EvidenceReference{}
	primary := false
	supplementReady := claim.MedicalSupplementHash == ""
	var appeal *ClaimAppeal
	if claim.EpisodeID != "" && claim.CurrentAppealID != "" {
		appeal, err = c.ReadClaimAppeal(ctx, claim.CurrentAppealID)
		if err != nil {
			return nil, err
		}
	}
	appealReady := appeal == nil || appeal.EvidenceHash == ""
	for _, evidence := range all {
		currentVersion := evidence.ClaimVersion == claim.Version
		carried := claim.EpisodeID != "" && evidence.ClaimVersion < claim.Version && slices.Contains(claim.EvidenceIDs, evidence.ID)
		if evidence.ClaimID == claim.ID && (currentVersion || carried) && evidence.SubmittedBy == claim.ClaimantID {
			current = append(current, evidence)
			if evidence.DocumentType == "INVOICE" || (claim.Version > 1 && evidence.DocumentType == "APPEAL_DOCUMENT") {
				primary = true
			}
			if currentVersion && evidence.DocumentType == "CLARIFICATION_DOCUMENT" && strings.EqualFold(evidence.ContentHash, claim.MedicalSupplementHash) {
				supplementReady = true
			}
			if appeal != nil && evidence.DocumentType == "APPEAL_DOCUMENT" && strings.EqualFold(evidence.ContentHash, appeal.EvidenceHash) {
				appealReady = true
			}
		}
	}
	if !appealReady || !supplementReady {
		return nil, fmt.Errorf("upload the committed successor evidence before verification")
	}
	if !primary && (claim.EpisodeID == "" || claim.MedicalEvidenceRequired) {
		return nil, fmt.Errorf("current-version primary invoice evidence (or committed appeal document) is required")
	}
	return current, nil
}

func (c *Contract) requireXGBoostReviewReadiness(ctx contractapi.TransactionContextInterface, claim *Claim, assignments []string, approvals, rejections int, deadline string) error {
	if claim.CurrentOracleRequestID == "" {
		return nil
	}
	request, err := c.ReadOracleRequest(ctx, claim.CurrentOracleRequestID)
	if err != nil {
		return err
	}
	if request.ModelVersion != "fabric-xgb-synthetic-v1" {
		return nil
	}
	if len(assignments) != 4 || approvals != 3 || rejections != 2 {
		return fmt.Errorf("Fabric XGBoost review requires exactly four auditors, three approvals and two rejections")
	}
	evidence, err := c.requireXGBoostEvidence(ctx, claim)
	if err != nil {
		return err
	}
	grants, err := c.ListEvidenceAccessGrants(ctx)
	if err != nil {
		return err
	}
	until, err := time.Parse(time.RFC3339, deadline)
	if err != nil {
		return err
	}
	for _, document := range evidence {
		for _, auditor := range assignments {
			ready := false
			for _, grant := range grants {
				expiry, parseErr := time.Parse(time.RFC3339, grant.ExpiresAt)
				if parseErr == nil && grant.EvidenceID == document.ID && grant.OwnerID == claim.ClaimantID && grant.Status == "ACTIVE" &&
					grant.GranteeMSP == "AuditorMSP" && grant.GranteeRole == "auditor" && grant.GranteeSubject == auditor && grant.Purpose == "AUDIT" &&
					grant.AccessCount < grant.MaxAccesses && !expiry.Before(until) {
					ready = true
				}
			}
			if !ready {
				return fmt.Errorf("prepare current evidence grant for %s and %s through review deadline before opening review", document.ID, auditor)
			}
		}
	}
	return nil
}
