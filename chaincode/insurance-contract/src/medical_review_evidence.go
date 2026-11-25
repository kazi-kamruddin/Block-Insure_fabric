package insurance

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type MedicalEvidenceCheck struct {
	ReviewID   string `json:"reviewId"`
	EvidenceID string `json:"evidenceId"`
	GrantID    string `json:"grantId"`
	AuditorID  string `json:"auditorId"`
	AccessID   string `json:"accessId"`
	CheckedAt  string `json:"checkedAt"`
}

func (c *Contract) ShareMedicalReviewEvidence(ctx contractapi.TransactionContextInterface, reviewID, expiresAt string) ([]EvidenceAccessGrant, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	review, claim, err := c.currentMedicalReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	owner, err := callerSubject(ctx)
	if err != nil || owner != claim.ClaimantID || review.Status != "PREPARING" {
		return nil, fmt.Errorf("only the claimant may share during preparation")
	}
	if _, err := medicalReviewClockForGrant(ctx, review.PrepareBy); err != nil {
		return nil, fmt.Errorf("review preparation expired")
	}
	docs, err := c.requireXGBoostEvidence(ctx, claim)
	if err != nil {
		return nil, err
	}
	if len(docs) > 16 {
		return nil, fmt.Errorf("review set exceeds sixteen documents")
	}
	result := []EvidenceAccessGrant{}
	for _, doc := range docs {
		for _, auditor := range review.AssignedAuditorIDs {
			key := canonicalProtocolHash("fabric-medical-review-grant-v1", reviewID, doc.ID, auditor, expiresAt)
			stateKey, err := stateKey(ctx, "evidenceGrant", key)
			if err != nil {
				return nil, err
			}
			existing, err := ctx.GetStub().GetState(stateKey)
			if err != nil {
				return nil, err
			}
			if existing != nil {
				grant, err := c.ReadEvidenceAccessGrant(ctx, key)
				if err != nil {
					return nil, err
				}
				result = append(result, *grant)
				continue
			}
			grant, err := c.GrantEvidenceAccess(ctx, key, doc.ID, "AuditorMSP", "auditor", auditor, "AUDIT", expiresAt, 10)
			if err != nil {
				return nil, err
			}
			result = append(result, *grant)
		}
	}
	return result, nil
}

func (c *Contract) ListMedicalEvidenceChecks(ctx contractapi.TransactionContextInterface, reviewID string) ([]MedicalEvidenceCheck, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	all, err := listState[MedicalEvidenceCheck](ctx, "medicalEvidenceCheck")
	if err != nil {
		return nil, err
	}
	result := []MedicalEvidenceCheck{}
	for _, check := range all {
		if check.ReviewID == reviewID {
			result = append(result, check)
		}
	}
	return result, nil
}

func checkMedicalAuditGrant(claim *Claim, review *ClaimReview, evidenceID, subject string, grant *EvidenceAccessGrant) error {
	if review.MedicalVersion != claim.Version || (review.Status != "PREPARING" && review.Status != "OPEN") ||
		!slices.Contains(review.AssignedAuditorIDs, subject) || !slices.Contains(claim.EvidenceIDs, evidenceID) ||
		grant.MedicalReviewID != review.ID || grant.GranteeSubject != subject {
		return fmt.Errorf("access denied: current assigned medical review and explicit grant required")
	}
	return nil
}

func (c *Contract) ConfirmMedicalEvidence(ctx contractapi.TransactionContextInterface, reviewID, evidenceID, accessID, contentHash string) (*MedicalEvidenceCheck, error) {
	identity, err := requireIdentity(ctx, "AuditorMSP", "auditor")
	if err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	review, claim, err := c.currentMedicalReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	if review.Status != "PREPARING" {
		return nil, fmt.Errorf("access check belongs to review preparation")
	}
	if _, err := medicalReviewClockForGrant(ctx, review.PrepareBy); err != nil {
		return nil, fmt.Errorf("review preparation expired")
	}
	doc, err := c.ReadEvidenceReference(ctx, evidenceID)
	if err != nil {
		return nil, err
	}
	if doc.ClaimID != claim.ID || !strings.EqualFold(contentHash, doc.ContentHash) {
		return nil, fmt.Errorf("document plaintext digest does not match")
	}
	receipt, err := getState[EvidenceAccessRecord](ctx, "evidenceAccess", accessID)
	if err != nil {
		return nil, err
	}
	if receipt.EvidenceID != evidenceID || receipt.AccessorIdentity != identity || receipt.AccessorMSP != "AuditorMSP" || receipt.Purpose != "AUDIT" || receipt.GrantID == "" {
		return nil, fmt.Errorf("access receipt is not yours for this evidence")
	}
	grant, err := c.ReadEvidenceAccessGrant(ctx, receipt.GrantID)
	if err != nil {
		return nil, err
	}
	if err := checkMedicalAuditGrant(claim, review, evidenceID, subject, grant); err != nil {
		return nil, err
	}
	if grant.Status != "ACTIVE" {
		return nil, fmt.Errorf("grant was revoked")
	}
	if _, err := medicalReviewClockForGrant(ctx, grant.ExpiresAt); err != nil {
		return nil, err
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	check := &MedicalEvidenceCheck{ReviewID: reviewID, EvidenceID: evidenceID, GrantID: grant.ID, AuditorID: subject, AccessID: accessID, CheckedAt: now}
	key := medicalReviewDocumentKey(reviewID, evidenceID, subject)
	if err := overwriteAsset(ctx, "medicalEvidenceCheck", key, check); err != nil {
		return nil, err
	}
	return check, emit(ctx, "MedicalEvidenceDecryptionConfirmed", check)
}

func medicalReviewClockForGrant(ctx contractapi.TransactionContextInterface, value string) (time.Time, error) {
	ts, err := ledgerNow(ctx)
	if err != nil {
		return time.Time{}, err
	}
	expiry, err := time.Parse(time.RFC3339, value)
	if err != nil || !expiry.After(ts) {
		return time.Time{}, fmt.Errorf("grant expired")
	}
	return expiry, nil
}
