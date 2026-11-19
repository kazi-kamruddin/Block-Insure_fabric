package insurance

import (
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type MedicalClarification struct {
	ID           string `json:"id"`
	ReviewID     string `json:"reviewId"`
	ClaimID      string `json:"claimId"`
	ClaimVersion int    `json:"claimVersion"`
	Question     string `json:"question"`
	Answer       string `json:"answer"`
	EvidenceHash string `json:"evidenceHash"`
	Status       string `json:"status"`
	Deadline     string `json:"deadline"`
	ResolvedAt   string `json:"resolvedAt"`
}

func (c *Contract) readClarification(ctx contractapi.TransactionContextInterface, id string) (*MedicalClarification, error) {
	return getPrivateState[MedicalClarification](ctx, "medicalClarification", id)
}

func medicalPrivateEnvelope(ctx contractapi.TransactionContextInterface) (string, error) {
	input, err := ctx.GetStub().GetTransient()
	if err != nil {
		return "", err
	}
	message := string(input["medicalMessage"])
	body, ok := strings.CutPrefix(message, "v1.")
	if !ok || len(body) > base64.RawURLEncoding.EncodedLen(2028) {
		return "", fmt.Errorf("encrypted medical message is required")
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(body)
	if err != nil || len(decoded) <= 28 || base64.RawURLEncoding.EncodeToString(decoded) != body {
		return "", fmt.Errorf("invalid encrypted medical message")
	}
	return message, nil
}

func (c *Contract) RequestMedicalClarification(ctx contractapi.TransactionContextInterface, reviewID, id, deadline string) (*Claim, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	review, claim, err := c.currentMedicalReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	if review.Status != "PREPARING" || claim.MedicalClarificationID != "" {
		return nil, fmt.Errorf("one clarification is available before voting in this review cycle")
	}
	end, err := medicalReviewClock(ctx, deadline)
	if err != nil {
		return nil, err
	}
	prepare, _ := time.Parse(time.RFC3339, review.PrepareBy)
	if end.After(prepare) {
		return nil, fmt.Errorf("clarification must end before access preparation closes")
	}
	question, err := medicalPrivateEnvelope(ctx)
	if err != nil {
		return nil, err
	}
	note := &MedicalClarification{ID: id, ReviewID: reviewID, ClaimID: claim.ID, ClaimVersion: claim.Version, Question: question, Status: "PENDING", Deadline: end.UTC().Format(time.RFC3339)}
	if err := putPrivateState(ctx, "medicalClarification", id, note); err != nil {
		return nil, err
	}
	claim.MedicalClarificationID = id
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	return claim, emit(ctx, "MedicalClarificationRequested", claim)
}

func (c *Contract) RespondMedicalClarification(ctx contractapi.TransactionContextInterface, id, response, evidenceHash string) (*Claim, error) {
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	note, err := c.readClarification(ctx, id)
	if err != nil {
		return nil, err
	}
	review, claim, err := c.currentMedicalReview(ctx, note.ReviewID)
	if err != nil {
		return nil, err
	}
	if msp != "InsurerMSP" || note.Status != "PENDING" || review.Status != "PREPARING" || claim.MedicalClarificationID != id {
		return nil, fmt.Errorf("clarification is unavailable")
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	current, _ := time.Parse(time.RFC3339Nano, now)
	deadline, _ := time.Parse(time.RFC3339, note.Deadline)
	if response == "EXPIRED" {
		if role != "insurerAdmin" || current.Before(deadline) {
			return nil, fmt.Errorf("only the insurer can close an expired clarification")
		}
	} else {
		owner, err := callerSubject(ctx)
		if err != nil || role != "policyholder" || owner != claim.ClaimantID || !current.Before(deadline) {
			return nil, fmt.Errorf("clarification is unavailable to this caller")
		}
		if response != "ANSWER" && response != "UNAVAILABLE" && response != "MATERIAL" {
			return nil, fmt.Errorf("choose answer, unavailable or material response")
		}
		note.Answer, err = medicalPrivateEnvelope(ctx)
		if err != nil {
			return nil, err
		}
		if _, err := currentMedicalHead(ctx, claim); err != nil {
			return nil, err
		}
	}
	if evidenceHash != "" {
		if response != "MATERIAL" {
			return nil, fmt.Errorf("only a material response may commit a new document")
		}
		if err := validateHash("evidenceHash", evidenceHash); err != nil {
			return nil, err
		}
	}
	note.Status, note.ResolvedAt, note.EvidenceHash = response, now, strings.ToLower(evidenceHash)
	key, err := privateStateKey(ctx, "medicalClarification", id)
	if err != nil {
		return nil, err
	}
	if err := writeMedicalPrivate(ctx, key, note); err != nil {
		return nil, err
	}
	if response == "MATERIAL" {
		if _, err := currentMedicalHead(ctx, claim); err != nil {
			return nil, err
		}
		review.Status, review.ClosedAt = "SUPERSEDED", now
		if err := overwriteAsset(ctx, "claimReview", review.ID, review); err != nil {
			return nil, err
		}
		original := claimFactsHash(claim)
		if err := c.advanceMedicalVersion(ctx, claim, "CLARIFICATION", canonicalProtocolHash("medical-clarification-v1", note.Question, note.Answer, note.EvidenceHash), now); err != nil {
			return nil, err
		}
		claim.MedicalSupplementHash = note.EvidenceHash
		if claim.CurrentAppealID != "" {
			appeal, err := c.ReadClaimAppeal(ctx, claim.CurrentAppealID)
			if err != nil {
				return nil, err
			}
			appeal.ClaimVersion, appeal.OriginalClaimHash, appeal.ProposedDescriptionHash = claim.Version, original, claim.DescriptionHash
			appeal.Status, appeal.HospitalVerificationID, appeal.ReviewID = "SUBMITTED", "", ""
			appeal.CommitmentHash = appealCommitmentHash(appeal)
			if err := overwriteAsset(ctx, "claimAppeal", appeal.ID, appeal); err != nil {
				return nil, err
			}
			claim.Status = "APPEAL_SUBMITTED"
		}
	}
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	return claim, emit(ctx, "MedicalClarificationResponded", claim)
}

func (c *Contract) ReadMedicalClarification(ctx contractapi.TransactionContextInterface, id string) (*MedicalClarification, error) {
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	if msp != "InsurerMSP" || (role != "policyholder" && role != "insurerAdmin") {
		return nil, fmt.Errorf("clarifications are restricted to holder and insurer")
	}
	note, err := c.readClarification(ctx, id)
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, note.ClaimID)
	if err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil || (role == "policyholder" && subject != claim.ClaimantID) {
		return nil, fmt.Errorf("clarification unavailable")
	}
	return note, nil
}
