package insurance

import (
	"strings"
	"testing"
)

func medicalTestContext() (*Contract, *testContext) {
	stub := newMemoryStub()
	stub.channelID = medicalCandidateChannel
	ctx := &testContext{stub: stub}
	setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)
	return &Contract{}, ctx
}

func TestMedicalTermsAcceptanceAndIntakeRevision(t *testing.T) {
	contract, ctx := medicalTestContext()
	hash := strings.Repeat("a", 64)
	if _, err := contract.CreatePolicyPackage(ctx, "medicine", "Medical", "Surgery only", 100, 4000, hash); err != nil {
		t.Fatal(err)
	}
	rules, err := contract.ConfigureMedicalRules(ctx, "medicine", "SURGERY", 8000, 1000, 1000, 8000, 0, 30, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := contract.PublishPolicyPackage(ctx, "medicine"); err != nil {
		t.Fatal(err)
	}
	if _, err := contract.IssuePolicy(ctx, "free-policy", "medicine", "owner", "2026-09-01", "2026-12-01"); err == nil {
		t.Fatal("medical policy cannot begin with fictional paid coverage")
	}
	if _, err := contract.CreatePartnerAgreement(ctx, "agreement-medical", "HOSPITAL", "hospital-one", "Hospital", "Dhaka", "Preferred", "Intake", "2026-01-01", "2027-01-01"); err != nil {
		t.Fatal(err)
	}
	setIdentity(ctx, "owner", "InsurerMSP", "policyholder", map[string]string{"subjectId": "owner"})
	if _, err := contract.AcquireMedicalPolicy(ctx, "new-policy", "medicine", "2026-09-01", "2026-12-01", hash); err == nil {
		t.Fatal("accepted stale terms")
	}
	policy, err := contract.AcquireMedicalPolicy(ctx, "new-policy", "medicine", "2026-09-01", "2026-12-01", rules.TermsHash)
	if err != nil || policy.Status != "PENDING_PAYMENT" || policy.MedicalRulesVersion != 1 {
		t.Fatalf("unexpected policy: %+v, %v", policy, err)
	}
	setIdentity(ctx, "hospital-one", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital-one"})
	if _, err := contract.RecordHospitalModelFacts(ctx, "invoice"); err == nil {
		t.Fatal("hospital model metadata still writable")
	}
	base := `{"patientReferenceHash":"` + hash + `","service":"SURGERY","serviceDate":"2026-09-04","admissionDate":"2026-09-03","dischargeDate":"2026-09-05","billMinor":10000`
	ctx.stub.transient["medicalEpisode"] = []byte(base + `,"fraudLabel":true}`)
	if _, err := contract.SaveMedicalEpisode(ctx, hash, 0); err == nil {
		t.Fatal("accepted a hospital fraud label")
	}
	ctx.stub.transient["medicalEpisode"] = []byte(base + "}")
	first, err := contract.SaveMedicalEpisode(ctx, hash, 0)
	if err != nil || first.Revision != 1 {
		t.Fatalf("unexpected first save: %+v %v", first, err)
	}
	retry, err := contract.SaveMedicalEpisode(ctx, hash, 0)
	if err != nil || *retry != *first {
		t.Fatalf("duplicate save was not idempotent: %+v %v", retry, err)
	}
	ctx.stub.transient["medicalEpisode"] = []byte(strings.Replace(base, "10000", "12000", 1) + "}")
	if _, err := contract.SaveMedicalEpisode(ctx, hash, 0); err == nil {
		t.Fatal("accepted stale correction")
	}
	next, err := contract.SaveMedicalEpisode(ctx, hash, 1)
	if err != nil || next.Revision != 2 || next.ID != first.ID {
		t.Fatalf("unexpected correction: %+v %v", next, err)
	}
	old, err := readMedicalEpisode(ctx, first.ID, 1)
	if err != nil || old.BillMinor != 10000 {
		t.Fatalf("historical revision changed: %+v %v", old, err)
	}
}

func TestMedicalAssociationCoverageCorrectionAndOraclePin(t *testing.T) {
	contract, ctx := medicalTestContext()
	hash := strings.Repeat("a", 64)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	_, err := contract.CreatePartnerAgreement(ctx, "agreement-intake", "HOSPITAL", "hospital-one", "Hospital", "Dhaka", "Preferred", "Intake", "2026-01-01", "2027-01-01")
	must(err)
	_, err = contract.CreatePolicyPackage(ctx, "medicine", "Medical", "Surgery only", 100, 4000, hash)
	must(err)
	rules, err := contract.ConfigureMedicalRules(ctx, "medicine", "SURGERY", 8000, 1000, 1000, 8000, 0, 30, false)
	must(err)
	_, err = contract.PublishPolicyPackage(ctx, "medicine")
	must(err)
	policy := &Policy{ID: "policy-one", PolicyholderID: "owner", PackageID: "medicine", MedicalRulesVersion: 1, TermsHash: rules.TermsHash,
		Status: "ACTIVE", StartDate: "2026-09-01", EndDate: "2026-12-01", PaidThroughDate: "2026-09-30", HospitalIDs: []string{"hospital-one"}, PremiumMinor: 100, CoverageLimitMinor: 4000}
	must(putState(ctx, "policy", policy.ID, policy))
	must(putState(ctx, "bankTransfer", "transfer-one", &BankTransfer{ID: "transfer-one", Status: "SETTLED", PaymentID: "payment-one"}))
	must(putState(ctx, "premiumPayment", "payment-one", &PremiumPayment{ID: "payment-one", PolicyID: policy.ID, TransferID: "transfer-one", AmountMinor: 100, PeriodStartDate: "2026-09-01", PeriodEndDate: "2026-09-30"}))
	base := `{"patientReferenceHash":"` + hash + `","service":"SURGERY","serviceDate":"2026-09-04","admissionDate":"2026-09-03","dischargeDate":"2026-09-05","invoiceDate":"2026-09-05","billMinor":10000}`
	hospital := func() {
		setIdentity(ctx, "hospital-one", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital-one"})
	}
	insurer := func() { setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil) }
	holder := func(id string) {
		setIdentity(ctx, id, "InsurerMSP", "policyholder", map[string]string{"subjectId": id})
	}
	hospital()
	ctx.stub.transient["medicalEpisode"] = []byte(base)
	head, err := contract.SaveMedicalEpisode(ctx, hash, 0)
	must(err)
	holder("owner")
	rows, err := contract.ListMedicalEpisodes(ctx)
	must(err)
	if len(rows) != 0 {
		t.Fatal("pending association exposed private episode")
	}
	if _, err := contract.VerifyMedicalAssociation(ctx, head.ID, 1, "owner", hash, true); err == nil {
		t.Fatal("holder self-verified")
	}
	insurer()
	_, err = contract.VerifyMedicalAssociation(ctx, head.ID, 1, "owner", hash, true)
	must(err)
	_, err = contract.RegisterMedicalOracleBenchmark(ctx, "hospital-one", "SURGERY", 1000, 15000, "ACTIVE", hash)
	must(err)
	sources, err := contract.ListMedicalOracleSources(ctx)
	must(err)
	if len(sources) != 1 || !sources[0].Complete || sources[0].Invoice.PatientReferenceHash != patientSubjectHash("owner") {
		t.Fatalf("wrong Oracle source: %+v", sources)
	}
	holder("stranger")
	rows, err = contract.ListMedicalEpisodes(ctx)
	must(err)
	if len(rows) != 0 {
		t.Fatal("different claimant could discover episode")
	}
	holder("owner")
	quote, err := contract.QuoteMedicalClaim(ctx, policy.ID, head.ID, 1)
	must(err)
	if quote.BilledMinor != 10000 || quote.EligibleMinor != 8000 || quote.DeductibleMinor != 800 || quote.InsurerShareMinor != 5760 || quote.PayableMinor != 4000 {
		t.Fatalf("unexpected example: %+v", quote)
	}
	_, err = contract.PrepareMedicalClaim(ctx, "claim-one", policy.ID, head.ID, 1)
	must(err)
	_, err = contract.SubmitMedicalClaim(ctx, "claim-one", policy.ID, head.ID, 1, quote.StatementHash)
	must(err)
	zero, err := contract.QuoteMedicalClaim(ctx, policy.ID, head.ID, 1)
	must(err)
	if zero.PayableMinor != 0 {
		t.Fatal("coverage was not reserved")
	}
	insurer()
	_, err = contract.PublishOracleRegistrySnapshot(ctx, "snapshot-one", 1, hash, "hospital-invoice-rules-v2", hash, 1)
	must(err)
	oracleRequest := func(id, modelHash string) (*OracleRequest, error) {
		return contract.RequestOracleVerification(ctx, id, "claim-one", "snapshot-one", "fabric-xgb-synthetic-v1", modelHash,
			`["oracle1","oracle2","oracle3"]`, 2, "2026-09-05T12:01:00Z", "2026-09-05T12:03:00Z")
	}
	if _, err := oracleRequest("oracle-wrong", hash); err == nil {
		t.Fatal("accepted a different medical evaluator identity")
	}
	request, err := oracleRequest("oracle-one", "4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4")
	must(err)
	if request.ClaimVersion != 1 || request.RequiredConfirmations != 2 {
		t.Fatalf("unexpected Oracle request %+v", request)
	}
	hospital()
	ctx.stub.transient["medicalEpisode"] = []byte(strings.Replace(base, "10000", "3000", 1))
	_, err = contract.SaveMedicalEpisode(ctx, hash, 1)
	must(err)
	staleClaim, err := contract.ReadClaim(ctx, "claim-one")
	must(err)
	if _, err := currentMedicalHead(ctx, staleClaim); err == nil {
		t.Fatal("stale paid facts could still authorize settlement")
	}
	holder("owner")
	corrected, err := contract.QuoteMedicalCorrection(ctx, "claim-one", 2)
	must(err)
	if corrected.PayableMinor != 2160 {
		t.Fatalf("incorrect corrected reimbursement: %+v", corrected)
	}
	claim, err := contract.AcceptMedicalCorrection(ctx, "claim-one", 2, corrected.StatementHash)
	must(err)
	if claim.Version != 2 || claim.CurrentOracleRequestID != "" || claim.EpisodeRevision != 2 || claim.Status != "SUBMITTED" {
		t.Fatalf("correction did not supersede request: %+v", claim)
	}
	saved, err := contract.ReadMedicalStatement(ctx, claim.ID, 1)
	must(err)
	if saved.PayableMinor != 4000 {
		t.Fatal("original statement was overwritten")
	}
	quote, err = contract.QuoteMedicalClaim(ctx, policy.ID, head.ID, 2)
	must(err)
	_, err = contract.PrepareMedicalClaim(ctx, "claim-two", policy.ID, head.ID, 2)
	must(err)
	if _, err := contract.SubmitMedicalClaim(ctx, "claim-two", policy.ID, head.ID, 2, quote.StatementHash); err == nil {
		t.Fatal("duplicate episode claim accepted")
	}
}
