package insurance

import (
	"math"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

func premiumAuditFixture(t *testing.T) (*Contract, *testContext, *Policy) {
	t.Helper()
	c := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	setIdentity(ctx, "admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := c.CreatePartnerAgreement(ctx, "agreement-audit", "BANK", "bank-demo", "Bank", "", "", "Premiums", "2026-01-01", "2028-12-31")
	requireNoError(t, err)
	p := &Policy{AssetType: "policy", ID: "policy-audit", PolicyholderID: "holder-audit", BankIDs: []string{"bank-demo"}, PremiumMinor: 100,
		StartDate: "2026-01-01", EndDate: "2026-12-31", NextPremiumDueDate: "2026-01-01", PremiumIntervalDays: 30, Status: "ACTIVE"}
	requireNoError(t, putState(ctx, "policy", p.ID, p))
	setIdentity(ctx, "bank", "BankMSP", "bankOfficer", nil)
	_, err = openTestBankAccount(ctx, c, "account-audit-customer", "bank-demo", p.PolicyholderID, "CUSTOMER", "Customer", "****1234", strings.Repeat("a", 64), 1000)
	requireNoError(t, err)
	_, err = openTestBankAccount(ctx, c, "account-audit-insurer", "bank-demo", "insurer", "INSURER", "Insurer", "****5678", strings.Repeat("b", 64), 1000)
	requireNoError(t, err)
	return c, ctx, p
}

func TestPremiumPeriodCannotBuyExcessCoverage(t *testing.T) {
	p := &Policy{ID: "policy-audit", Status: "ACTIVE", StartDate: "2026-01-01", EndDate: "2026-12-31", NextPremiumDueDate: "2026-01-01", PremiumMinor: 100, PremiumIntervalDays: 30}
	requireNoError(t, validatePremiumPeriod(p, "2026-01-01", "2026-01-30", 100))
	requireError(t, validatePremiumPeriod(p, "2026-01-01", "2026-12-31", 100), "premium interval")
	p.PremiumIntervalDays = 0 // Retained policies use the default interval.
	requireError(t, validatePremiumPeriod(p, "2026-01-01", "2026-01-31", 100), "premium interval")
}

func TestPremiumCollectionRespectsMandateExpiry(t *testing.T) {
	c, ctx, p := premiumAuditFixture(t)
	mandate := &BankMandate{ID: "mandate-audit", PolicyID: p.ID, AccountReferenceID: "account-audit-customer", AmountMinor: 100, Status: "ACTIVE", ExpiryDate: "2026-01-15"}
	requireNoError(t, putState(ctx, "bankMandate", mandate.ID, mandate))
	collection := &PremiumCollection{ID: "collection-audit", PolicyID: p.ID, MandateID: mandate.ID, AmountMinor: 100, DueDate: "2026-01-01", Status: "DUE"}
	requireNoError(t, putState(ctx, "premiumCollection", collection.ID, collection))
	_, err := c.ProcessPremiumCollection(ctx, collection.ID, "payment-audit", "transfer-audit", "account-audit-insurer", "2026-01-30", strings.Repeat("c", 64))
	requireError(t, err, "mandate expiry")
	account, err := c.ReadBankAccountReference(ctx, "account-audit-customer")
	requireNoError(t, err)
	if account.BalanceMinor != 1000 {
		t.Fatal("invalid collection changed the account balance")
	}
}

func TestPremiumDestinationMustBeOwnedByInsurer(t *testing.T) {
	c, ctx, p := premiumAuditFixture(t)
	account, err := c.ReadBankAccountReference(ctx, "account-audit-insurer")
	requireNoError(t, err)
	account.OwnerID = "another-owner"
	requireNoError(t, persistBankAccount(ctx, account, false))
	_, _, err = validatePremiumAccounts(ctx, c, p, "account-audit-customer", account.ID)
	requireError(t, err, "belong to the insurer")
}

func TestBankBalanceAndAdjustmentOverflowAreRejected(t *testing.T) {
	c, ctx, _ := premiumAuditFixture(t)
	account, err := c.ReadBankAccountReference(ctx, "account-audit-insurer")
	requireNoError(t, err)
	account.BalanceMinor = math.MaxInt64
	requireNoError(t, persistBankAccount(ctx, account, false))
	_, err = c.AdjustBankAccountBalance(ctx, "transfer-overflow", account.ID, "CREDIT", 1, strings.Repeat("c", 64))
	requireError(t, err, "overflow")
	account, err = c.ReadBankAccountReference(ctx, account.ID)
	requireNoError(t, err)
	if account.BalanceMinor != math.MaxInt64 {
		t.Fatal("overflow persisted a corrupt balance")
	}
	payment := &PremiumPayment{ID: "payment-large", PolicyID: "policy-audit", AmountMinor: math.MaxInt64}
	requireNoError(t, putState(ctx, "premiumPayment", payment.ID, payment))
	requireNoError(t, putState(ctx, "premiumAdjustment", "adjustment-existing", &PremiumAdjustment{ID: "adjustment-existing", PaymentID: payment.ID, AmountMinor: math.MaxInt64 - 100}))
	_, err = c.RecordPremiumAdjustment(ctx, "adjustment-overflow", payment.ID, 200, strings.Repeat("d", 64), strings.Repeat("e", 64))
	requireError(t, err, "cannot exceed")
}

func TestPolicyExpiryIncludesLastCoverageDayAndUnpaidPolicies(t *testing.T) {
	for _, status := range []string{"ACTIVE", "PENDING_PAYMENT"} {
		t.Run(status, func(t *testing.T) {
			c := &Contract{}
			ctx := &testContext{stub: newMemoryStub()}
			setIdentity(ctx, "admin", "InsurerMSP", "insurerAdmin", nil)
			p := &Policy{ID: "policy-expiry", Status: status, EndDate: "2026-12-31", NextPremiumDueDate: "2027-01-01"}
			requireNoError(t, putState(ctx, "policy", p.ID, p))
			if _, err := c.AdvancePolicyLifecycle(ctx, p.ID, "2026-12-31"); err == nil {
				t.Fatal("policy expired on its inclusive coverage end date")
			}
			updated, err := c.AdvancePolicyLifecycle(ctx, p.ID, "2027-01-01")
			requireNoError(t, err)
			if updated.Status != "EXPIRED" {
				t.Fatalf("expected expired policy, got %s", updated.Status)
			}
		})
	}
}

func TestPartnerAgreementDatesAreEnforced(t *testing.T) {
	c := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	setIdentity(ctx, "admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := c.CreatePartnerAgreement(ctx, "agreement-dated", "BANK", "bank-dated", "Bank", "", "", "Premiums", "2026-09-05", "2026-09-06")
	requireNoError(t, err)
	for _, tc := range []struct {
		day   int
		valid bool
	}{{4, false}, {5, true}, {6, true}, {7, false}} {
		ctx.stub.timestamp = timestamppb.New(time.Date(2026, time.September, tc.day, 12, 0, 0, 0, time.UTC))
		_, err = c.requireActivePartner(ctx, "BANK", "bank-dated")
		if (err == nil) != tc.valid {
			t.Fatalf("day %d: expected valid=%v, got %v", tc.day, tc.valid, err)
		}
	}
}

func TestIssuedPolicyPremiumDatesStayConsistent(t *testing.T) {
	c := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	setIdentity(ctx, "admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := c.CreatePolicyPackage(ctx, "package-audit", "Audit", "", 100, 1000, strings.Repeat("a", 64))
	requireNoError(t, err)
	_, err = c.PublishPolicyPackage(ctx, "package-audit")
	requireNoError(t, err)
	for _, tc := range []struct{ id, end, paid, due string }{
		{"policy-full", "2026-12-31", "2026-01-30", "2026-01-31"},
		{"policy-short", "2026-01-10", "2026-01-10", "2026-01-11"},
	} {
		policy, err := c.IssuePolicy(ctx, tc.id, "package-audit", "holder-audit", "2026-01-01", tc.end)
		requireNoError(t, err)
		if policy.PaidThroughDate != tc.paid || policy.NextPremiumDueDate != tc.due {
			t.Fatalf("inconsistent premium dates: %+v", policy)
		}
	}
}

func TestMandateCannotExpireBeforeItsFirstDebit(t *testing.T) {
	c, ctx, p := premiumAuditFixture(t)
	p.NextPremiumDueDate = "2026-10-01"
	requireNoError(t, overwriteAsset(ctx, "policy", p.ID, p))
	setIdentity(ctx, "holder", "InsurerMSP", "policyholder", map[string]string{"subjectId": p.PolicyholderID})
	_, err := c.RequestBankMandate(ctx, "mandate-invalid-dates", p.ID, "account-audit-customer", "2026-09-30")
	requireError(t, err, "precede the next premium due date")
}
