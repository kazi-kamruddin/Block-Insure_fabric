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

func (c *Contract) deriveMedicalApprovalV3(ctx contractapi.TransactionContextInterface, cert *ApprovalCertificate, request *OracleRequest, current *ClaimReview, vote *AuditorDecision, selection *MedicalAuditSelection, issuedAt string) error {
	cert.CertificateVersion = 3
	cert.DecidedAt, cert.IssuedAt = cert.ApprovedAt, issuedAt
	transcript, err := medicalReviewTranscriptHash(ctx, cert.ClaimID, current, vote)
	if err != nil {
		return err
	}
	cert.ReviewTranscriptHash = transcript
	if selection == nil {
		selection, err = readMedicalAuditSelection(ctx, cert.ClaimID, cert.ClaimVersion)
		if err != nil {
			return err
		}
	}
	if selection != nil {
		cert.SamplingRecordHash = medicalSamplingRecordHash(selection)
		if current == nil && selection.ResolvedAt != "" {
			cert.DecidedAt = selection.ResolvedAt
		}
	}
	decided, err := time.Parse(time.RFC3339Nano, cert.DecidedAt)
	if err != nil {
		return fmt.Errorf("invalid certificate decision time: %w", err)
	}
	issued, err := time.Parse(time.RFC3339Nano, cert.IssuedAt)
	if err != nil || issued.Before(decided) {
		return fmt.Errorf("certificate issuance precedes its decision")
	}
	if request != nil && request.ProtocolVersion == "v2" {
		cert.ManifestHash, cert.FactVectorHash, cert.Decision, cert.PolicyVersion =
			request.ManifestHash, request.FactVectorHash, request.Decision, request.PolicyVersion
	}
	cert.Hash = canonicalProtocolHash("fabric-medical-approval-v3", cert.Hash, cert.ReviewTranscriptHash, cert.SamplingRecordHash,
		cert.ManifestHash, cert.FactVectorHash, cert.Decision, cert.PolicyVersion, cert.BreakdownHash, cert.DecidedAt, cert.IssuedAt)
	return nil
}

func readMedicalAuditSelection(ctx contractapi.TransactionContextInterface, claimID string, version int) (*MedicalAuditSelection, error) {
	key, err := stateKey(ctx, "medicalAuditSelection", medicalRevisionKey(claimID, version))
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil || len(raw) == 0 {
		return nil, err
	}
	var selection MedicalAuditSelection
	if err := json.Unmarshal(raw, &selection); err != nil {
		return nil, err
	}
	return &selection, nil
}

func medicalSamplingRecordHash(selection *MedicalAuditSelection) string {
	if selection.Status == "" {
		return canonicalProtocolHash("fabric-medical-audit-record-v1", selection.PeriodID, selection.ClaimID,
			strconv.Itoa(selection.Version), selection.ResultHash, selection.Digest, strconv.Itoa(selection.RateBps), strconv.FormatBool(selection.Selected))
	}
	return canonicalProtocolHash("fabric-medical-audit-record-v2", selection.PeriodID, selection.ClaimID,
		strconv.Itoa(selection.Version), selection.EpisodeRevisionHash, selection.Digest, strconv.Itoa(selection.RateBps),
		strconv.FormatBool(selection.Selected), selection.Status, selection.ResolvedAt)
}

func medicalReviewTranscriptHash(ctx contractapi.TransactionContextInterface, claimID string, current *ClaimReview, pending *AuditorDecision) (string, error) {
	if current == nil {
		return canonicalProtocolHash("medical-review-transcript-v1", claimID), nil
	}
	reviews, err := listState[ClaimReview](ctx, "claimReview")
	if err != nil {
		return "", err
	}
	rounds := make([]ClaimReview, 0, current.Round)
	for _, review := range reviews {
		if review.ClaimID == claimID && review.Round < current.Round {
			rounds = append(rounds, review)
		}
	}
	rounds = append(rounds, *current)
	slices.SortFunc(rounds, func(a, b ClaimReview) int {
		if a.Round != b.Round {
			return a.Round - b.Round
		}
		return strings.Compare(a.ID, b.ID)
	})
	transcript := []string{claimID}
	for _, review := range rounds {
		fields := []string{review.ID, strconv.Itoa(review.Round), strconv.Itoa(review.MedicalVersion), review.Kind, review.Status,
			review.BallotVersion, review.RosterVersion, review.StandbyForReviewID, review.InitialPrepareBy, review.PrepareBy,
			review.OpenedAt, review.CommitDeadline, review.Deadline, review.ClosedAt}
		for _, replacement := range review.Replacements {
			fields = append(fields, canonicalProtocolHash("medical-auditor-replacement-v1", replacement.AbsentAuditorID, replacement.NewAuditorID, replacement.ReplacedAt))
		}
		for _, auditor := range review.AssignedAuditorIDs {
			commitment, committedAt := "", ""
			if review.BallotVersion == sealedPanelBallot {
				key, err := panelVoteKey(ctx, review.ID, auditor)
				if err != nil {
					return "", err
				}
				record, err := readPanelVoteCommitment(ctx, key)
				if err != nil {
					return "", err
				}
				if record != nil {
					commitment, committedAt = record.Commitment, record.CommittedAt
				}
			}
			decision, err := medicalTranscriptDecision(ctx, review.ID, auditor, pending)
			if err != nil {
				return "", err
			}
			seat := []string{auditor, commitment, committedAt}
			if decision != nil {
				seat = append(seat, decision.ID, decision.Outcome, decision.ReasonCode, decision.ReasonHash, decision.CreatedAt, decision.BallotSalt)
			}
			fields = append(fields, canonicalProtocolHash("medical-review-seat-v1", seat...))
		}
		transcript = append(transcript, canonicalProtocolHash("medical-review-round-v1", fields...))
	}
	return canonicalProtocolHash("medical-review-transcript-v1", transcript...), nil
}

func medicalTranscriptDecision(ctx contractapi.TransactionContextInterface, reviewID, auditor string, pending *AuditorDecision) (*AuditorDecision, error) {
	if pending != nil && pending.ReviewID == reviewID && pending.AuditorID == auditor {
		return pending, nil
	}
	key, err := reviewDecisionKey(ctx, reviewID, auditor)
	if err != nil {
		return nil, err
	}
	id, err := ctx.GetStub().GetState(key)
	if err != nil || len(id) == 0 {
		return nil, err
	}
	return getState[AuditorDecision](ctx, "auditorDecision", string(id))
}
