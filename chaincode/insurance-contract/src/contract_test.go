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
	_, err = contract.StartClaimReview(ctx, "claim-001")
	requireNoError(t, err)

	setIdentity(ctx, "auditor-001", "AuditorMSP", "auditor", nil)
	_, err = contract.RecordAuditorDecision(ctx, "claim-001", "decision-001", "APPROVE", hashB)
	requireNoError(t, err)

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
	if claim.HospitalVerificationID != "verification-001" || claim.AuditorDecisionID != "decision-001" {
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
	_, err = contract.StartClaimReview(ctx, "claim-001")
	requireError(t, err, "must be HOSPITAL_VERIFIED")
	_, err = contract.AuthorizeSettlement(ctx, "settlement-001", "claim-001")
	requireError(t, err, "must be APPROVED")
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
