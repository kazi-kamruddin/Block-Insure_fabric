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
