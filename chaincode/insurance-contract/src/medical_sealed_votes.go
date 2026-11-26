package insurance

import (
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const sealedPanelBallot = "panel-vote-v1"

type PanelVoteCommitment struct {
	ReviewID     string `json:"reviewId"`
	Round        int    `json:"round"`
	ClaimVersion int    `json:"claimVersion"`
	AuditorID    string `json:"auditorId"`
	Commitment   string `json:"commitment"`
	CommittedAt  string `json:"committedAt"`
}

type AuditorReplacement struct {
	AbsentAuditorID string `json:"absentAuditorId"`
	NewAuditorID    string `json:"newAuditorId"`
	ReplacedAt      string `json:"replacedAt"`
}

func sealedVoteHash(review *ClaimReview, auditorID, outcome, reasonHash, salt string) string {
	return canonicalProtocolHash(sealedPanelBallot, review.ID, strconv.Itoa(review.Round),
		strconv.Itoa(review.MedicalVersion), auditorID, outcome, reasonHash, salt)
}

func panelVoteKey(ctx contractapi.TransactionContextInterface, reviewID, auditorID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey("panelVoteCommitment", []string{reviewID, auditorID})
}

func (c *Contract) ListAuditorVoteCommitments(ctx contractapi.TransactionContextInterface, reviewID string) ([]PanelVoteCommitment, error) {
	review, err := c.ReadClaimReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	return readPanelVoteCommitments(ctx, review)
}

func readPanelVoteCommitments(ctx contractapi.TransactionContextInterface, review *ClaimReview) ([]PanelVoteCommitment, error) {
	result := []PanelVoteCommitment{}
	if review.BallotVersion == "" {
		return result, nil
	}
	for _, auditor := range review.AssignedAuditorIDs {
		key, err := panelVoteKey(ctx, review.ID, auditor)
		if err != nil {
			return nil, err
		}
		record, err := readPanelVoteCommitment(ctx, key)
		if err != nil {
			return nil, err
		}
		if record != nil {
			result = append(result, *record)
		}
	}
	return result, nil
}

func readPanelVoteCommitment(ctx contractapi.TransactionContextInterface, key string) (*PanelVoteCommitment, error) {
	raw, err := ctx.GetStub().GetState(key)
	if err != nil || len(raw) == 0 {
		return nil, err
	}
	var record PanelVoteCommitment
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, err
	}
	return &record, nil
}

func (c *Contract) CommitAuditorVote(ctx contractapi.TransactionContextInterface, reviewID string, round int, commitment string) (*PanelVoteCommitment, error) {
	if _, err := requireIdentity(ctx, "AuditorMSP", "auditor"); err != nil {
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
	if review.Status != "OPEN" || review.BallotVersion != sealedPanelBallot || review.Round != round ||
		claim.Status != "UNDER_REVIEW" || !containsAssignment(review.AssignedAuditorIDs, subject) || !oracleV2Hash.MatchString(commitment) {
		return nil, fmt.Errorf("assigned auditor and current sealed ballot required")
	}
	deadline, err := time.Parse(time.RFC3339Nano, review.CommitDeadline)
	if err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	// The first revealed vote closes sealing in ledger state, so the ±15 s
	// timestamp tolerance cannot admit a ballot chosen after seeing a vote.
	// CommitmentsCast++ below writes the same review key, so MVCC serializes
	// a racing reveal.
	if !now.Before(deadline) || review.VotesCast > 0 {
		return nil, fmt.Errorf("panel commitment deadline has elapsed")
	}
	if _, err := currentMedicalHead(ctx, claim); err != nil {
		return nil, err
	}
	key, err := panelVoteKey(ctx, review.ID, subject)
	if err != nil {
		return nil, err
	}
	prior, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if len(prior) != 0 {
		return nil, fmt.Errorf("auditor already committed a vote")
	}
	record := &PanelVoteCommitment{ReviewID: review.ID, Round: review.Round, ClaimVersion: claim.Version,
		AuditorID: subject, Commitment: commitment, CommittedAt: now.Format(time.RFC3339Nano)}
	if err := overwriteState(ctx, key, record); err != nil {
		return nil, err
	}
	review.CommitmentsCast++
	if err := overwriteAsset(ctx, "claimReview", review.ID, review); err != nil {
		return nil, err
	}
	return record, emit(ctx, "AuditorVoteCommitted", record)
}

func (c *Contract) RevealAuditorVote(ctx contractapi.TransactionContextInterface, reviewID string, round int, decisionID, outcome, reasonCode, reasonHash, salt string) (*AuditorDecision, error) {
	if _, err := requireIdentity(ctx, "AuditorMSP", "auditor"); err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	review, _, err := c.currentMedicalReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	if review.Status != "OPEN" || review.BallotVersion != sealedPanelBallot || review.Round != round || !oracleV2Hash.MatchString(salt) {
		return nil, fmt.Errorf("current sealed ballot and 32-byte salt required")
	}
	if !oracleV2Hash.MatchString(reasonHash) {
		return nil, fmt.Errorf("invalid medical vote reason hash")
	}
	outcome = strings.ToUpper(strings.TrimSpace(outcome))
	if err := validateMedicalVoteReason(reasonCode, outcome); err != nil {
		return nil, err
	}
	commitDeadline, err := time.Parse(time.RFC3339Nano, review.CommitDeadline)
	if err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	if now.Before(commitDeadline) && review.CommitmentsCast < len(review.AssignedAuditorIDs) {
		return nil, fmt.Errorf("panel reveal window is not open")
	}
	key, err := panelVoteKey(ctx, review.ID, subject)
	if err != nil {
		return nil, err
	}
	record, err := readPanelVoteCommitment(ctx, key)
	if err != nil {
		return nil, err
	}
	boundReason := canonicalProtocolHash("medical-reason-v1", reasonCode, reasonHash)
	if record == nil || record.Commitment != sealedVoteHash(review, subject, outcome, boundReason, salt) {
		return nil, fmt.Errorf("vote reveal does not match its commitment")
	}
	return c.recordAuditorDecision(ctx, reviewID, decisionID, outcome, boundReason, reasonCode, salt)
}

func (c *Contract) AcknowledgeMedicalReview(ctx contractapi.TransactionContextInterface, reviewID string) (*ClaimReview, error) {
	if _, err := requireIdentity(ctx, "AuditorMSP", "auditor"); err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	review, _, err := c.currentMedicalReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	if review.Status != "PREPARING" || review.BallotVersion != sealedPanelBallot || review.DisclosureIssuedAt == "" ||
		!containsAssignment(review.AssignedAuditorIDs, subject) {
		return nil, fmt.Errorf("assigned auditor and prepared disclosure required")
	}
	if slices.Contains(review.AcknowledgedAuditors, subject) {
		return review, nil
	}
	review.AcknowledgedAuditors = append(review.AcknowledgedAuditors, subject)
	slices.Sort(review.AcknowledgedAuditors)
	return review, overwriteAsset(ctx, "claimReview", review.ID, review)
}

func (c *Contract) ReplaceAbsentAuditor(ctx contractapi.TransactionContextInterface, reviewID, auditorID string) (*ClaimReview, error) {
	review, claim, err := c.currentMedicalReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	if err := requireEligibleClaimDeadlineActor(ctx, claim, review.AssignedAuditorIDs); err != nil {
		return nil, err
	}
	seat := slices.Index(review.AssignedAuditorIDs, auditorID)
	if review.BallotVersion != sealedPanelBallot || review.Status != "PREPARING" || seat < 0 ||
		slices.Contains(review.AcknowledgedAuditors, auditorID) || slices.ContainsFunc(review.Replacements, func(replacement AuditorReplacement) bool {
		return replacement.NewAuditorID == auditorID
	}) {
		return nil, fmt.Errorf("unacknowledged original seat in preparation required")
	}
	deadline, err := time.Parse(time.RFC3339Nano, review.PrepareBy)
	if err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	if now.Before(deadline) {
		return nil, fmt.Errorf("preparation deadline has not elapsed")
	}
	if len(review.StandbyAuditorIDs) == 0 {
		return nil, fmt.Errorf("no eligible replacement remains; finalize the expired preparation")
	}
	replacement := review.StandbyAuditorIDs[0]
	review.StandbyAuditorIDs = review.StandbyAuditorIDs[1:]
	review.AssignedAuditorIDs[seat] = replacement
	review.Replacements = append(review.Replacements, AuditorReplacement{AbsentAuditorID: auditorID, NewAuditorID: replacement, ReplacedAt: now.Format(time.RFC3339Nano)})
	if len(review.Replacements) == 1 {
		review.PrepareBy = now.Add(timingWaits(review.TimingProfile).replacement).Format(time.RFC3339Nano)
	}
	if err := overwriteAsset(ctx, "claimReview", review.ID, review); err != nil {
		return nil, err
	}
	return review, emit(ctx, "MedicalAuditorReplaced", review)
}
