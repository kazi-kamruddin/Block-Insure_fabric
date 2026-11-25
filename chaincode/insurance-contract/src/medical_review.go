package insurance

import (
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

var medicalPanel = []string{"auditor1", "auditor2", "auditor3", "auditor4"}

func medicalReviewClock(ctx contractapi.TransactionContextInterface, deadline string) (time.Time, error) {
	ts, err := ledgerNow(ctx)
	if err != nil {
		return time.Time{}, err
	}
	end, err := time.Parse(time.RFC3339, deadline)
	if err != nil || !end.After(ts) || (usesMedicalApprovalCertificates(ctx) && end.Before(ts.Add(time.Minute))) || end.After(ts.Add(14*24*time.Hour)) {
		return time.Time{}, fmt.Errorf("choose a future deadline within fourteen days")
	}
	return end, nil
}

func (c *Contract) PrepareMedicalReview(ctx contractapi.TransactionContextInterface, claimID, reviewID, prepareBy string) (*ClaimReview, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	var request *OracleRequest
	if usesMedicalApprovalCertificates(ctx) && claim.EpisodeID != "" && claim.CurrentOracleRequestID != "" &&
		(claim.Status == "ORACLE_PENDING" || claim.Status == "APPROVED" || claim.Status == "SETTLEMENT_AUTHORIZED" ||
			(claim.CurrentReviewID == "" && (claim.Status == "ORACLE_FAILED" || claim.Status == "MEDICAL_REVIEW_REQUIRED"))) {
		request, err = c.ReadOracleRequest(ctx, claim.CurrentOracleRequestID)
		if err != nil {
			return nil, err
		}
		held, err := c.heldMedicalRequest(ctx, request)
		if err != nil {
			return nil, err
		}
		if held && claim.MedicalHeldReleaseID == "" && request.ClaimVersion == claim.Version {
			if claim.Status == "APPROVED" || claim.Status == "SETTLEMENT_AUTHORIZED" {
				cert, err := c.ReadMedicalApprovalCertificate(ctx, claim.ID, claim.Version)
				if err != nil {
					return nil, err
				}
				if cert.Path != "ORACLE_AUTO" {
					return nil, fmt.Errorf("held-release replacement requires an automatic certificate")
				}
			}
			claim.MedicalHeldReleaseID = effectiveMedicalModelReleaseID(request)
			if claim.Status == "SETTLEMENT_AUTHORIZED" {
				if err := c.supersedeUnpaidMedicalSettlement(ctx, claim); err != nil {
					return nil, err
				}
				claim.MedicalSettlementID = ""
			}
			if claim.Status == "ORACLE_PENDING" {
				now, err := ledgerTimestamp(ctx)
				if err != nil {
					return nil, err
				}
				if err := c.finalizeOracleRequest(ctx, request, claim, false, "", "MODEL_HELD", now); err != nil {
					return nil, err
				}
			}
			claim.CurrentReviewID, claim.AuditorDecisionID, claim.Status = "", "", "MEDICAL_REVIEW_REQUIRED"
		}
	}
	if usesMedicalApprovalCertificates(ctx) && claim.EpisodeID != "" && claim.CurrentOracleRequestID == "" &&
		(claim.Status == "SUBMITTED" || claim.Status == "APPEAL_SUBMITTED") {
		release, err := c.activeMedicalRoutingRelease(ctx)
		if err != nil {
			return nil, err
		}
		if release.Status == "HELD" {
			claim.MedicalHeldReleaseID, claim.Status = release.ID, "MEDICAL_REVIEW_REQUIRED"
		}
	}
	if claim.EpisodeID == "" || claim.CurrentReviewID != "" || (claim.Status != "ORACLE_FAILED" && claim.Status != "MEDICAL_REVIEW_REQUIRED") {
		return nil, fmt.Errorf("medical claim must finish current Oracle verification before preparation")
	}
	if claim.CurrentOracleRequestID != "" || claim.MedicalHeldReleaseID == "" {
		// A Fabric simulation reads committed state, so keep any request
		// finalized by this transaction in memory.
		if request == nil {
			request, err = c.ReadOracleRequest(ctx, claim.CurrentOracleRequestID)
			if err != nil {
				return nil, err
			}
		}
		if request.ClaimVersion != claim.Version || (request.Status != "FAILED" && request.Status != "CONSENSUS") {
			return nil, fmt.Errorf("current verification has not finished")
		}
	}
	panel, err := c.medicalReviewPanel(ctx, claim)
	if err != nil {
		return nil, err
	}
	return c.createMedicalPreparation(ctx, claim, reviewID, prepareBy, panel, true, "")
}

func (c *Contract) medicalReviewPanel(ctx contractapi.TransactionContextInterface, claim *Claim) ([]string, error) {
	roster, err := c.activeAuditorRoster(ctx)
	if err != nil {
		return nil, err
	}
	panel := medicalPanel
	if roster != nil {
		panel = drawAuditors(claim, roster.Subjects)[:4]
	}
	if claim.CurrentAppealID != "" {
		appeal, err := c.ReadClaimAppeal(ctx, claim.CurrentAppealID)
		if err != nil {
			return nil, err
		}
		prior, err := c.ReadClaimReview(ctx, appeal.MedicalPriorReviewID)
		if err != nil {
			return nil, err
		}
		panel = prior.AssignedAuditorIDs
		if roster != nil {
			standbys := make([]string, 0, 2)
			originals := make([]string, 0, 4)
			for _, subject := range roster.Subjects {
				if slices.Contains(panel, subject) {
					originals = append(originals, subject)
				} else {
					standbys = append(standbys, subject)
				}
			}
			if len(standbys) != 2 || len(originals) != 4 {
				return nil, fmt.Errorf("current roster does not support a two-overlap appeal panel")
			}
			panel = append(drawAuditors(claim, standbys), drawAuditors(claim, originals)[:2]...)
		}
	}
	return panel, nil
}

func (c *Contract) createMedicalPreparation(ctx contractapi.TransactionContextInterface, claim *Claim, reviewID, prepareBy string, panel []string, disclose bool, standbyFor string) (*ClaimReview, error) {
	if !isMedicalCandidate(ctx) {
		return nil, fmt.Errorf("isolated medical channel required")
	}
	if _, err := currentMedicalHead(ctx, claim); err != nil {
		return nil, err
	}
	end, err := medicalReviewClock(ctx, prepareBy)
	if err != nil {
		return nil, err
	}
	if err := validateReviewRules(panel, 3, 2); err != nil || len(panel) != 4 {
		return nil, fmt.Errorf("exactly four assigned auditors required")
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	kind := "INITIAL"
	if claim.CurrentAppealID != "" {
		kind = "APPEAL"
	}
	review := &ClaimReview{AssetType: "claimReview", SchemaVersion: SchemaVersion, ID: reviewID, ClaimID: claim.ID, AppealID: claim.CurrentAppealID,
		Round: claim.ReviewRound + 1, Kind: kind, AssignedAuditorIDs: slices.Clone(panel), ApprovalThreshold: 3, RejectionThreshold: 2,
		Status: "PREPARING", MedicalVersion: claim.Version, PrepareBy: end.UTC().Format(time.RFC3339)}
	roster, err := c.activeAuditorRoster(ctx)
	if err != nil {
		return nil, err
	}
	if roster != nil {
		review.RosterVersion, review.BallotVersion, review.StandbyForReviewID = roster.Version, sealedPanelBallot, standbyFor
		review.InitialPrepareBy = review.PrepareBy
		for _, auditor := range drawAuditors(claim, roster.Subjects) {
			if !slices.Contains(panel, auditor) {
				review.StandbyAuditorIDs = append(review.StandbyAuditorIDs, auditor)
			}
		}
		if disclose {
			if err := bindReviewDisclosure(ctx, review, claim); err != nil {
				return nil, err
			}
		}
	}
	if err := putState(ctx, "claimReview", reviewID, review); err != nil {
		return nil, err
	}
	claim.CurrentReviewID, claim.ReviewRound, claim.Status, claim.UpdatedAt = review.ID, review.Round, "MEDICAL_REVIEW_PREPARING", now
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	return review, emit(ctx, "MedicalReviewPreparing", review)
}

func (c *Contract) currentMedicalReview(ctx contractapi.TransactionContextInterface, reviewID string) (*ClaimReview, *Claim, error) {
	review, err := c.ReadClaimReview(ctx, reviewID)
	if err != nil {
		return nil, nil, err
	}
	claim, err := c.ReadClaim(ctx, review.ClaimID)
	if err != nil {
		return nil, nil, err
	}
	if claim.EpisodeID == "" || claim.CurrentReviewID != reviewID || claim.Version != review.MedicalVersion {
		return nil, nil, fmt.Errorf("medical review is stale")
	}
	return review, claim, nil
}

func (c *Contract) OpenMedicalVoting(ctx contractapi.TransactionContextInterface, reviewID, deadline string) (*ClaimReview, error) {
	review, claim, err := c.currentMedicalReview(ctx, reviewID)
	if err != nil {
		return nil, err
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		if !usesMedicalApprovalCertificates(ctx) || claim.MedicalEscalatedAt == "" {
			return nil, err
		}
		if _, auditorErr := requireIdentity(ctx, "AuditorMSP", "auditor"); auditorErr != nil {
			return nil, auditorErr
		}
		subject, subjectErr := callerSubject(ctx)
		if subjectErr != nil || !containsAssignment(review.AssignedAuditorIDs, subject) {
			return nil, fmt.Errorf("assigned auditor required to open escalated review")
		}
	}
	if review.Status != "PREPARING" {
		return nil, fmt.Errorf("review is not in access preparation")
	}
	if review.BallotVersion == sealedPanelBallot &&
		(review.DisclosureIssuedAt == "" || len(review.AcknowledgedAuditors) != len(review.AssignedAuditorIDs)) {
		return nil, fmt.Errorf("all assigned auditors must acknowledge the review disclosure before voting")
	}
	if _, err := currentMedicalHead(ctx, claim); err != nil {
		return nil, err
	}
	if _, err := medicalReviewClock(ctx, review.PrepareBy); err != nil {
		return nil, fmt.Errorf("access preparation expired")
	}
	if claim.MedicalClarificationID != "" {
		note, err := c.readClarification(ctx, claim.MedicalClarificationID)
		if err != nil {
			return nil, err
		}
		if note.Status == "PENDING" {
			return nil, fmt.Errorf("resolve or expire the clarification before opening voting")
		}
	}
	end, err := medicalReviewClock(ctx, deadline)
	if err != nil {
		return nil, err
	}
	docs, err := c.requireXGBoostEvidence(ctx, claim)
	if err != nil {
		return nil, err
	}
	grants, err := c.ListEvidenceAccessGrants(ctx)
	if err != nil {
		return nil, err
	}
	for _, doc := range docs {
		for _, auditor := range review.AssignedAuditorIDs {
			if err := medicalDocumentReady(ctx, review, doc.ID, auditor, end, grants); err != nil {
				return nil, err
			}
		}
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	review.Status, review.OpenedAt, review.Deadline = "OPEN", now, end.UTC().Format(time.RFC3339)
	if review.BallotVersion == sealedPanelBallot {
		start, err := time.Parse(time.RFC3339Nano, now)
		if err != nil {
			return nil, err
		}
		review.CommitDeadline = start.Add(end.Sub(start) / 2).Format(time.RFC3339Nano)
	}
	claim.Status, claim.UpdatedAt = "UNDER_REVIEW", now
	if review.AppealID != "" {
		appeal, err := c.ReadClaimAppeal(ctx, review.AppealID)
		if err != nil {
			return nil, err
		}
		appeal.Status, appeal.ReviewID = "UNDER_REVIEW", review.ID
		if err := overwriteAsset(ctx, "claimAppeal", appeal.ID, appeal); err != nil {
			return nil, err
		}
	}
	if err := overwriteAsset(ctx, "claimReview", review.ID, review); err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "claim", claim.ID, claim); err != nil {
		return nil, err
	}
	return review, emit(ctx, "ClaimReviewOpened", review)
}

func (c *Contract) RecoverMedicalReview(ctx contractapi.TransactionContextInterface, priorID, newID, prepareBy string) (*ClaimReview, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	prior, claim, err := c.currentMedicalReview(ctx, priorID)
	if err != nil {
		return nil, err
	}
	procedural := claim.Status == "MEDICAL_REVIEW_REQUIRED" && prior.Status == "PROCEDURAL_FAILURE"
	legacy := claim.Status == "REJECTED" && (prior.Status == "TIMED_OUT" || prior.Status == "ACCESS_FAILED")
	if !procedural && (!legacy || claim.MedicalRecoveryUsed) {
		return nil, fmt.Errorf("no procedural recovery is available")
	}
	if legacy {
		if err := requireOpenMedicalRejection(ctx, prior, claim); err != nil {
			return nil, err
		}
	}
	claim.MedicalRecoveryUsed = true
	panel := prior.AssignedAuditorIDs
	standbyFor := ""
	if prior.BallotVersion == sealedPanelBallot {
		if prior.StandbyForReviewID != "" {
			return nil, fmt.Errorf("standby round already used")
		}
		roster, err := c.ReadAuditorRoster(ctx, prior.RosterVersion)
		if err != nil {
			return nil, err
		}
		panel = make([]string, 0, 4)
		originals := make([]string, 0, 4)
		for _, subject := range roster.Subjects {
			if slices.Contains(prior.AssignedAuditorIDs, subject) {
				originals = append(originals, subject)
			} else {
				panel = append(panel, subject)
			}
		}
		panel = append(drawAuditors(claim, panel), drawAuditors(claim, originals)[:2]...)
		standbyFor = prior.ID
	}
	return c.createMedicalPreparation(ctx, claim, newID, prepareBy, panel, true, standbyFor)
}

func medicalReviewDocumentKey(reviewID, evidenceID, auditorID string) string {
	return canonicalProtocolHash("medical-document-access-v1", reviewID, evidenceID, auditorID)
}

func medicalDocumentReady(ctx contractapi.TransactionContextInterface, review *ClaimReview, id, auditor string, end time.Time, grants []EvidenceAccessGrant) error {
	check, err := getState[MedicalEvidenceCheck](ctx, "medicalEvidenceCheck", medicalReviewDocumentKey(review.ID, id, auditor))
	if err != nil {
		return fmt.Errorf("%s must confirm decryption of %s", auditor, id)
	}
	for _, grant := range grants {
		expiration, err := time.Parse(time.RFC3339, grant.ExpiresAt)
		if err == nil && grant.ID == check.GrantID && grant.MedicalReviewID == review.ID &&
			grant.Status == "ACTIVE" && grant.AccessCount < grant.MaxAccesses && !expiration.Before(end) {
			return nil
		}
	}
	return fmt.Errorf("current grant for %s and %s must remain usable through voting", auditor, id)
}

func medicalSuccessorHash(statementHash, kind string, version int, noteHash string) string {
	return canonicalProtocolHash("fabric-medical-successor-v1", statementHash, kind, strconv.Itoa(version), noteHash)
}
