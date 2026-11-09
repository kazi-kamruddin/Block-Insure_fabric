package insurance

import (
	"encoding/json"
	"strings"
	"testing"
)

func invoiceFlowFixture(t *testing.T) (*Contract, *testContext, *HospitalInvoice) {
	t.Helper()
	c := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	setIdentity(ctx, "admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := c.CreatePartnerAgreement(ctx, "agreement-invoice", "HOSPITAL", "hospital1", "Hospital", "", "", "Invoices", "2026-01-01", "2028-12-31")
	requireNoError(t, err)
	p := &Policy{AssetType: "policy", SchemaVersion: SchemaVersion, ID: "policy-invoice", PolicyholderID: "policyholder1", HospitalIDs: []string{"hospital1"}, CoverageLimitMinor: 100000, StartDate: "2026-01-01", EndDate: "2026-12-31", Status: "ACTIVE"}
	requireNoError(t, putState(ctx, "policy", p.ID, p))
	_, err = c.PublishOracleRegistrySnapshot(ctx, "registry-invoice", 1, strings.Repeat("a", 64), "hospital-invoice-rules-v2", strings.Repeat("b", 64), 1)
	requireNoError(t, err)
	setIdentity(ctx, "hospital-cert", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital1"})
	salts := map[string]string{}
	for _, name := range []string{"admissionDate", "amountMinor", "dischargeDate", "hospitalId", "invoiceId", "invoiceReferenceHash", "patientReferenceHash", "status", "treatmentHash"} {
		salts[name] = strings.Repeat("d", 64)
	}
	payload, _ := json.Marshal(salts)
	ctx.stub.transient = map[string][]byte{"credentialSalts": payload}
	invoice, err := c.CreateHospitalInvoiceWithCredential(ctx, "invoice-direct", patientSubjectHash("policyholder1"), strings.Repeat("b", 64), strings.Repeat("c", 64), 50000, "2026-06-01", "2026-06-20", "FINALIZED")
	requireNoError(t, err)
	return c, ctx, invoice
}

func invoiceRequest(t *testing.T, c *Contract, ctx *testContext, id string) *OracleRequest {
	t.Helper()
	setIdentity(ctx, "admin", "InsurerMSP", "insurerAdmin", nil)
	r, err := c.RequestOracleVerification(ctx, id, "claim-direct", "registry-invoice", "model-v1", strings.Repeat("c", 64), `["oracle1","oracle2"]`, 2, "2026-09-05T12:05:00Z", "2026-09-05T12:10:00Z")
	requireNoError(t, err)
	return r
}

func invoiceConsensus(t *testing.T, c *Contract, ctx *testContext, r *OracleRequest, verified bool, code string) {
	t.Helper()
	record := strings.Repeat("e", 64)
	result := commitOracleTestResult(t, c, ctx, r, "oracle1", verified, code, record, strings.Repeat("1", 64))
	commitOracleTestResult(t, c, ctx, r, "oracle2", verified, code, record, strings.Repeat("2", 64))
	revealOracleTestResult(t, c, ctx, r, "oracle1", verified, code, record, result, strings.Repeat("1", 64))
	revealOracleTestResult(t, c, ctx, r, "oracle2", verified, code, record, result, strings.Repeat("2", 64))
}

func TestInvoiceDirectOracleFailureReviewAndAppeal(t *testing.T) {
	c, ctx, invoice := invoiceFlowFixture(t)
	setIdentity(ctx, "holder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	// Above the invoice total, but within policy cover: Oracles must decide this.
	_, err := c.SubmitInvoiceClaim(ctx, "claim-direct", "policy-invoice", "hospital1", invoice.ID, 60000, "2026-06-10", strings.Repeat("f", 64))
	requireNoError(t, err)
	r := invoiceRequest(t, c, ctx, "request-invoice-initial")
	binding, err := c.ReadHospitalVerification(ctx, r.HospitalVerificationID)
	requireNoError(t, err)
	if binding.Outcome != "SOURCE_BOUND" {
		t.Fatalf("insurer supplied a verdict: %+v", binding)
	}
	invoiceConsensus(t, c, ctx, r, false, "AMOUNT_OUT_OF_RANGE")
	setIdentity(ctx, "admin", "InsurerMSP", "insurerAdmin", nil)
	_, err = c.RouteOracleFailureToReview(ctx, r.ID, "review-invoice", `["auditor1","auditor2","auditor3","auditor4"]`, 3, 2, "2026-09-06T12:00:00Z")
	requireNoError(t, err)
	for _, id := range []string{"auditor1", "auditor2"} {
		setIdentity(ctx, id, "AuditorMSP", "auditor", map[string]string{"subjectId": id})
		_, err = c.RecordAuditorDecision(ctx, "review-invoice", "decision-"+id, "REJECT", strings.Repeat("a", 64))
		requireNoError(t, err)
	}
	setIdentity(ctx, "holder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = c.SubmitClaimAppeal(ctx, "appeal-invoice", "claim-direct", "AMOUNT_CORRECTION", strings.Repeat("a", 64), strings.Repeat("f", 64), "", "", 25000, "", "", invoice.InvoiceReferenceHash)
	requireNoError(t, err)
	r2 := invoiceRequest(t, c, ctx, "request-invoice-appeal")
	if r2.ClaimVersion != 2 || r2.AppealID != "appeal-invoice" || r2.HospitalVerificationID == r.HospitalVerificationID {
		t.Fatal("appeal did not receive fresh version binding")
	}
	invoiceConsensus(t, c, ctx, r2, true, "VERIFIED")
	claim, err := c.ReadClaim(ctx, "claim-direct")
	requireNoError(t, err)
	appeal, err := c.ReadClaimAppeal(ctx, "appeal-invoice")
	requireNoError(t, err)
	if claim.Status != "APPROVED" || appeal.Status != "OVERTURNED" {
		t.Fatalf("appeal did not resolve: %s / %s", claim.Status, appeal.Status)
	}
}

func TestInvoicePatientBindingAndAutomaticCredential(t *testing.T) {
	c, ctx, invoice := invoiceFlowFixture(t)
	if invoice.PrivacyCredentialID == "" {
		t.Fatal("missing automatic credential")
	}
	credential, err := c.ReadPrivacyCredential(ctx, invoice.PrivacyCredentialID)
	requireNoError(t, err)
	if credential.Status != "ACTIVE" || credential.SourceID != invoice.ID {
		t.Fatal("wrong automatic credential")
	}
	// A customer with their own valid policy cannot claim another patient's invoice.
	p, err := c.ReadPolicy(ctx, "policy-invoice")
	requireNoError(t, err)
	p.PolicyholderID = "policyholder2"
	requireNoError(t, overwriteAsset(ctx, "policy", p.ID, p))
	setIdentity(ctx, "other", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder2"})
	_, err = c.SubmitInvoiceClaim(ctx, "claim-other", p.ID, "hospital1", invoice.ID, 10000, "2026-06-10", strings.Repeat("a", 64))
	requireError(t, err, "patient does not match")
	setIdentity(ctx, "hospital-cert", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital1"})
	_, err = c.UpdateHospitalInvoiceWithCredential(ctx, invoice.ID, "", "", "", 0, "", "", "VOID")
	requireNoError(t, err)
	credential, err = c.ReadPrivacyCredential(ctx, invoice.PrivacyCredentialID)
	requireNoError(t, err)
	if credential.Status != "REVOKED" {
		t.Fatal("voiding invoice did not revoke its credential")
	}
}

func TestPartialClaimDisclosureUsesClaimAmountForCoverage(t *testing.T) {
	claim := &Claim{ID: "claim-partial", HospitalInvoiceID: "invoice-partial", HospitalID: "hospital1", PolicyID: "policy-partial", ClaimantID: "holder", AmountMinor: 25000, IncidentDate: "2026-06-10"}
	invoice := map[string]string{"invoiceId": "invoice-partial", "hospitalId": "hospital1", "amountMinor": "100000", "status": "FINALIZED", "admissionDate": "2026-06-01", "dischargeDate": "2026-06-20"}
	policy := map[string]string{"policyId": "policy-partial", "policyholderId": "holder", "coverageLimitMinor": "50000", "status": "ACTIVE", "startDate": "2026-01-01", "endDate": "2026-12-31"}
	requireNoError(t, validatePresentationSemantics(claim, invoice, policy))
	claim.AmountMinor = 60000
	requireError(t, validatePresentationSemantics(claim, invoice, policy), "do not authorize")
}
