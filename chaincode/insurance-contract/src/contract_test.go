package insurance

import (
	"crypto/x509"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/hyperledger/fabric-chaincode-go/v2/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/v2/shim"
	"github.com/hyperledger/fabric-protos-go-apiv2/ledger/queryresult"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type memoryStub struct {
	shim.ChaincodeStubInterface
	state      map[string][]byte
	eventName  string
	eventValue []byte
	timestamp  *timestamppb.Timestamp
}

type memoryStateIterator struct {
	entries []*queryresult.KV
	index   int
}

func (i *memoryStateIterator) HasNext() bool { return i.index < len(i.entries) }
func (i *memoryStateIterator) Close() error  { return nil }
func (i *memoryStateIterator) Next() (*queryresult.KV, error) {
	entry := i.entries[i.index]
	i.index++
	return entry, nil
}

func newMemoryStub() *memoryStub {
	return &memoryStub{
		state:     make(map[string][]byte),
		timestamp: timestamppb.New(time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)),
	}
}

func (s *memoryStub) GetState(key string) ([]byte, error) {
	value := s.state[key]
	if value == nil {
		return nil, nil
	}
	return append([]byte(nil), value...), nil
}

func (s *memoryStub) PutState(key string, value []byte) error {
	s.state[key] = append([]byte(nil), value...)
	return nil
}

func (s *memoryStub) CreateCompositeKey(objectType string, attributes []string) (string, error) {
	if objectType == "" || strings.ContainsRune(objectType, rune(0)) {
		return "", fmt.Errorf("invalid object type")
	}
	prefix := string(rune(0)) + objectType + string(rune(0))
	if len(attributes) == 0 {
		return prefix, nil
	}
	return prefix + strings.Join(attributes, string(rune(0))) + string(rune(0)), nil
}

func (s *memoryStub) GetStateByPartialCompositeKey(objectType string, attributes []string) (shim.StateQueryIteratorInterface, error) {
	prefix, err := s.CreateCompositeKey(objectType, attributes)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0)
	for key := range s.state {
		if strings.HasPrefix(key, prefix) {
			keys = append(keys, key)
		}
	}
	slices.Sort(keys)
	entries := make([]*queryresult.KV, 0, len(keys))
	for _, key := range keys {
		entries = append(entries, &queryresult.KV{Key: key, Value: append([]byte(nil), s.state[key]...)})
	}
	return &memoryStateIterator{entries: entries}, nil
}

func (s *memoryStub) SetEvent(name string, payload []byte) error {
	s.eventName = name
	s.eventValue = append([]byte(nil), payload...)
	return nil
}

func (s *memoryStub) GetTxTimestamp() (*timestamppb.Timestamp, error) {
	return s.timestamp, nil
}

type testIdentity struct {
	id    string
	mspID string
	attrs map[string]string
}

func (i *testIdentity) GetID() (string, error)                         { return i.id, nil }
func (i *testIdentity) GetMSPID() (string, error)                      { return i.mspID, nil }
func (i *testIdentity) GetX509Certificate() (*x509.Certificate, error) { return nil, nil }
func (i *testIdentity) GetAttributeValue(name string) (string, bool, error) {
	value, found := i.attrs[name]
	return value, found, nil
}
func (i *testIdentity) AssertAttributeValue(name, expected string) error {
	actual, found := i.attrs[name]
	if !found || actual != expected {
		return fmt.Errorf("attribute mismatch")
	}
	return nil
}

type testContext struct {
	stub     *memoryStub
	identity cid.ClientIdentity
}

func (c *testContext) GetStub() shim.ChaincodeStubInterface  { return c.stub }
func (c *testContext) GetClientIdentity() cid.ClientIdentity { return c.identity }

func setIdentity(ctx *testContext, id, mspID, role string, attrs map[string]string) {
	values := map[string]string{"role": role}
	for key, value := range attrs {
		values[key] = value
	}
	ctx.identity = &testIdentity{id: id, mspID: mspID, attrs: values}
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func requireError(t *testing.T, err error, contains string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), contains) {
		t.Fatalf("expected error containing %q, got %v", contains, err)
	}
}

func TestPolicyToSettlementWorkflow(t *testing.T) {
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	hashA := strings.Repeat("a", 64)
	hashB := strings.Repeat("b", 64)
	hashC := strings.Repeat("c", 64)
	hashD := strings.Repeat("d", 64)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := contract.CreatePolicyPackage(ctx, "package-basic", "Basic Health", "Core hospitalization coverage", 10_000, 1_000_000, hashA)
	requireNoError(t, err)
	_, err = contract.PublishPolicyPackage(ctx, "package-basic")
	requireNoError(t, err)
	policy, err := contract.IssuePolicy(ctx, "policy-001", "package-basic", "policyholder1", "2026-01-01", "2026-12-31")
	requireNoError(t, err)
	if policy.TermsHash != hashA || policy.CoverageLimitMinor != 1_000_000 {
		t.Fatalf("policy did not snapshot package terms: %+v", policy)
	}

	setIdentity(ctx, "certificate-policyholder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.SubmitClaim(ctx, "claim-001", "policy-001", 250_000, "2026-06-15", hashB)
	requireNoError(t, err)
	_, err = contract.AddEvidenceReference(ctx, "claim-001", "evidence-001", "DISCHARGE_SUMMARY", hashC, hashD)
	requireNoError(t, err)

	setIdentity(ctx, "hospital-officer", "HospitalMSP", "hospitalOfficer", nil)
	_, err = contract.VerifyClaim(ctx, "claim-001", "verification-001", "VERIFIED", hashA)
	requireNoError(t, err)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err = contract.OpenClaimReview(ctx, "claim-001", "review-001", `["auditor1","auditor2","auditor3","auditor4"]`, 3, 2, "2026-09-08T12:00:00Z")
	requireNoError(t, err)

	for index, auditorID := range []string{"auditor1", "auditor2", "auditor3"} {
		setIdentity(ctx, "certificate-"+auditorID, "AuditorMSP", "auditor", map[string]string{"subjectId": auditorID})
		_, err = contract.RecordAuditorDecision(ctx, "review-001", fmt.Sprintf("decision-00%d", index+1), "APPROVE", hashB)
		requireNoError(t, err)
	}

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	settlement, err := contract.AuthorizeSettlement(ctx, "settlement-001", "claim-001")
	requireNoError(t, err)
	if settlement.AmountMinor != 250_000 {
		t.Fatalf("settlement amount changed: %d", settlement.AmountMinor)
	}

	setIdentity(ctx, "bank-officer", "BankMSP", "bankOfficer", nil)
	_, err = contract.ConfirmSettlement(ctx, "settlement-001", hashC)
	requireNoError(t, err)
	claim, err := contract.ReadClaim(ctx, "claim-001")
	requireNoError(t, err)
	if claim.Status != "SETTLED" {
		t.Fatalf("expected SETTLED claim, got %s", claim.Status)
	}
	if claim.HospitalVerificationID != "verification-001" || claim.AuditorDecisionID != "decision-003" {
		t.Fatalf("claim did not retain verification and decision links: %+v", claim)
	}
}

func TestAuthorizationAndInvalidTransitions(t *testing.T) {
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	hash := strings.Repeat("a", 64)

	setIdentity(ctx, "hospital-officer", "HospitalMSP", "hospitalOfficer", nil)
	_, err := contract.CreatePolicyPackage(ctx, "package-basic", "Basic", "", 100, 1_000, hash)
	requireError(t, err, "caller MSP HospitalMSP")

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err = contract.CreatePolicyPackage(ctx, "package-basic", "Basic", "", 100, 1_000, hash)
	requireNoError(t, err)
	_, err = contract.CreatePolicyPackage(ctx, "package-basic", "Basic", "", 100, 1_000, hash)
	requireError(t, err, "already exists")
	_, err = contract.PublishPolicyPackage(ctx, "package-basic")
	requireNoError(t, err)
	_, err = contract.IssuePolicy(ctx, "policy-001", "package-basic", "policyholder1", "2026-01-01", "2026-12-31")
	requireNoError(t, err)

	setIdentity(ctx, "other-user", "InsurerMSP", "policyholder", map[string]string{"subjectId": "someone-else"})
	_, err = contract.SubmitClaim(ctx, "claim-001", "policy-001", 500, "2026-06-01", hash)
	requireError(t, err, "another policyholder")

	setIdentity(ctx, "policyholder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.SubmitClaim(ctx, "claim-001", "policy-001", 500, "2026-06-01", hash)
	requireNoError(t, err)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err = contract.OpenClaimReview(ctx, "claim-001", "review-invalid", `["auditor1","auditor2","auditor3","auditor4"]`, 3, 2, "2026-09-08T12:00:00Z")
	requireError(t, err, "must be HOSPITAL_VERIFIED")
	_, err = contract.AuthorizeSettlement(ctx, "settlement-001", "claim-001")
	requireError(t, err, "must be APPROVED")
}

func TestDistributedReviewAppealAndFraudDecisionSupport(t *testing.T) {
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	hashA := strings.Repeat("a", 64)
	hashB := strings.Repeat("b", 64)
	hashC := strings.Repeat("c", 64)
	assignments := `["auditor1","auditor2","auditor3","auditor4"]`

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := contract.CreatePolicyPackage(ctx, "package-review", "Review", "", 100, 100_000, hashA)
	requireNoError(t, err)
	_, err = contract.PublishPolicyPackage(ctx, "package-review")
	requireNoError(t, err)
	_, err = contract.IssuePolicy(ctx, "policy-review", "package-review", "policyholder1", "2026-01-01", "2026-12-31")
	requireNoError(t, err)

	setIdentity(ctx, "policyholder-cert", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.SubmitClaim(ctx, "claim-review", "policy-review", 50_000, "2026-06-01", hashA)
	requireNoError(t, err)

	setIdentity(ctx, "hospital", "HospitalMSP", "hospitalOfficer", nil)
	_, err = contract.VerifyClaim(ctx, "claim-review", "verification-review", "VERIFIED", hashB)
	requireNoError(t, err)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	review, err := contract.OpenClaimReview(ctx, "claim-review", "review-initial", assignments, 3, 2, "2026-09-08T12:00:00Z")
	requireNoError(t, err)
	if review.Round != 1 || review.ApprovalThreshold != 3 || review.RejectionThreshold != 2 {
		t.Fatalf("unexpected initial review: %+v", review)
	}
	_, err = contract.RecordFraudAssessment(ctx, "fraud-review", "claim-review", "transparent-rules", "1.0.0", hashA, hashB, 7200, "HIGH", `["HIGH_COVERAGE_RATIO","REPEAT_POLICY_CLAIM"]`)
	requireNoError(t, err)
	claim, err := contract.ReadClaim(ctx, "claim-review")
	requireNoError(t, err)
	if claim.Status != "UNDER_REVIEW" {
		t.Fatalf("advisory score changed claim authority: %+v", claim)
	}

	setIdentity(ctx, "unassigned", "AuditorMSP", "auditor", map[string]string{"subjectId": "auditor9"})
	_, err = contract.RecordAuditorDecision(ctx, "review-initial", "decision-unassigned", "REJECT", hashC)
	requireError(t, err, "is not assigned")

	setIdentity(ctx, "auditor1-cert", "AuditorMSP", "auditor", map[string]string{"subjectId": "auditor1"})
	_, err = contract.RecordAuditorDecision(ctx, "review-initial", "decision-r1-a1", "REJECT", hashC)
	requireNoError(t, err)
	_, err = contract.RecordAuditorDecision(ctx, "review-initial", "decision-r1-duplicate", "REJECT", hashC)
	requireError(t, err, "already voted")
	setIdentity(ctx, "auditor2-cert", "AuditorMSP", "auditor", map[string]string{"subjectId": "auditor2"})
	_, err = contract.RecordAuditorDecision(ctx, "review-initial", "decision-r1-a2", "REJECT", hashC)
	requireNoError(t, err)
	claim, err = contract.ReadClaim(ctx, "claim-review")
	requireNoError(t, err)
	if claim.Status != "REJECTED" {
		t.Fatalf("two rejection votes did not reject claim: %+v", claim)
	}

	setIdentity(ctx, "policyholder-cert", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	appeal, err := contract.SubmitClaimAppeal(ctx, "appeal-review", "claim-review", hashA, hashB)
	requireNoError(t, err)
	if appeal.Round != 1 || appeal.Status != "SUBMITTED" {
		t.Fatalf("unexpected appeal: %+v", appeal)
	}

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	review, err = contract.OpenAppealReview(ctx, "appeal-review", "review-appeal", assignments, 3, 2, "2026-09-08T12:00:00Z")
	requireNoError(t, err)
	if review.Round != 2 || review.Kind != "APPEAL" {
		t.Fatalf("appeal review did not version review state: %+v", review)
	}
	for _, auditorID := range []string{"auditor1", "auditor2", "auditor3"} {
		setIdentity(ctx, auditorID+"-cert", "AuditorMSP", "auditor", map[string]string{"subjectId": auditorID})
		_, err = contract.RecordAuditorDecision(ctx, "review-appeal", "decision-appeal-"+auditorID, "APPROVE", hashB)
		requireNoError(t, err)
	}
	appeal, err = contract.ReadClaimAppeal(ctx, "appeal-review")
	requireNoError(t, err)
	claim, err = contract.ReadClaim(ctx, "claim-review")
	requireNoError(t, err)
	if appeal.Status != "OVERTURNED" || claim.Status != "APPROVED" || claim.ReviewRound != 2 {
		t.Fatalf("appeal quorum did not overturn decision: appeal=%+v claim=%+v", appeal, claim)
	}

	setIdentity(ctx, "policyholder-cert", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.SubmitClaimAppeal(ctx, "appeal-second", "claim-review", hashA, "")
	requireError(t, err, "must be REJECTED")

	assessments, err := contract.ListFraudAssessments(ctx)
	requireNoError(t, err)
	if len(assessments) != 1 || !assessments[0].Advisory || assessments[0].RiskLevel != "HIGH" {
		t.Fatalf("unexpected fraud assessment: %+v", assessments)
	}
}

func TestListQueriesUseDeterministicCompositeKeyOrder(t *testing.T) {
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	hash := strings.Repeat("a", 64)

	_, err := contract.CreatePolicyPackage(ctx, "package-z", "Last", "", 100, 1_000, hash)
	requireNoError(t, err)
	_, err = contract.CreatePolicyPackage(ctx, "package-a", "First", "", 100, 1_000, hash)
	requireNoError(t, err)

	packages, err := contract.ListPolicyPackages(ctx)
	requireNoError(t, err)
	if len(packages) != 2 || packages[0].ID != "package-a" || packages[1].ID != "package-z" {
		t.Fatalf("unexpected package list order: %+v", packages)
	}
}

func TestEvidenceAccessAuthorizationAndAuditRecord(t *testing.T) {
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	hash := strings.Repeat("a", 64)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := contract.CreatePolicyPackage(ctx, "package-access", "Access", "", 100, 1_000, hash)
	requireNoError(t, err)
	_, err = contract.PublishPolicyPackage(ctx, "package-access")
	requireNoError(t, err)
	_, err = contract.IssuePolicy(ctx, "policy-access", "package-access", "policyholder1", "2026-01-01", "2026-12-31")
	requireNoError(t, err)

	setIdentity(ctx, "policyholder-cert", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.SubmitClaim(ctx, "claim-access", "policy-access", 500, "2026-06-01", hash)
	requireNoError(t, err)
	_, err = contract.AddEvidenceReference(ctx, "claim-access", "evidence-access", "INVOICE", hash, hash)
	requireNoError(t, err)
	_, err = contract.RecordEvidenceAccess(ctx, "access-mislabeled", "evidence-access", "AUDIT")
	requireError(t, err, "purpose does not match")
	record, err := contract.RecordEvidenceAccess(ctx, "access-owner", "evidence-access", "DOWNLOAD")
	requireNoError(t, err)
	if record.AccessorRole != "policyholder" || record.ClaimID != "claim-access" {
		t.Fatalf("unexpected evidence access record: %+v", record)
	}

	setIdentity(ctx, "bank-officer", "BankMSP", "bankOfficer", nil)
	_, err = contract.RecordEvidenceAccess(ctx, "access-bank", "evidence-access", "DOWNLOAD")
	requireError(t, err, "cannot retrieve evidence")

	records, err := contract.ListEvidenceAccessRecords(ctx)
	requireNoError(t, err)
	if len(records) != 1 || records[0].ID != "access-owner" {
		t.Fatalf("unexpected evidence access records: %+v", records)
	}
}

func TestGovernedEvidenceGrantLifecycle(t *testing.T) {
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	hash := strings.Repeat("a", 64)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := contract.CreatePolicyPackage(ctx, "package-grant", "Grant", "", 100, 1_000, hash)
	requireNoError(t, err)
	_, err = contract.PublishPolicyPackage(ctx, "package-grant")
	requireNoError(t, err)
	_, err = contract.IssuePolicy(ctx, "policy-grant", "package-grant", "policyholder1", "2026-01-01", "2026-12-31")
	requireNoError(t, err)

	setIdentity(ctx, "policyholder-cert", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.SubmitClaim(ctx, "claim-grant", "policy-grant", 500, "2026-06-01", hash)
	requireNoError(t, err)
	_, err = contract.AddEvidenceReference(ctx, "claim-grant", "evidence-grant", "INVOICE", hash, hash)
	requireNoError(t, err)
	grant, err := contract.GrantEvidenceAccess(ctx, "grant-hospital", "evidence-grant", "HospitalMSP", "hospitalOfficer", "*", "VERIFY", "2026-09-06T13:00:00Z", 2)
	requireNoError(t, err)
	if grant.Status != "ACTIVE" || grant.MaxAccesses != 2 || grant.OwnerID != "policyholder1" {
		t.Fatalf("unexpected evidence grant: %+v", grant)
	}
	_, err = contract.GrantEvidenceAccess(ctx, "grant-invalid", "evidence-grant", "BankMSP", "bankOfficer", "*", "DOWNLOAD", "2026-09-06T13:00:00Z", 1)
	requireError(t, err, "not an allowed evidence-sharing scope")
	_, err = contract.GrantEvidenceAccess(ctx, "grant-long-subject", "evidence-grant", "AuditorMSP", "auditor", strings.Repeat("a", 129), "AUDIT", "2026-09-06T13:00:00Z", 1)
	requireError(t, err, "cannot exceed 128")

	setIdentity(ctx, "hospital-cert", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital1"})
	first, err := contract.RecordGrantedEvidenceAccess(ctx, "access-granted-1", "evidence-grant", grant.ID, "VERIFY")
	requireNoError(t, err)
	if first.GrantID != grant.ID || first.Purpose != "VERIFY" {
		t.Fatalf("granted access did not retain provenance: %+v", first)
	}
	_, err = contract.RecordGrantedEvidenceAccess(ctx, "access-granted-2", "evidence-grant", grant.ID, "VERIFY")
	requireNoError(t, err)
	_, err = contract.RecordGrantedEvidenceAccess(ctx, "access-granted-3", "evidence-grant", grant.ID, "VERIFY")
	requireError(t, err, "access limit is exhausted")

	setIdentity(ctx, "policyholder-cert", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	grant, err = contract.RevokeEvidenceAccess(ctx, grant.ID)
	requireNoError(t, err)
	if grant.Status != "REVOKED" || grant.RevokedAt == "" {
		t.Fatalf("grant was not revoked: %+v", grant)
	}
	grant, err = contract.RevokeEvidenceAccess(ctx, grant.ID)
	requireNoError(t, err)

	grants, err := contract.ListEvidenceAccessGrants(ctx)
	requireNoError(t, err)
	if len(grants) != 1 || grants[0].AccessCount != 2 || grants[0].Status != "REVOKED" {
		t.Fatalf("unexpected grant list: %+v", grants)
	}
}

func TestDirectAuditorEvidenceAccessRequiresCurrentAssignment(t *testing.T) {
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	hash := strings.Repeat("b", 64)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := contract.CreatePolicyPackage(ctx, "package-audit-access", "Audit", "", 100, 1_000, hash)
	requireNoError(t, err)
	_, err = contract.PublishPolicyPackage(ctx, "package-audit-access")
	requireNoError(t, err)
	_, err = contract.IssuePolicy(ctx, "policy-audit-access", "package-audit-access", "policyholder1", "2026-01-01", "2026-12-31")
	requireNoError(t, err)
	setIdentity(ctx, "policyholder-cert", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.SubmitClaim(ctx, "claim-audit-access", "policy-audit-access", 500, "2026-06-01", hash)
	requireNoError(t, err)
	_, err = contract.AddEvidenceReference(ctx, "claim-audit-access", "evidence-audit-access", "INVOICE", hash, hash)
	requireNoError(t, err)
	setIdentity(ctx, "hospital", "HospitalMSP", "hospitalOfficer", nil)
	_, err = contract.VerifyClaim(ctx, "claim-audit-access", "verification-audit-access", "VERIFIED", hash)
	requireNoError(t, err)
	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err = contract.OpenClaimReview(ctx, "claim-audit-access", "review-audit-access", `["auditor1","auditor2","auditor3"]`, 2, 2, "2026-09-08T12:00:00Z")
	requireNoError(t, err)

	setIdentity(ctx, "auditor9-cert", "AuditorMSP", "auditor", map[string]string{"subjectId": "auditor9"})
	_, err = contract.RecordEvidenceAccess(ctx, "access-unassigned", "evidence-audit-access", "AUDIT")
	requireError(t, err, "cannot retrieve evidence")
	setIdentity(ctx, "auditor1-cert", "AuditorMSP", "auditor", map[string]string{"subjectId": "auditor1"})
	_, err = contract.RecordEvidenceAccess(ctx, "access-assigned", "evidence-audit-access", "AUDIT")
	requireNoError(t, err)
}

func TestPolicyPremiumMandateAndCollectionLifecycle(t *testing.T) {
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	hashA := strings.Repeat("a", 64)
	hashB := strings.Repeat("b", 64)
	hashC := strings.Repeat("c", 64)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := contract.CreatePolicyPackage(ctx, "package-lifecycle", "Lifecycle", "", 10_000, 1_000_000, hashA)
	requireNoError(t, err)
	_, err = contract.PublishPolicyPackage(ctx, "package-lifecycle")
	requireNoError(t, err)

	setIdentity(ctx, "bank-officer", "BankMSP", "bankOfficer", nil)
	_, err = contract.RegisterBankAccountReference(ctx, "account-token-1", "policyholder1", hashA)
	requireNoError(t, err)

	setIdentity(ctx, "policyholder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	policy, err := contract.AcquirePolicy(ctx, "policy-lifecycle", "package-lifecycle", "2026-01-01", "2026-12-31")
	requireNoError(t, err)
	if policy.Status != "PENDING_PAYMENT" || policy.NextPremiumDueDate != "2026-01-01" {
		t.Fatalf("unexpected acquired policy: %+v", policy)
	}
	mandate, err := contract.RequestBankMandate(ctx, "mandate-1", policy.ID, "account-token-1", "2026-12-31")
	requireNoError(t, err)
	if mandate.Status != "PENDING" {
		t.Fatalf("expected pending mandate, got %s", mandate.Status)
	}

	setIdentity(ctx, "bank-officer", "BankMSP", "bankOfficer", nil)
	_, err = contract.ReviewBankMandate(ctx, "mandate-1", "APPROVE", hashB)
	requireNoError(t, err)
	payment, err := contract.RecordPremiumPayment(ctx, "payment-1", policy.ID, "mandate-1", "2026-01-01", "2026-01-30", 10_000, hashA, "OTP")
	requireNoError(t, err)
	if payment.Method != "OTP" {
		t.Fatalf("expected OTP payment, got %s", payment.Method)
	}
	adjustment, err := contract.RecordPremiumAdjustment(ctx, "adjustment-1", payment.ID, 2_500, hashB, hashC)
	requireNoError(t, err)
	if adjustment.Type != "REVERSAL" || adjustment.AmountMinor != 2_500 {
		t.Fatalf("unexpected premium adjustment: %+v", adjustment)
	}
	_, err = contract.RecordPremiumAdjustment(ctx, "adjustment-too-large", payment.ID, 8_000, strings.Repeat("d", 64), hashC)
	requireError(t, err, "cannot exceed")
	policy, err = contract.ReadPolicy(ctx, policy.ID)
	requireNoError(t, err)
	if policy.Status != "ACTIVE" || policy.PaidThroughDate != "2026-01-30" || policy.NextPremiumDueDate != "2026-01-31" {
		t.Fatalf("premium did not activate and advance policy: %+v", policy)
	}
	_, err = contract.RecordPremiumPayment(ctx, "payment-replay", policy.ID, "mandate-1", "2026-01-31", "2026-03-01", 10_000, hashA, "OTP")
	requireError(t, err, "external payment reference has already been recorded")

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	collection, err := contract.QueuePremiumCollection(ctx, "collection-1", "mandate-1", "2026-01-31")
	requireNoError(t, err)
	if collection.Status != "DUE" {
		t.Fatalf("expected due collection, got %s", collection.Status)
	}

	setIdentity(ctx, "bank-officer", "BankMSP", "bankOfficer", nil)
	collection, err = contract.CompletePremiumCollection(ctx, "collection-1", "payment-2", "2026-03-01", hashC)
	requireNoError(t, err)
	if collection.Status != "COMPLETED" || collection.PaymentID != "payment-2" {
		t.Fatalf("unexpected completed collection: %+v", collection)
	}

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	policy, err = contract.AdvancePolicyLifecycle(ctx, policy.ID, "2026-03-03")
	requireNoError(t, err)
	if policy.Status != "GRACE" {
		t.Fatalf("expected GRACE, got %s", policy.Status)
	}
	policy, err = contract.AdvancePolicyLifecycle(ctx, policy.ID, "2026-03-20")
	requireNoError(t, err)
	if policy.Status != "LAPSED" {
		t.Fatalf("expected LAPSED, got %s", policy.Status)
	}
}

func TestBenefitsBeneficiariesAndLiabilityLifecycle(t *testing.T) {
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	hashA := strings.Repeat("a", 64)
	hashB := strings.Repeat("b", 64)
	hashC := strings.Repeat("c", 64)
	hashD := strings.Repeat("d", 64)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := contract.CreatePolicyPackage(ctx, "package-benefit", "Benefits", "", 10_000, 1_000_000, hashA)
	requireNoError(t, err)
	_, err = contract.CreateBenefitPlan(ctx, "benefit-plan-1", "package-benefit", 500_000, 100_000, 250_000, hashB)
	requireNoError(t, err)
	_, err = contract.PublishBenefitPlan(ctx, "benefit-plan-1")
	requireNoError(t, err)
	_, err = contract.PublishPolicyPackage(ctx, "package-benefit")
	requireNoError(t, err)
	_, err = contract.IssuePolicy(ctx, "policy-benefit", "package-benefit", "policyholder1", "2026-01-01", "2026-12-31")
	requireNoError(t, err)
	plan2, err := contract.CreateBenefitPlan(ctx, "benefit-plan-2", "package-benefit", 900_000, 200_000, 400_000, hashC)
	requireNoError(t, err)
	if plan2.Version != 2 {
		t.Fatalf("expected benefit plan version 2, got %d", plan2.Version)
	}
	_, err = contract.RetireBenefitPlan(ctx, "benefit-plan-1")
	requireNoError(t, err)
	_, err = contract.PublishBenefitPlan(ctx, "benefit-plan-2")
	requireNoError(t, err)

	setIdentity(ctx, "policyholder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.SetBeneficiaries(ctx, "policy-benefit", `[{"beneficiaryId":"beneficiary-a","shareBps":6000},{"beneficiaryId":"beneficiary-b","shareBps":4000}]`)
	requireNoError(t, err)
	_, err = contract.SetBeneficiaries(ctx, "policy-benefit", `[{"beneficiaryId":"beneficiary-a","shareBps":5000}]`)
	requireError(t, err, "total 10000")
	request, err := contract.SubmitBenefitRequest(ctx, "benefit-request-1", "policy-benefit", "DEATH", "2026-06-15", hashC)
	requireNoError(t, err)
	if request.AmountMinor != 500_000 || request.BenefitPlanVersion != 1 || len(request.Allocations) != 2 {
		t.Fatalf("benefit request did not snapshot rules and allocations: %+v", request)
	}

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	request, err = contract.DecideBenefitRequest(ctx, request.ID, "APPROVE", hashD)
	requireNoError(t, err)
	if request.Status != "FUNDING_REQUIRED" {
		t.Fatalf("expected funding-required benefit, got %s", request.Status)
	}
	request, err = contract.MarkBenefitPaymentReady(ctx, request.ID, hashA)
	requireNoError(t, err)
	if request.Status != "PAYMENT_READY" {
		t.Fatalf("expected payment-ready benefit, got %s", request.Status)
	}

	setIdentity(ctx, "bank-officer", "BankMSP", "bankOfficer", nil)
	request, err = contract.ConfirmBenefitPayment(ctx, request.ID, hashB)
	requireNoError(t, err)
	liability, err := contract.ReadLiability(ctx, "liability-benefit-"+request.ID)
	requireNoError(t, err)
	if request.Status != "PAID" || liability.Status != "PAID" || liability.BankReferenceHash != hashB {
		t.Fatalf("benefit payment did not close its liability: request=%+v liability=%+v", request, liability)
	}
}

func setupOracleRequest(t *testing.T, suffix string) (*Contract, *testContext, *OracleRequest) {
	t.Helper()
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	hashA := strings.Repeat("a", 64)
	hashB := strings.Repeat("b", 64)
	hashC := strings.Repeat("c", 64)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := contract.CreatePolicyPackage(ctx, "package-oracle-"+suffix, "Oracle", "", 100, 100_000, hashA)
	requireNoError(t, err)
	_, err = contract.PublishPolicyPackage(ctx, "package-oracle-"+suffix)
	requireNoError(t, err)
	_, err = contract.IssuePolicy(ctx, "policy-oracle-"+suffix, "package-oracle-"+suffix, "policyholder1", "2026-01-01", "2026-12-31")
	requireNoError(t, err)

	setIdentity(ctx, "policyholder-cert", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.SubmitClaim(ctx, "claim-oracle-"+suffix, "policy-oracle-"+suffix, 50_000, "2026-06-01", hashB)
	requireNoError(t, err)
	setIdentity(ctx, "hospital-cert", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital1"})
	_, err = contract.VerifyClaim(ctx, "claim-oracle-"+suffix, "verification-oracle-"+suffix, "VERIFIED", hashC)
	requireNoError(t, err)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err = contract.PublishOracleRegistrySnapshot(ctx, "registry-oracle-"+suffix, 1, hashA, "rules-v1", hashB, 4)
	requireNoError(t, err)
	request, err := contract.RequestOracleVerification(
		ctx,
		"request-oracle-"+suffix,
		"claim-oracle-"+suffix,
		"registry-oracle-"+suffix,
		"model-v1",
		hashC,
		`["oracle1","oracle2"]`,
		"2026-09-05T12:05:00Z",
		"2026-09-05T12:10:00Z",
	)
	requireNoError(t, err)
	return contract, ctx, request
}

func commitOracleTestResult(t *testing.T, contract *Contract, ctx *testContext, request *OracleRequest, oracleID string, verified bool, code, recordHash, salt string) string {
	t.Helper()
	resultHash := oracleResultDigest(request, verified, code, recordHash)
	commitment := oracleCommitmentDigest(request, verified, resultHash, salt)
	setIdentity(ctx, "certificate-"+oracleID, "OracleMSP", "oracle", map[string]string{"subjectId": oracleID})
	_, err := contract.SubmitOracleCommitment(ctx, request.ID, commitment)
	requireNoError(t, err)
	return resultHash
}

func revealOracleTestResult(t *testing.T, contract *Contract, ctx *testContext, request *OracleRequest, oracleID string, verified bool, code, recordHash, resultHash, salt string) *OracleResult {
	t.Helper()
	setIdentity(ctx, "certificate-"+oracleID, "OracleMSP", "oracle", map[string]string{"subjectId": oracleID})
	result, err := contract.RevealOracleResult(
		ctx, request.ID, verified, code, recordHash, resultHash,
		request.ClaimVersion, request.RegistryVersion, request.ModelVersion, request.ModelHash, salt,
	)
	requireNoError(t, err)
	return result
}

func TestOracleAuthorizationCommitRevealAndExactSuccess(t *testing.T) {
	contract, ctx, request := setupOracleRequest(t, "success")
	recordHash := strings.Repeat("d", 64)
	salt1 := strings.Repeat("1", 64)
	salt2 := strings.Repeat("2", 64)
	resultHash := oracleResultDigest(request, true, "VERIFIED", recordHash)
	commitment1 := oracleCommitmentDigest(request, true, resultHash, salt1)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := contract.SubmitOracleCommitment(ctx, request.ID, commitment1)
	requireError(t, err, "caller MSP InsurerMSP")
	setIdentity(ctx, "wrong-role-oracle", "OracleMSP", "hospitalOfficer", map[string]string{"subjectId": "oracle1"})
	_, err = contract.SubmitOracleCommitment(ctx, request.ID, commitment1)
	requireError(t, err, "oracle role is required")
	setIdentity(ctx, "missing-subject-oracle", "OracleMSP", "oracle", nil)
	_, err = contract.SubmitOracleCommitment(ctx, request.ID, commitment1)
	requireError(t, err, "requires a valid subjectId")

	setIdentity(ctx, "certificate-oracle3", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle3"})
	_, err = contract.SubmitOracleCommitment(ctx, request.ID, commitment1)
	requireError(t, err, "is not assigned")

	commitOracleTestResult(t, contract, ctx, request, "oracle1", true, "VERIFIED", recordHash, salt1)
	setIdentity(ctx, "another-certificate", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle1"})
	_, err = contract.SubmitOracleCommitment(ctx, request.ID, commitment1)
	requireError(t, err, "already exists")
	commitOracleTestResult(t, contract, ctx, request, "oracle2", true, "VERIFIED", recordHash, salt2)

	setIdentity(ctx, "certificate-oracle1", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle1"})
	_, err = contract.RevealOracleResult(
		ctx, request.ID, true, "VERIFIED", recordHash, resultHash,
		request.ClaimVersion, request.RegistryVersion, request.ModelVersion, request.ModelHash, strings.Repeat("9", 64),
	)
	requireError(t, err, "does not match its commitment")
	_, err = contract.RevealOracleResult(
		ctx, request.ID, true, "VERIFIED", recordHash, resultHash,
		request.ClaimVersion, request.RegistryVersion+1, request.ModelVersion, request.ModelHash, salt1,
	)
	requireError(t, err, "registry version mismatch")

	revealOracleTestResult(t, contract, ctx, request, "oracle1", true, "VERIFIED", recordHash, resultHash, salt1)
	_, err = contract.RevealOracleResult(
		ctx, request.ID, true, "VERIFIED", recordHash, resultHash,
		request.ClaimVersion, request.RegistryVersion, request.ModelVersion, request.ModelHash, salt1,
	)
	requireError(t, err, "already exists")
	revealOracleTestResult(t, contract, ctx, request, "oracle2", true, "VERIFIED", recordHash, resultHash, salt2)
	claim, err := contract.ReadClaim(ctx, request.ClaimID)
	requireNoError(t, err)
	finalRequest, err := contract.ReadOracleRequest(ctx, request.ID)
	requireNoError(t, err)
	if claim.Status != "APPROVED" || claim.OracleOutcome != "EXACT_CONSENSUS" || claim.OracleResultHash != resultHash {
		t.Fatalf("exact Oracle success did not approve claim: %+v", claim)
	}
	if finalRequest.Status != "CONSENSUS" || !finalRequest.VerifiedResult || finalRequest.ResultHash != resultHash {
		t.Fatalf("unexpected finalized Oracle request: %+v", finalRequest)
	}

	setIdentity(ctx, "certificate-oracle1", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle1"})
	_, err = contract.AuthorizeSettlement(ctx, "settlement-forged-by-oracle", claim.ID)
	requireError(t, err, "caller MSP OracleMSP")
	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err = contract.AuthorizeSettlement(ctx, "settlement-oracle-success", claim.ID)
	requireNoError(t, err)
}

func TestOracleNegativeConflictTimeoutAndFallback(t *testing.T) {
	t.Run("matching negative result", func(t *testing.T) {
		contract, ctx, request := setupOracleRequest(t, "negative")
		recordHash := strings.Repeat("d", 64)
		salt1 := strings.Repeat("1", 64)
		salt2 := strings.Repeat("2", 64)
		resultHash := commitOracleTestResult(t, contract, ctx, request, "oracle1", false, "RECORD_INVALID", recordHash, salt1)
		commitOracleTestResult(t, contract, ctx, request, "oracle2", false, "RECORD_INVALID", recordHash, salt2)
		revealOracleTestResult(t, contract, ctx, request, "oracle1", false, "RECORD_INVALID", recordHash, resultHash, salt1)
		revealOracleTestResult(t, contract, ctx, request, "oracle2", false, "RECORD_INVALID", recordHash, resultHash, salt2)
		claim, err := contract.ReadClaim(ctx, request.ClaimID)
		requireNoError(t, err)
		if claim.Status != "ORACLE_FAILED" || claim.OracleOutcome != "NEGATIVE_RESULT" {
			t.Fatalf("matching negative result was not classified correctly: %+v", claim)
		}

		setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
		review, err := contract.RouteOracleFailureToReview(
			ctx, request.ID, "review-oracle-negative", `["auditor1","auditor2","auditor3","auditor4"]`,
			3, 2, "2026-09-08T12:00:00Z",
		)
		requireNoError(t, err)
		if review.Kind != "INITIAL" || review.Status != "OPEN" {
			t.Fatalf("Oracle failure did not open governed fallback review: %+v", review)
		}
	})

	t.Run("different complete results conflict", func(t *testing.T) {
		contract, ctx, request := setupOracleRequest(t, "conflict")
		recordA := strings.Repeat("d", 64)
		recordB := strings.Repeat("e", 64)
		salt1 := strings.Repeat("1", 64)
		salt2 := strings.Repeat("2", 64)
		resultA := commitOracleTestResult(t, contract, ctx, request, "oracle1", true, "VERIFIED", recordA, salt1)
		resultB := commitOracleTestResult(t, contract, ctx, request, "oracle2", true, "VERIFIED", recordB, salt2)
		revealOracleTestResult(t, contract, ctx, request, "oracle1", true, "VERIFIED", recordA, resultA, salt1)
		revealOracleTestResult(t, contract, ctx, request, "oracle2", true, "VERIFIED", recordB, resultB, salt2)
		claim, err := contract.ReadClaim(ctx, request.ClaimID)
		requireNoError(t, err)
		if claim.Status != "ORACLE_FAILED" || claim.OracleOutcome != "CONFLICT" || claim.OracleResultHash != "" {
			t.Fatalf("different exact results did not fail conservatively: %+v", claim)
		}
	})

	t.Run("timeout after reveal deadline", func(t *testing.T) {
		contract, ctx, request := setupOracleRequest(t, "timeout")
		setIdentity(ctx, "policyholder-cert", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
		_, err := contract.FinalizeOracleTimeout(ctx, request.ID)
		requireError(t, err, "has not timed out")
		ctx.stub.timestamp = timestamppb.New(time.Date(2026, time.September, 5, 12, 11, 0, 0, time.UTC))
		finalRequest, err := contract.FinalizeOracleTimeout(ctx, request.ID)
		requireNoError(t, err)
		claim, err := contract.ReadClaim(ctx, request.ClaimID)
		requireNoError(t, err)
		if finalRequest.FinalizationCode != "TIMEOUT" || claim.OracleOutcome != "TIMEOUT" || claim.Status != "ORACLE_FAILED" {
			t.Fatalf("Oracle timeout did not fail safely: request=%+v claim=%+v", finalRequest, claim)
		}
	})
}

func TestOracleDeadlinesStaleVersionsAndAppealIsolation(t *testing.T) {
	contract, ctx, request := setupOracleRequest(t, "versioning")
	recordHash := strings.Repeat("d", 64)
	salt1 := strings.Repeat("1", 64)
	salt2 := strings.Repeat("2", 64)
	resultHash := oracleResultDigest(request, false, "RECORD_INVALID", recordHash)

	setIdentity(ctx, "certificate-oracle1", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle1"})
	_, err := contract.RevealOracleResult(
		ctx, request.ID, false, "RECORD_INVALID", recordHash, resultHash,
		request.ClaimVersion+1, request.RegistryVersion, request.ModelVersion, request.ModelHash, salt1,
	)
	requireError(t, err, "claim version mismatch")

	commitOracleTestResult(t, contract, ctx, request, "oracle1", false, "RECORD_INVALID", recordHash, salt1)
	commitOracleTestResult(t, contract, ctx, request, "oracle2", false, "RECORD_INVALID", recordHash, salt2)
	revealOracleTestResult(t, contract, ctx, request, "oracle1", false, "RECORD_INVALID", recordHash, resultHash, salt1)
	revealOracleTestResult(t, contract, ctx, request, "oracle2", false, "RECORD_INVALID", recordHash, resultHash, salt2)

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err = contract.RouteOracleFailureToReview(
		ctx, request.ID, "review-oracle-versioning", `["auditor1","auditor2","auditor3","auditor4"]`,
		3, 2, "2026-09-08T12:00:00Z",
	)
	requireNoError(t, err)
	for _, auditorID := range []string{"auditor1", "auditor2"} {
		setIdentity(ctx, "certificate-"+auditorID, "AuditorMSP", "auditor", map[string]string{"subjectId": auditorID})
		_, err = contract.RecordAuditorDecision(ctx, "review-oracle-versioning", "decision-oracle-versioning-"+auditorID, "REJECT", strings.Repeat("e", 64))
		requireNoError(t, err)
	}
	setIdentity(ctx, "policyholder-cert", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	appeal, err := contract.SubmitClaimAppeal(ctx, "appeal-oracle-versioning", request.ClaimID, strings.Repeat("a", 64), "")
	requireNoError(t, err)
	claim, err := contract.ReadClaim(ctx, request.ClaimID)
	requireNoError(t, err)
	if claim.Version != 2 || claim.CurrentOracleRequestID != "" || appeal.Round != 1 {
		t.Fatalf("appeal did not isolate the prior Oracle request: claim=%+v appeal=%+v", claim, appeal)
	}

	setIdentity(ctx, "certificate-oracle1", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle1"})
	_, err = contract.RevealOracleResult(
		ctx, request.ID, false, "RECORD_INVALID", recordHash, resultHash,
		request.ClaimVersion, request.RegistryVersion, request.ModelVersion, request.ModelHash, salt1,
	)
	requireError(t, err, "already finalized")

	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	appealRequest, err := contract.RequestOracleVerification(
		ctx, "request-oracle-appeal", claim.ID, request.RegistrySnapshotID, request.ModelVersion, request.ModelHash,
		`["oracle1","oracle2"]`, "2026-09-05T12:05:00Z", "2026-09-05T12:10:00Z",
	)
	requireNoError(t, err)
	if appealRequest.ClaimVersion != 2 || appealRequest.QueryHash == request.QueryHash {
		t.Fatalf("appeal Oracle request was not rebound to claim version 2: %+v", appealRequest)
	}
}

func TestOracleLateSubmissionsAreRejected(t *testing.T) {
	contract, ctx, request := setupOracleRequest(t, "late")
	recordHash := strings.Repeat("d", 64)
	salt := strings.Repeat("1", 64)
	resultHash := oracleResultDigest(request, true, "VERIFIED", recordHash)
	commitment := oracleCommitmentDigest(request, true, resultHash, salt)
	ctx.stub.timestamp = timestamppb.New(time.Date(2026, time.September, 5, 12, 6, 0, 0, time.UTC))
	setIdentity(ctx, "certificate-oracle1", "OracleMSP", "oracle", map[string]string{"subjectId": "oracle1"})
	_, err := contract.SubmitOracleCommitment(ctx, request.ID, commitment)
	requireError(t, err, "commit phase has ended")
}

func TestOracleProtocolMatchesWorkerHashVector(t *testing.T) {
	request := &OracleRequest{
		ID: "request-vector-1", ClaimID: "claim-vector-1", QueryHash: strings.Repeat("1", 64),
		ClaimVersion: 2, HospitalVerificationID: "verification-vector-1",
		RegistrySnapshotID: "registry-demo-v1", RegistryVersion: 1, RegistryRootHash: strings.Repeat("2", 64),
		RulesVersion: "rules-v1", RulesHash: strings.Repeat("3", 64),
		ModelVersion: "model-v1", ModelHash: strings.Repeat("4", 64),
	}
	resultHash := oracleResultDigest(request, true, "VERIFIED", strings.Repeat("5", 64))
	if resultHash != "310ba46f898f75725e6c041800559faf9d69f72c40749874e15c1f7b7afd89e2" {
		t.Fatalf("Go Oracle result hash diverged from the Node worker: %s", resultHash)
	}
	commitment := oracleCommitmentDigest(request, true, resultHash, strings.Repeat("6", 64))
	if commitment != "dc82bc23fc7d06bce5a00726f88b387baf6a82acfa5d70c7e2bfe49524708d89" {
		t.Fatalf("Go Oracle commitment diverged from the Node worker: %s", commitment)
	}
}
