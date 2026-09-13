package insurance

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const (
	maxAppealsPerClaim      = 1
	appealCommitmentVersion = "block-insure-fabric-appeal-v1"
)

var appealReasonCategories = map[string]bool{
	"DOCUMENT_ERROR":      true,
	"CLINICAL_CORRECTION": true,
	"AMOUNT_CORRECTION":   true,
	"OTHER":               true,
}

func claimFactsHash(claim *Claim) string {
	return canonicalProtocolHash(
		appealCommitmentVersion+":original-claim",
		claim.ID,
		strconv.Itoa(claim.Version),
		claim.PolicyID,
		claim.ClaimantID,
		claim.HospitalID,
		strconv.FormatInt(claim.AmountMinor, 10),
		claim.IncidentDate,
		strings.ToLower(claim.DescriptionHash),
	)
}

func appealCommitmentHash(appeal *ClaimAppeal) string {
	return canonicalProtocolHash(
		appealCommitmentVersion+":commitment",
		appeal.ClaimID,
		strconv.Itoa(appeal.ClaimVersion),
		appeal.ReasonCategory,
		strings.ToLower(appeal.ReasonHash),
		strings.ToLower(appeal.DescriptionHash),
		strings.ToLower(appeal.EvidenceHash),
		strings.ToLower(appeal.OriginalClaimHash),
		appeal.ProposedHospitalID,
		strconv.FormatInt(appeal.ProposedAmountMinor, 10),
		appeal.ProposedIncidentDate,
		strings.ToLower(appeal.ProposedDescriptionHash),
		strings.ToLower(appeal.ProposedClinicalReferenceHash),
	)
}

func parseAuditorAssignments(raw string) ([]string, error) {
	var assignments []string
	if err := json.Unmarshal([]byte(raw), &assignments); err != nil {
		return nil, fmt.Errorf("assignedAuditorIds must be a JSON string array")
	}
	if len(assignments) < 3 || len(assignments) > 9 {
		return nil, fmt.Errorf("between 3 and 9 auditors must be assigned")
	}
	seen := make(map[string]bool, len(assignments))
	for index, value := range assignments {
		value = strings.TrimSpace(value)
		if !idPattern.MatchString(value) {
			return nil, fmt.Errorf("assigned auditor id %q is invalid", value)
		}
		if seen[value] {
			return nil, fmt.Errorf("assigned auditor id %s is duplicated", value)
		}
		seen[value] = true
		assignments[index] = value
	}
	return assignments, nil
}

func validateReviewRules(assignments []string, approvalThreshold, rejectionThreshold int) error {
	if approvalThreshold < 1 || rejectionThreshold < 1 {
		return fmt.Errorf("review thresholds must be positive")
	}
	if approvalThreshold > len(assignments) || rejectionThreshold > len(assignments) {
		return fmt.Errorf("review thresholds cannot exceed the assignment count")
	}
	if approvalThreshold+rejectionThreshold != len(assignments)+1 {
		return fmt.Errorf("approval and rejection thresholds must sum to assignment count plus one")
	}
	return nil
}

func validateReviewDeadline(ctx contractapi.TransactionContextInterface, deadline string) (string, error) {
	parsed, err := time.Parse(time.RFC3339, deadline)
	if err != nil {
		return "", fmt.Errorf("deadline must use RFC3339")
	}
	tx, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return "", fmt.Errorf("read transaction timestamp: %w", err)
	}
	if !parsed.After(tx.AsTime()) {
		return "", fmt.Errorf("review deadline must be after the transaction time")
	}
	return parsed.UTC().Format(time.RFC3339), nil
}

func (c *Contract) openReview(
	ctx contractapi.TransactionContextInterface,
	claim *Claim,
	reviewID, appealID, kind, assignedAuditorIDsJSON string,
	approvalThreshold, rejectionThreshold int,
	deadline string,
) (*ClaimReview, error) {
	assignments, err := parseAuditorAssignments(assignedAuditorIDsJSON)
	if err != nil {
		return nil, err
	}
	if err := validateReviewRules(assignments, approvalThreshold, rejectionThreshold); err != nil {
		return nil, err
	}
	deadline, err = validateReviewDeadline(ctx, deadline)
	if err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	review := &ClaimReview{
		AssetType: "claimReview", SchemaVersion: SchemaVersion, ID: reviewID,
		ClaimID: claim.ID, AppealID: appealID, Round: claim.ReviewRound + 1, Kind: kind,
		AssignedAuditorIDs: assignments, ApprovalThreshold: approvalThreshold,
		RejectionThreshold: rejectionThreshold, Status: "OPEN", Deadline: deadline, OpenedAt: now,
	}
	if err := putState(ctx, "claimReview", reviewID, review); err != nil {
		return nil, err
	}
	claim.CurrentReviewID = reviewID
	claim.ReviewRound = review.Round
	claim.Status = "UNDER_REVIEW"
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "ClaimReviewOpened", review); err != nil {
		return nil, err
	}
	return review, nil
}

func (c *Contract) OpenClaimReview(
	ctx contractapi.TransactionContextInterface,
	claimID, reviewID, assignedAuditorIDsJSON string,
	approvalThreshold, rejectionThreshold int,
	deadline string,
) (*ClaimReview, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if claim.Status != "HOSPITAL_VERIFIED" {
		return nil, fmt.Errorf("claim %s must be HOSPITAL_VERIFIED to open initial review", claimID)
	}
	return c.openReview(ctx, claim, reviewID, "", "INITIAL", assignedAuditorIDsJSON, approvalThreshold, rejectionThreshold, deadline)
}

func (c *Contract) SubmitClaimAppeal(
	ctx contractapi.TransactionContextInterface,
	appealID, claimID, reasonCategory, reasonHash, descriptionHash, evidenceHash, proposedHospitalID string,
	proposedAmountMinor int64,
	proposedIncidentDate, proposedDescriptionHash, proposedClinicalReferenceHash string,
) (*ClaimAppeal, error) {
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
	if claim.Status != "REJECTED" {
		return nil, fmt.Errorf("claim %s must be REJECTED to appeal", claimID)
	}
	if claim.AppealCount >= maxAppealsPerClaim {
		return nil, fmt.Errorf("claim %s has reached the maximum appeal count", claimID)
	}
	reasonCategory = strings.ToUpper(strings.TrimSpace(reasonCategory))
	if !appealReasonCategories[reasonCategory] {
		return nil, fmt.Errorf("reasonCategory is unsupported")
	}
	if err := validateHash("reasonHash", reasonHash); err != nil {
		return nil, err
	}
	if err := validateHash("descriptionHash", descriptionHash); err != nil {
		return nil, err
	}
	if evidenceHash != "" {
		if err := validateHash("evidenceHash", evidenceHash); err != nil {
			return nil, err
		}
	}
	if err := validateHash("proposedClinicalReferenceHash", proposedClinicalReferenceHash); err != nil {
		return nil, err
	}
	effectiveHospitalID := strings.TrimSpace(proposedHospitalID)
	if effectiveHospitalID == "" {
		effectiveHospitalID = claim.HospitalID
	}
	if !idPattern.MatchString(effectiveHospitalID) {
		return nil, fmt.Errorf("proposedHospitalId is invalid")
	}
	policy, err := c.ReadPolicy(ctx, claim.PolicyID)
	if err != nil {
		return nil, err
	}
	effectiveAmount := proposedAmountMinor
	if effectiveAmount == 0 {
		effectiveAmount = claim.AmountMinor
	}
	if effectiveAmount <= 0 || effectiveAmount > policy.CoverageLimitMinor {
		return nil, fmt.Errorf("proposedAmountMinor must be within the policy coverage limit")
	}
	effectiveIncidentDate := strings.TrimSpace(proposedIncidentDate)
	if effectiveIncidentDate == "" {
		effectiveIncidentDate = claim.IncidentDate
	}
	incident, err := validateDate("proposedIncidentDate", effectiveIncidentDate)
	if err != nil {
		return nil, err
	}
	start, _ := validateDate("startDate", policy.StartDate)
	end, _ := validateDate("endDate", policy.EndDate)
	if incident.Before(start) || incident.After(end) {
		return nil, fmt.Errorf("proposedIncidentDate is outside the policy coverage period")
	}
	effectiveDescriptionHash := strings.ToLower(strings.TrimSpace(proposedDescriptionHash))
	if effectiveDescriptionHash == "" {
		effectiveDescriptionHash = strings.ToLower(claim.DescriptionHash)
	} else if err := validateHash("proposedDescriptionHash", effectiveDescriptionHash); err != nil {
		return nil, err
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	appeal := &ClaimAppeal{
		AssetType: "claimAppeal", SchemaVersion: SchemaVersion, ID: appealID,
		ClaimID: claimID, ClaimantID: subject, ClaimVersion: claim.Version + 1,
		Round: claim.AppealCount + 1, CommitmentVersion: appealCommitmentVersion,
		ReasonCategory: reasonCategory, ReasonHash: strings.ToLower(reasonHash),
		DescriptionHash: strings.ToLower(descriptionHash), EvidenceHash: strings.ToLower(evidenceHash),
		OriginalClaimHash: claimFactsHash(claim), ProposedHospitalID: effectiveHospitalID,
		ProposedAmountMinor:  effectiveAmount,
		ProposedIncidentDate: effectiveIncidentDate, ProposedDescriptionHash: effectiveDescriptionHash,
		ProposedClinicalReferenceHash: strings.ToLower(proposedClinicalReferenceHash),
		Status:                        "SUBMITTED", CreatedAt: now,
	}
	appeal.CommitmentHash = appealCommitmentHash(appeal)
	if err := putState(ctx, "claimAppeal", appealID, appeal); err != nil {
		return nil, err
	}
	claim.AppealCount = appeal.Round
	claim.CurrentAppealID = appealID
	claim.Version = appeal.ClaimVersion
	claim.HospitalID = effectiveHospitalID
	claim.AmountMinor = effectiveAmount
	claim.IncidentDate = effectiveIncidentDate
	claim.DescriptionHash = effectiveDescriptionHash
	claim.HospitalVerificationID = ""
	claim.AuditorDecisionID = ""
	claim.CurrentReviewID = ""
	claim.CurrentOracleRequestID = ""
	claim.OracleOutcome = ""
	claim.OracleResultHash = ""
	claim.Status = "APPEAL_SUBMITTED"
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claim", claimID, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "ClaimAppealSubmitted", appeal); err != nil {
		return nil, err
	}
	return appeal, nil
}

func (c *Contract) OpenAppealReview(
	ctx contractapi.TransactionContextInterface,
	appealID, reviewID, assignedAuditorIDsJSON string,
	approvalThreshold, rejectionThreshold int,
	deadline string,
) (*ClaimReview, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("appeal %s must complete fresh hospital and Oracle verification; route a finalized Oracle failure to review instead", appealID)
}

func containsAssignment(assignments []string, auditorID string) bool {
	for _, assigned := range assignments {
		if assigned == auditorID {
			return true
		}
	}
	return false
}

func (c *Contract) RecordAuditorDecision(ctx contractapi.TransactionContextInterface, reviewID, decisionID, outcome, reasonHash string) (*AuditorDecision, error) {
	auditorIdentity, err := requireIdentity(ctx, "AuditorMSP", "auditor")
	if err != nil {
		return nil, err
	}
	auditorID, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	review, err := c.ReadClaimReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	if review.Status != "OPEN" {
		return nil, fmt.Errorf("review %s is already finalized", reviewID)
	}
	if !containsAssignment(review.AssignedAuditorIDs, auditorID) {
		return nil, fmt.Errorf("auditor %s is not assigned to review %s", auditorID, reviewID)
	}
	txTime, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return nil, fmt.Errorf("read transaction timestamp: %w", err)
	}
	deadline, _ := time.Parse(time.RFC3339, review.Deadline)
	if txTime.AsTime().After(deadline) {
		return nil, fmt.Errorf("review %s deadline has passed", reviewID)
	}
	outcome = strings.ToUpper(strings.TrimSpace(outcome))
	if outcome != "APPROVE" && outcome != "REJECT" {
		return nil, fmt.Errorf("outcome must be APPROVE or REJECT")
	}
	if err := validateHash("reasonHash", reasonHash); err != nil {
		return nil, err
	}
	voteKey, err := reviewDecisionKey(ctx, reviewID, auditorID)
	if err != nil {
		return nil, err
	}
	existing, err := ctx.GetStub().GetState(voteKey)
	if err != nil {
		return nil, fmt.Errorf("check auditor vote: %w", err)
	}
	if existing != nil {
		return nil, fmt.Errorf("auditor %s has already voted in review %s", auditorID, reviewID)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	decision := &AuditorDecision{
		AssetType: "auditorDecision", SchemaVersion: SchemaVersion, ID: decisionID,
		ClaimID: review.ClaimID, ReviewID: reviewID, ReviewRound: review.Round,
		AuditorID: auditorID, AuditorIdentity: auditorIdentity, Outcome: outcome,
		ReasonHash: strings.ToLower(reasonHash), CreatedAt: now,
	}
	if err := putState(ctx, "auditorDecision", decisionID, decision); err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutState(voteKey, []byte(decisionID)); err != nil {
		return nil, fmt.Errorf("write auditor vote marker: %w", err)
	}
	if outcome == "APPROVE" {
		review.Approvals++
	} else {
		review.Rejections++
	}
	review.VotesCast++

	claim, err := c.ReadClaim(ctx, review.ClaimID)
	if err != nil {
		return nil, err
	}
	finalized := review.Approvals >= review.ApprovalThreshold || review.Rejections >= review.RejectionThreshold
	if finalized {
		approved := review.Approvals >= review.ApprovalThreshold
		if approved {
			review.Status = "APPROVED"
			claim.Status = "APPROVED"
		} else {
			review.Status = "REJECTED"
			claim.Status = "REJECTED"
		}
		review.ClosedAt = now
		claim.AuditorDecisionID = decisionID
		if review.AppealID != "" {
			appeal, readErr := c.ReadClaimAppeal(ctx, review.AppealID)
			if readErr != nil {
				return nil, readErr
			}
			if approved {
				appeal.Status = "OVERTURNED"
			} else {
				appeal.Status = "UPHELD"
			}
			appeal.ResolvedAt = now
			if err := overwriteAsset(ctx, "claimAppeal", appeal.ID, appeal); err != nil {
				return nil, err
			}
		}
	}
	claim.UpdatedAt = now
	if err := overwriteAsset(ctx, "claimReview", reviewID, review); err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "AuditorDecisionRecorded", decision); err != nil {
		return nil, err
	}
	return decision, nil
}

func (c *Contract) FinalizeExpiredReview(ctx contractapi.TransactionContextInterface, reviewID string) (*ClaimReview, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	review, err := c.ReadClaimReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	if review.Status != "OPEN" {
		return nil, fmt.Errorf("review %s is already finalized", reviewID)
	}
	txTime, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return nil, fmt.Errorf("read transaction timestamp: %w", err)
	}
	deadline, _ := time.Parse(time.RFC3339, review.Deadline)
	if !txTime.AsTime().After(deadline) {
		return nil, fmt.Errorf("review %s deadline is still active", reviewID)
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	review.Status = "TIMED_OUT"
	review.ClosedAt = now
	claim, err := c.ReadClaim(ctx, review.ClaimID)
	if err != nil {
		return nil, err
	}
	claim.Status = "REJECTED"
	claim.UpdatedAt = now
	if review.AppealID != "" {
		appeal, readErr := c.ReadClaimAppeal(ctx, review.AppealID)
		if readErr != nil {
			return nil, readErr
		}
		appeal.Status = "UPHELD"
		appeal.ResolvedAt = now
		if err := overwriteAsset(ctx, "claimAppeal", appeal.ID, appeal); err != nil {
			return nil, err
		}
	}
	if err := overwriteAsset(ctx, "claimReview", reviewID, review); err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	if err := emit(ctx, "ClaimReviewTimedOut", review); err != nil {
		return nil, err
	}
	return review, nil
}

func (c *Contract) RecordFraudAssessment(
	ctx contractapi.TransactionContextInterface,
	id, claimID, engineID, engineVersion, modelHash, inputHash string,
	scoreBps int, riskLevel, signalsJSON string,
) (*FraudAssessment, error) {
	recordedBy, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin")
	if err != nil {
		return nil, err
	}
	if _, err := c.ReadClaim(ctx, claimID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(engineID) == "" || strings.TrimSpace(engineVersion) == "" {
		return nil, fmt.Errorf("engine id and version are required")
	}
	if err := validateHash("modelHash", modelHash); err != nil {
		return nil, err
	}
	if err := validateHash("inputHash", inputHash); err != nil {
		return nil, err
	}
	if scoreBps < 0 || scoreBps > 10_000 {
		return nil, fmt.Errorf("scoreBps must be between 0 and 10000")
	}
	riskLevel = strings.ToUpper(strings.TrimSpace(riskLevel))
	if riskLevel != "LOW" && riskLevel != "MEDIUM" && riskLevel != "HIGH" {
		return nil, fmt.Errorf("riskLevel must be LOW, MEDIUM, or HIGH")
	}
	var signals []string
	if err := json.Unmarshal([]byte(signalsJSON), &signals); err != nil {
		return nil, fmt.Errorf("signals must be a JSON string array")
	}
	if len(signals) > 12 {
		return nil, fmt.Errorf("at most 12 fraud signals may be recorded")
	}
	for index, signal := range signals {
		signal = strings.ToUpper(strings.TrimSpace(signal))
		if !idPattern.MatchString(signal) {
			return nil, fmt.Errorf("fraud signal %q is invalid", signal)
		}
		signals[index] = signal
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	assessment := &FraudAssessment{
		AssetType: "fraudAssessment", SchemaVersion: SchemaVersion, ID: id, ClaimID: claimID,
		EngineID: strings.TrimSpace(engineID), EngineVersion: strings.TrimSpace(engineVersion),
		ModelHash: strings.ToLower(modelHash), InputHash: strings.ToLower(inputHash),
		ScoreBps: scoreBps, RiskLevel: riskLevel, Signals: signals, Advisory: true,
		RecordedBy: recordedBy, CreatedAt: now,
	}
	if err := putState(ctx, "fraudAssessment", id, assessment); err != nil {
		return nil, err
	}
	if err := emit(ctx, "FraudAssessmentRecorded", assessment); err != nil {
		return nil, err
	}
	return assessment, nil
}

func (c *Contract) ReadClaimReview(ctx contractapi.TransactionContextInterface, id string) (*ClaimReview, error) {
	return getState[ClaimReview](ctx, "claimReview", id)
}

func (c *Contract) ReadClaimAppeal(ctx contractapi.TransactionContextInterface, id string) (*ClaimAppeal, error) {
	return getState[ClaimAppeal](ctx, "claimAppeal", id)
}

func (c *Contract) ReadFraudAssessment(ctx contractapi.TransactionContextInterface, id string) (*FraudAssessment, error) {
	return getState[FraudAssessment](ctx, "fraudAssessment", id)
}
