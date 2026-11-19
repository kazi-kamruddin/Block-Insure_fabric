package insurance

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestMedicalClarificationRecoveryAppealAndOCR(t *testing.T) {
	c, ctx := medicalTestContext()
	hash := strings.Repeat("a", 64)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	clock := func(min int) { ctx.stub.timestamp = timestamppb.New(time.Date(2026, 9, 5, 12, min, 0, 0, time.UTC)) }
	deadline := func(min int) string { return time.Date(2026, 9, 5, 12, min, 0, 0, time.UTC).Format(time.RFC3339) }
	setNote := func(marker byte) {
		ctx.stub.transient["medicalMessage"] = []byte("v1." + base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat(string(marker), 44))))
	}
	insurer := func() { setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil) }
	holder := func() {
		setIdentity(ctx, "holder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "holder"})
	}
	auditor := func(subject string) {
		setIdentity(ctx, subject, "AuditorMSP", "auditor", map[string]string{"subjectId": subject})
	}
	episodeID := strings.Repeat("b", 64)
	head := &MedicalEpisodeHead{ID: episodeID, HospitalID: "hospital-test", Revision: 1, RevisionHash: hash}
	episode := &MedicalEpisode{ID: episodeID, HospitalID: head.HospitalID, Revision: 1, PatientReferenceHash: hash, Service: "SURGERY", ServiceDate: "2026-09-04", BillMinor: 10000}
	must(putState(ctx, "medicalEpisode", episodeID, head))
	must(putPrivateState(ctx, "medicalEpisodeRevision", medicalRevisionKey(episodeID, 1), episode))
	_, err := c.VerifyMedicalAssociation(ctx, episodeID, 1, "holder", hash, true)
	must(err)
	policy := &Policy{ID: "medical-policy", PolicyholderID: "holder", PackageID: "medical-package", MedicalRulesVersion: 1, TermsHash: hash,
		Status: "ACTIVE", StartDate: "2026-09-01", EndDate: "2026-12-01", PaidThroughDate: "2026-09-30",
		PremiumMinor: 100, CoverageLimitMinor: 4000, HospitalIDs: []string{head.HospitalID}}
	must(putState(ctx, "policy", policy.ID, policy))
	must(putState(ctx, "bankTransfer", "paid-transfer", &BankTransfer{ID: "paid-transfer", Status: "SETTLED", PaymentID: "medical-payment"}))
	must(putState(ctx, "premiumPayment", "medical-payment", &PremiumPayment{ID: "medical-payment", PolicyID: policy.ID, TransferID: "paid-transfer",
		AmountMinor: 100, PeriodStartDate: "2026-09-01", PeriodEndDate: "2026-09-30"}))
	must(putState(ctx, "medicalCoverage", policy.ID, &MedicalCoverage{UsedMinor: 4000}))
	const claimID = "medical-case"
	claim := &Claim{ID: claimID, PolicyID: policy.ID, ClaimantID: "holder", HospitalID: head.HospitalID, EpisodeID: episodeID,
		EpisodeRevision: 1, HospitalInvoiceID: medicalRevisionKey(episodeID, 1), MedicalAssociationKey: medicalAssociationKey(episode),
		MedicalAssociationVersion: 1, AmountMinor: 4000, IncidentDate: episode.ServiceDate, DescriptionHash: hash, Status: "SUBMITTED",
		Version: 1, CreatedAt: deadline(0), EvidenceIDs: []string{}}
	must(putState(ctx, "claim", claimID, claim))
	must(putPrivateState(ctx, "medicalStatement", medicalRevisionKey(claimID, 1), &MedicalQuote{PayableMinor: 4000, StatementHash: hash}))
	_, err = c.PublishOracleRegistrySnapshot(ctx, "medical-snapshot", 1, hash, "hospital-invoice-rules-v2", hash, 1)
	must(err)
	request := func(id string, min int, positive bool) *OracleRequest {
		t.Helper()
		clock(min)
		insurer()
		req, err := c.RequestOracleVerification(ctx, id, claimID, "medical-snapshot", "fabric-xgb-synthetic-v1",
			"4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4",
			`["oracle1","oracle2","oracle3"]`, 2, deadline(min+1), deadline(min+3))
		must(err)
		code := "XGB_REVIEW:" + strings.Repeat("A", 64)
		if positive {
			code = "XGB_AUTO:" + strings.Repeat("A", 64)
		}
		digest := commitOracleTestResult(t, c, ctx, req, "oracle1", positive, code, hash, hash)
		commitOracleTestResult(t, c, ctx, req, "oracle2", positive, code, hash, hash)
		commitOracleTestResult(t, c, ctx, req, "oracle3", positive, code, hash, hash)
		revealOracleTestResult(t, c, ctx, req, "oracle1", positive, code, hash, digest, hash)
		revealOracleTestResult(t, c, ctx, req, "oracle2", positive, code, hash, digest, hash)
		return req
	}
	request("request-initial", 0, false)
	insurer()
	_, err = c.PrepareMedicalReview(ctx, claimID, "prepare-original", deadline(8))
	must(err)
	ctx.stub.transient["medicalMessage"] = []byte("unencrypted note")
	_, err = c.RequestMedicalClarification(ctx, "prepare-original", "question-unencrypted", deadline(5))
	requireError(t, err, "encrypted medical message")
	setNote('q')
	_, err = c.RequestMedicalClarification(ctx, "prepare-original", "question-original", deadline(5))
	must(err)
	_, err = c.OpenMedicalVoting(ctx, "prepare-original", deadline(20))
	requireError(t, err, "resolve or expire")
	holder()
	setNote('r')
	attachment := strings.Repeat("c", 64)
	next, err := c.RespondMedicalClarification(ctx, "question-original", "MATERIAL", attachment)
	must(err)
	if next.Version != 2 || next.AppealCount != 0 {
		t.Fatalf("wrong clarified successor: %+v", next)
	}
	insurer()
	_, err = c.RequestOracleVerification(ctx, "request-too-early", claimID, "medical-snapshot", "fabric-xgb-synthetic-v1",
		"4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4", `["oracle1","oracle2","oracle3"]`, 2, deadline(1), deadline(3))
	requireError(t, err, "committed successor")
	holder()
	_, err = c.AddEvidenceReferenceForVersion(ctx, claimID, "supplement-doc", "CLARIFICATION_DOCUMENT", attachment, hash, 2)
	must(err)
	req := request("request-clarified", 3, true)
	if req.ClaimVersion != 2 || req.AppealID != "" {
		t.Fatal("clarification was not independently pinned")
	}
	insurer()
	_, err = c.PrepareMedicalReview(ctx, claimID, "prepare-clarified", deadline(7))
	must(err)
	_, err = c.RequestMedicalClarification(ctx, "prepare-clarified", "question-repeat", deadline(6))
	requireError(t, err, "one clarification")
	_, err = c.OpenMedicalVoting(ctx, "prepare-clarified", deadline(20))
	requireError(t, err, "confirm decryption")
	holder()
	oldGrants, err := c.ShareMedicalReviewEvidence(ctx, "prepare-clarified", deadline(35))
	must(err)
	clock(8)
	insurer()
	expired, err := c.FinalizeExpiredReview(ctx, "prepare-clarified")
	must(err)
	if expired.Status != "ACCESS_FAILED" {
		t.Fatal("expiry was not distinguished from rejection on the merits")
	}
	_, err = c.RecoverMedicalReview(ctx, "prepare-clarified", "prepare-recovered", deadline(25))
	must(err)
	_, err = c.RecoverMedicalReview(ctx, "prepare-recovered", "prepare-again", deadline(25))
	requireError(t, err, "no procedural recovery")
	auditor(oldGrants[0].GranteeSubject)
	_, err = c.RecordGrantedEvidenceAccess(ctx, "old-access", "supplement-doc", oldGrants[0].ID, "AUDIT")
	requireError(t, err, "current assigned medical review")

	prepareDocuments := func(reviewID string) {
		t.Helper()
		holder()
		grants, err := c.ShareMedicalReviewEvidence(ctx, reviewID, deadline(58))
		must(err)
		for n, grant := range grants {
			auditor(grant.GranteeSubject)
			receipt, err := c.RecordGrantedEvidenceAccess(ctx, fmt.Sprintf("%s-receipt-%d", reviewID, n), grant.EvidenceID, grant.ID, "AUDIT")
			must(err)
			doc, err := c.ReadEvidenceReference(ctx, grant.EvidenceID)
			must(err)
			_, err = c.ConfirmMedicalEvidence(ctx, reviewID, doc.ID, receipt.ID, doc.ContentHash)
			must(err)
			if n == 0 {
				_, err = c.RecordMedicalOCR(ctx, "ocr-"+reviewID, doc.ID, "tesseract-7.0.0:eng-fast-v1", doc.ContentHash, hash, strings.Repeat("d", 64), true, receipt.ID)
				must(err)
			}
		}
	}
	prepareDocuments("prepare-recovered")
	insurer()
	open, err := c.OpenMedicalVoting(ctx, "prepare-recovered", deadline(30))
	must(err)
	for i, a := range open.AssignedAuditorIDs[:2] {
		auditor(a)
		_, err = c.RecordMedicalAuditorDecision(ctx, open.ID, fmt.Sprintf("reject-%d", i), "REJECT", "EVIDENCE_DOES_NOT_SUPPORT_SERVICE", hash)
		must(err)
	}
	holder()
	setNote('p')
	appealHash := strings.Repeat("e", 64)
	appeal, err := c.SubmitMedicalAppeal(ctx, "medical-appeal", claimID, "reject-0", appealHash, 0, "")
	must(err)
	if appeal.ClaimVersion != 3 || appeal.MedicalPriorReviewID != open.ID {
		t.Fatalf("wrong appeal: %+v", appeal)
	}
	_, err = c.AddEvidenceReferenceForVersion(ctx, claimID, "new-appeal-document", "APPEAL_DOCUMENT", appealHash, hash, 3)
	must(err)
	req = request("request-appeal", 11, true)
	if req.AppealID != appeal.ID || req.AppealCommitmentHash != appeal.CommitmentHash {
		t.Fatal("appeal commitment not bound to fresh request")
	}
	insurer()
	appealReview, err := c.PrepareMedicalReview(ctx, claimID, "prepare-appeal", deadline(25))
	must(err)
	if strings.Join(appealReview.AssignedAuditorIDs, ",") != strings.Join(open.AssignedAuditorIDs, ",") {
		t.Fatal("appeal switched panel")
	}
	setNote('s')
	_, err = c.RequestMedicalClarification(ctx, appealReview.ID, "question-appeal", deadline(20))
	must(err)
	holder()
	setNote('t')
	answer, err := c.RespondMedicalClarification(ctx, "question-appeal", "ANSWER", "")
	must(err)
	if answer.Version != 3 || answer.CurrentReviewID != appealReview.ID {
		t.Fatal("non-material answer advanced the appeal version")
	}
	prepareDocuments(appealReview.ID)
	insurer()
	_, err = c.OpenMedicalVoting(ctx, appealReview.ID, deadline(30))
	must(err)
	auditor("unassigned")
	_, err = c.RecordMedicalAuditorDecision(ctx, appealReview.ID, "outside-vote", "APPROVE", "TERMS_AND_EVIDENCE_SUPPORT", hash)
	requireError(t, err, "not assigned")
	for i, a := range appealReview.AssignedAuditorIDs[:3] {
		auditor(a)
		_, err = c.RecordMedicalAuditorDecision(ctx, appealReview.ID, fmt.Sprintf("approve-%d", i), "APPROVE", "TERMS_AND_EVIDENCE_SUPPORT", hash)
		must(err)
	}
	terminal, err := c.ReadClaim(ctx, claimID)
	must(err)
	coverage, err := getState[MedicalCoverage](ctx, "medicalCoverage", policy.ID)
	must(err)
	if terminal.Status != "APPROVED" || !terminal.MedicalRecoveryUsed || terminal.AppealCount != 1 || coverage.UsedMinor != 4000 || terminal.AmountMinor != 4000 {
		t.Fatalf("wrong terminal approval or reservation: %+v %+v", terminal, coverage)
	}
	resolved, err := c.ReadClaimAppeal(ctx, appeal.ID)
	must(err)
	if resolved.Status != "OVERTURNED" {
		t.Fatalf("appeal not resolved: %+v", resolved)
	}
}
