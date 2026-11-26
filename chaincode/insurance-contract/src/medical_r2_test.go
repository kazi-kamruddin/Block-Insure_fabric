package insurance

import (
	"slices"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

func activateR2Roster(t *testing.T, f medicalSettlementFixture) {
	t.Helper()
	c, ctx := f.contract, f.context
	setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
	_, err := c.ProposeAuditorRoster(ctx, "auditors-r2", `["auditor1","auditor2","auditor3","auditor4","auditor5","auditor6"]`)
	requireNoError(t, err)
	_, err = c.ActivateAuditorRoster(ctx, "auditors-r2")
	requireError(t, err, "approved")
	for _, actor := range []struct{ msp, role string }{{"InsurerMSP", "insurerAdmin"}, {"OracleMSP", "oracle"}, {"AuditorMSP", "auditor"}} {
		setIdentity(ctx, actor.role, actor.msp, actor.role, nil)
		_, err = c.ApproveAuditorRoster(ctx, "auditors-r2")
		requireNoError(t, err)
	}
	setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
	_, err = c.ActivateAuditorRoster(ctx, "auditors-r2")
	requireNoError(t, err)
}

func TestR2HistoricalApprovalAndBankBinding(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	original, err := f.contract.ReadMedicalApprovalCertificate(f.context, f.claim.ID, f.claim.Version)
	requireNoError(t, err)
	activateR2Roster(t, f)
	current, err := f.contract.verifyMedicalApproval(f.context, f.claim)
	requireNoError(t, err)
	if *current != *original || original.CertificateVersion != 0 {
		t.Fatal("R2 changed a historical approval certificate")
	}
	_, err = f.authorize()
	requireNoError(t, err)
	setIdentity(f.context, "bank", "BankMSP", "bankOfficer", map[string]string{"subjectId": "incorrect-bank"})
	_, err = f.contract.ConfirmSettlement(f.context, "settlement", "transfer", strings.Repeat("a", 64))
	requireError(t, err, "Bank signing subject")
	setIdentity(f.context, "bank", "BankMSP", "bankOfficer", map[string]string{"subjectId": "partner-bank"})
	_, err = f.contract.ConfirmSettlement(f.context, "settlement", "transfer", strings.Repeat("a", 64))
	requireNoError(t, err)
}

func TestR2SealedPanelCannotRevealEarlyOrChangeVote(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	activateR2Roster(t, f)
	c, ctx, claim := f.contract, f.context, f.claim
	now := ctx.stub.timestamp.AsTime()
	review := &ClaimReview{ID: "sealed-review", ClaimID: claim.ID, MedicalVersion: claim.Version, Round: 1, Kind: "INITIAL", Status: "OPEN",
		BallotVersion: sealedPanelBallot, RosterVersion: "auditors-r2", AssignedAuditorIDs: []string{"auditor1", "auditor2", "auditor3", "auditor4"},
		ApprovalThreshold: 3, RejectionThreshold: 2, OpenedAt: now.Format(time.RFC3339),
		CommitDeadline: now.Add(time.Minute).Format(time.RFC3339), Deadline: now.Add(2 * time.Minute).Format(time.RFC3339)}
	claim.CurrentReviewID, claim.Status, claim.ReviewRound = review.ID, "UNDER_REVIEW", review.Round
	requireNoError(t, overwriteAsset(ctx, "claim", claim.ID, claim))
	requireNoError(t, putState(ctx, "claimReview", review.ID, review))
	reason := strings.Repeat("a", 64)
	salt := strings.Repeat("b", 64)
	code := "EVIDENCE_DOES_NOT_SUPPORT_SERVICE"
	digest := canonicalProtocolHash("medical-reason-v1", code, reason)
	setAuditor := func(subject string) {
		setIdentity(ctx, subject, "AuditorMSP", "auditor", map[string]string{"subjectId": subject})
	}
	setAuditor("auditor1")
	_, err := c.RecordMedicalAuditorDecision(ctx, review.ID, "legacy-vote", "REJECT", code, reason)
	requireError(t, err, "must be committed")
	_, err = c.CommitAuditorVote(ctx, review.ID, 1, sealedVoteHash(review, "auditor1", "REJECT", digest, salt))
	requireNoError(t, err)
	_, err = c.RevealAuditorVote(ctx, review.ID, 1, "vote1", "REJECT", code, reason, salt)
	requireError(t, err, "not open")
	ctx.stub.timestamp = timestamppb.New(now.Add(61 * time.Second))
	_, err = c.RevealAuditorVote(ctx, review.ID, 1, "vote1", "REJECT", code, reason, reason)
	requireError(t, err, "does not match")
	_, err = c.RevealAuditorVote(ctx, review.ID, 1, "vote1", "REJECT", code, reason, salt)
	requireNoError(t, err)
	ctx.stub.timestamp = timestamppb.New(now.Add(121 * time.Second))
	closed, err := c.FinalizeExpiredReview(ctx, review.ID)
	requireNoError(t, err)
	if closed.Status != "PROCEDURAL_FAILURE" || closed.Rejections != 1 || closed.VotesCast != 1 {
		t.Fatal("unrevealed seats did not abstain")
	}
}

func TestR2AuditMissingShareDefaultsFrozenVersions(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	c, ctx, claim := f.contract, f.context, f.claim
	claim.Status, claim.CurrentOracleRequestID = "SUBMITTED", ""
	requireNoError(t, overwriteAsset(ctx, "claim", claim.ID, claim))
	now := ctx.stub.timestamp.AsTime()
	start, end := now.Add(time.Minute), now.Add(2*time.Minute)
	_, err := c.CreateMedicalAuditPeriod(ctx, "period", start.Format(time.RFC3339), end.Format(time.RFC3339), 2500, 60)
	requireNoError(t, err)
	share := strings.Repeat("b", 64)
	for _, actor := range []struct{ msp, role string }{{"InsurerMSP", "insurerAdmin"}, {"HospitalMSP", "hospitalOfficer"}, {"AuditorMSP", "auditor"}} {
		setIdentity(ctx, actor.role, actor.msp, actor.role, nil)
		_, err = c.CommitMedicalAuditSeedShare(ctx, "period", canonicalProtocolHash("fabric-medical-audit-share-v2", "period", actor.msp, share))
		requireNoError(t, err)
	}
	ctx.stub.timestamp = timestamppb.New(start)
	period, err := c.OpenMedicalAuditPeriod(ctx, "period")
	requireNoError(t, err)
	if len(period.Eligible) != 1 {
		t.Fatal("period did not freeze the pending claim")
	}
	ctx.stub.timestamp = timestamppb.New(end)
	_, err = c.RevealMedicalAuditSeedShare(ctx, "period", share)
	requireNoError(t, err)
	_, err = c.FinalizeMedicalAuditPeriod(ctx, "period")
	requireError(t, err, "grace remains active")
	ctx.stub.timestamp = timestamppb.New(end.Add(time.Minute))
	period, err = c.FinalizeMedicalAuditPeriod(ctx, "period")
	requireNoError(t, err)
	selection, err := c.resolveMedicalAuditSelectionV2(ctx, period, claim)
	requireNoError(t, err)
	if period.Status != "AUDIT_SEED_DEFAULTED" || period.PanelLoad != 1 || !selection.Selected || !oracleV2Hash.MatchString(selection.Hash) {
		t.Fatal("default did not bind the frozen claim to panel review")
	}
}

func TestR2RetiresUnpaidInvalidatedApprovalOnce(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	_, err := f.authorize()
	requireNoError(t, err)
	requireNoError(t, putState(f.context, "medicalCoverage", f.claim.PolicyID, &MedicalCoverage{UsedMinor: f.claim.AmountMinor}))
	requireNoError(t, putPrivateState(f.context, "medicalAssociation", f.claim.MedicalAssociationKey,
		&MedicalAssociation{Verified: false, BeneficiaryID: f.claim.ClaimantID, Version: 2}))
	reason := strings.Repeat("a", 64)
	claim, err := f.contract.RetireInvalidatedApproval(f.context, f.claim.ID, reason)
	requireNoError(t, err)
	again, err := f.contract.RetireInvalidatedApproval(f.context, f.claim.ID, reason)
	requireNoError(t, err)
	original, err := f.contract.ReadOriginalMedicalApprovalCertificate(f.context, f.claim.ID, f.claim.Version)
	requireNoError(t, err)
	coverage, err := getState[MedicalCoverage](f.context, "medicalCoverage", f.claim.PolicyID)
	requireNoError(t, err)
	if claim.Status != "MEDICAL_REVIEW_REQUIRED" || claim.MedicalReserveReleasedAt != again.MedicalReserveReleasedAt ||
		coverage.UsedMinor != 0 || original.SupersededBy != "RETIRED:"+reason {
		t.Fatal("reservation and certificate retirement did not remain consistent")
	}
}

func TestR2DisclosesExactFactsAndReplacesAnUnacknowledgedSeat(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	activateR2Roster(t, f)
	c, ctx, claim := f.contract, f.context, f.claim
	now := ctx.stub.timestamp.AsTime()
	claim.Status, claim.CurrentOracleRequestID = "ORACLE_FAILED", ""
	requireNoError(t, overwriteAsset(ctx, "claim", claim.ID, claim))
	requireNoError(t, putPrivateState(ctx, "medicalEpisodeRevision", medicalRevisionKey(claim.EpisodeID, 1),
		&MedicalEpisode{ID: claim.EpisodeID, Revision: 1, Service: "DIAGNOSTIC", ServiceDate: claim.IncidentDate}))
	requireNoError(t, putPrivateState(ctx, "medicalStatement", medicalRevisionKey(claim.ID, 1), &MedicalQuote{PayableMinor: claim.AmountMinor}))
	source, err := c.ReadMedicalReviewDisclosureSource(ctx, claim.ID)
	requireNoError(t, err)
	panel, err := c.medicalReviewPanel(ctx, claim)
	requireNoError(t, err)
	by := now.Add(2 * time.Minute)
	ctx.stub.transient["medicalEpisodeFacts"] = []byte("{}")
	ctx.stub.transient["medicalStatementFacts"] = source.StatementBytes
	_, err = c.createMedicalPreparation(ctx, claim, "panel-r2", by.Format(time.RFC3339), panel, true, "")
	requireError(t, err, "do not match")
	ctx.stub.transient["medicalEpisodeFacts"] = source.EpisodeBytes
	review, err := c.createMedicalPreparation(ctx, claim, "panel-r2", by.Format(time.RFC3339), panel, true, "")
	requireNoError(t, err)
	setIdentity(ctx, review.StandbyAuditorIDs[0], "AuditorMSP", "auditor", map[string]string{"subjectId": review.StandbyAuditorIDs[0]})
	_, err = c.ReadMedicalReviewDisclosure(ctx, review.ID)
	requireError(t, err, "assigned auditor")
	present := review.AssignedAuditorIDs[0]
	setIdentity(ctx, present, "AuditorMSP", "auditor", map[string]string{"subjectId": present})
	facts, err := c.ReadMedicalReviewDisclosure(ctx, review.ID)
	requireNoError(t, err)
	if facts.Quote.PayableMinor != claim.AmountMinor {
		t.Fatal("Auditor facts do not match the committed statement")
	}
	_, err = c.AcknowledgeMedicalReview(ctx, review.ID)
	requireNoError(t, err)
	ctx.stub.timestamp = timestamppb.New(by)
	_, err = c.ReplaceAbsentAuditor(ctx, review.ID, present)
	requireError(t, err, "unacknowledged original seat")
	absent := review.AssignedAuditorIDs[1]
	replaced, err := c.ReplaceAbsentAuditor(ctx, review.ID, absent)
	requireNoError(t, err)
	if slices.Contains(replaced.AssignedAuditorIDs, absent) || !slices.Contains(replaced.AssignedAuditorIDs, review.StandbyAuditorIDs[0]) ||
		replaced.PrepareBy != by.Add(5*time.Minute).Format(time.RFC3339Nano) {
		t.Fatal("replacement did not preserve the determined standby and extension")
	}
	_, err = c.ReplaceAbsentAuditor(ctx, review.ID, replaced.AssignedAuditorIDs[1])
	requireError(t, err, "unacknowledged original seat")
}

func TestR2CertificateV3ReproducesItsTimesAndDigest(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	activateR2Roster(t, f)
	c, ctx, claim := f.contract, f.context, f.claim
	request, err := c.medicalApprovalRequest(ctx, claim)
	requireNoError(t, err)
	cert, err := c.deriveMedicalApproval(ctx, claim, request, nil)
	requireNoError(t, err)
	now := ctx.stub.timestamp.AsTime().Add(time.Second).Format(time.RFC3339Nano)
	requireNoError(t, c.deriveMedicalApprovalV3(ctx, cert, request, nil, nil, nil, now))
	requireNoError(t, overwriteAsset(ctx, "medicalApprovalCertificate", cert.ID, cert))
	actual, err := c.verifyMedicalApproval(ctx, claim)
	requireNoError(t, err)
	if actual.CertificateVersion != 3 || actual.DecidedAt == actual.IssuedAt || !oracleV2Hash.MatchString(actual.ReviewTranscriptHash) {
		t.Fatal("the effective certificate did not bind its decision and issuance")
	}
	cert.ReviewTranscriptHash = strings.Repeat("d", 64)
	requireNoError(t, overwriteAsset(ctx, "medicalApprovalCertificate", cert.ID, cert))
	_, err = c.verifyMedicalApproval(ctx, claim)
	requireError(t, err, "no longer matches")
}

func TestR2RotationPreservesPinAndPurpose(t *testing.T) {
	f := newMedicalSettlementFixture(t)
	c, ctx := f.contract, f.context
	ctx.stub.transient["channelPatientKey"] = []byte(strings.Repeat("a", 32))
	first, err := c.RotateMedicalPatientTokenKey(ctx, 0)
	requireNoError(t, err)
	_, err = c.RotateMedicalPatientTokenKey(ctx, first.Version)
	requireError(t, err, "must differ")
	ctx.stub.transient["channelPatientKey"] = []byte(strings.Repeat("b", 32))
	next, err := c.RotateMedicalPatientTokenKey(ctx, first.Version)
	requireNoError(t, err)
	oldKey, err := readMedicalPatientTokenKey(ctx, first.Version)
	requireNoError(t, err)
	newKey, err := readMedicalPatientTokenKey(ctx, next.Version)
	requireNoError(t, err)
	token := medicalPatientToken(oldKey, "fabric-medical-oracle-patient-v2", "holder")
	if token == medicalPatientToken(oldKey, "another-purpose", "holder") ||
		token == medicalPatientToken(newKey, "fabric-medical-oracle-patient-v2", "holder") {
		t.Fatal("rotation or purpose failed to isolate tokens")
	}
}
