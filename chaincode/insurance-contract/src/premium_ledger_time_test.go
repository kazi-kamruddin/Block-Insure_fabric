package insurance

import (
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

// premiumFixture buys a policy starting 2026-01-01, pays January by OTP and
// leaves an approved mandate whose next debit is 2026-01-31. The memory stub's
// ledger time is 2026-09-05 (Dhaka), so January is in the past.
func premiumFixture(t *testing.T, customerBalanceMinor int64) (*Contract, *testContext) {
	t.Helper()
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := contract.CreatePartnerAgreement(ctx, "agreement-bank-premium", "BANK", "bank-demo", "Demo Bank", "Dhaka", "Preferred", "Premium payments", "2026-01-01", "2028-12-31")
	requireNoError(t, err)
	_, err = contract.CreatePartnerAgreement(ctx, "agreement-hospital-premium", "HOSPITAL", "hospital-demo", "Demo Hospital", "Dhaka", "Preferred", "Invoices", "2026-01-01", "2028-12-31")
	requireNoError(t, err)
	_, err = contract.CreatePolicyPackage(ctx, "package-premium", "Premium", "", 10_000, 1_000_000, strings.Repeat("a", 64))
	requireNoError(t, err)
	_, err = contract.ConfigurePolicyPackagePartners(ctx, "package-premium", `["hospital-demo"]`, `["bank-demo"]`)
	requireNoError(t, err)
	_, err = contract.PublishPolicyPackage(ctx, "package-premium")
	requireNoError(t, err)

	setIdentity(ctx, "bank-officer", "BankMSP", "bankOfficer", nil)
	_, err = openTestBankAccount(ctx, contract, "account-customer", "bank-demo", "policyholder1", "CUSTOMER", "Savings", "**** 4821", strings.Repeat("b", 64), customerBalanceMinor)
	requireNoError(t, err)
	_, err = openTestBankAccount(ctx, contract, "account-insurer", "bank-demo", "insurer", "INSURER", "Premium account", "**** 9001", strings.Repeat("c", 64), 0)
	requireNoError(t, err)

	setIdentity(ctx, "policyholder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.AcquirePolicy(ctx, "policy-premium", "package-premium", "2026-01-01", "2026-12-31")
	requireNoError(t, err)
	_, err = contract.RequestBankMandate(ctx, "mandate-premium", "policy-premium", "account-customer", "2026-12-31")
	requireNoError(t, err)

	setIdentity(ctx, "bank-officer", "BankMSP", "bankOfficer", nil)
	_, err = contract.ReviewBankMandate(ctx, "mandate-premium", "APPROVE", strings.Repeat("d", 64))
	requireNoError(t, err)
	_, err = contract.ExecuteManualPremiumPayment(ctx, "transfer-otp", "payment-otp", "policy-premium", "account-customer", "account-insurer", "2026-01-01", "2026-01-30", 10_000, strings.Repeat("e", 64), strings.Repeat("f", 64))
	requireNoError(t, err)
	return contract, ctx
}

func asInsurer(ctx *testContext) {
	setIdentity(ctx, "insurer-admin", "InsurerMSP", "insurerAdmin", nil)
}
func asBank(ctx *testContext) { setIdentity(ctx, "bank-officer", "BankMSP", "bankOfficer", nil) }

func processCollection(ctx *testContext, contract *Contract, collectionID string, attempt int) (*PremiumCollection, error) {
	suffix := string(rune('0' + attempt))
	return contract.ProcessPremiumCollection(ctx, collectionID, "payment-eft-"+suffix, "transfer-eft-"+suffix, "account-insurer", "2026-03-01", strings.Repeat(suffix, 64))
}

func TestPremiumDatesCannotRunAheadOfLedgerTime(t *testing.T) {
	contract, ctx := premiumFixture(t, 30_000)
	asInsurer(ctx)
	_, err := contract.AdvancePolicyLifecycle(ctx, "policy-premium", "2026-09-06")
	requireError(t, err, "later than the ledger business date 2026-09-05")
	_, err = contract.SchedulePremiumCollections(ctx, "2026-09-06")
	requireError(t, err, "later than the ledger business date")
	_, err = contract.QueuePremiumCollection(ctx, "collection-early", "mandate-premium", "2026-09-06")
	requireError(t, err, "not active and due")

	// The mandate's real next debit date is 2026-01-31; a collection placed in
	// the future by any route is still not processable before its due date.
	future := &PremiumCollection{AssetType: "premiumCollection", SchemaVersion: SchemaVersion, ID: "collection-future",
		PolicyID: "policy-premium", MandateID: "mandate-premium", DueDate: "2026-10-01", AmountMinor: 10_000, Status: "DUE"}
	requireNoError(t, putState(ctx, "premiumCollection", future.ID, future))
	asBank(ctx)
	_, err = processCollection(ctx, contract, "collection-future", 1)
	requireError(t, err, "collection due date 2026-10-01 is later than the ledger business date")
	_, err = contract.ExpireBankMandate(ctx, "mandate-premium", "2027-01-01")
	requireError(t, err, "later than the ledger business date")

	// The Dhaka date is used: 19:00 UTC on 5 September is 6 September in Dhaka.
	ctx.stub.timestamp = timestamppb.New(time.Date(2026, time.September, 5, 19, 0, 0, 0, time.UTC))
	asInsurer(ctx)
	policy, err := contract.AdvancePolicyLifecycle(ctx, "policy-premium", "2026-09-06")
	requireNoError(t, err)
	if policy.Status != "LAPSED" {
		t.Fatalf("expected the unpaid policy to lapse, got %s", policy.Status)
	}
}

func TestBouncedCollectionCanBeRetriedAfterFunding(t *testing.T) {
	contract, ctx := premiumFixture(t, 15_000)
	asInsurer(ctx)
	scheduled, err := contract.SchedulePremiumCollections(ctx, "2026-01-31")
	requireNoError(t, err)
	if len(scheduled) != 1 {
		t.Fatalf("expected one collection, got %d", len(scheduled))
	}
	id := scheduled[0].ID
	_, err = contract.RetryPremiumCollection(ctx, id)
	requireError(t, err, "must be BOUNCED")

	asBank(ctx)
	collection, err := processCollection(ctx, contract, id, 1)
	requireNoError(t, err)
	if collection.Status != "BOUNCED" || collection.FailureCode != "INSUFFICIENT_FUNDS" || collection.AttemptCount != 1 {
		t.Fatalf("expected first bounce, got %+v", collection)
	}
	_, err = processCollection(ctx, contract, id, 2)
	requireError(t, err, "is not due")

	asInsurer(ctx)
	collection, err = contract.RetryPremiumCollection(ctx, id)
	requireNoError(t, err)
	if collection.Status != "RETRY" || collection.AttemptCount != 1 {
		t.Fatalf("expected RETRY after one attempt, got %+v", collection)
	}
	asBank(ctx)
	_, err = contract.AdjustBankAccountBalance(ctx, "funding-1", "account-customer", "CREDIT", 5_000, strings.Repeat("7", 64))
	requireNoError(t, err)
	collection, err = processCollection(ctx, contract, id, 2)
	requireNoError(t, err)
	if collection.Status != "COMPLETED" || collection.AttemptCount != 2 || collection.PaymentID != "payment-eft-2" {
		t.Fatalf("expected the retried collection to complete, got %+v", collection)
	}
	asInsurer(ctx)
	policy, err := contract.ReadPolicy(ctx, "policy-premium")
	requireNoError(t, err)
	if policy.PaidThroughDate != "2026-03-01" || policy.NextPremiumDueDate != "2026-03-02" {
		t.Fatalf("retried premium did not advance the policy: %+v", policy)
	}
	_, err = contract.RetryPremiumCollection(ctx, id)
	requireError(t, err, "must be BOUNCED")
}

func TestPremiumRetryIsBoundedAndStopsForLapsedPolicies(t *testing.T) {
	contract, ctx := premiumFixture(t, 15_000)
	asInsurer(ctx)
	scheduled, err := contract.SchedulePremiumCollections(ctx, "2026-01-31")
	requireNoError(t, err)
	id := scheduled[0].ID
	for attempt := 1; attempt <= maxPremiumCollectionAttempts; attempt++ {
		asBank(ctx)
		collection, err := processCollection(ctx, contract, id, attempt)
		requireNoError(t, err)
		if collection.Status != "BOUNCED" {
			t.Fatalf("attempt %d: expected bounce, got %s", attempt, collection.Status)
		}
		asInsurer(ctx)
		if attempt < maxPremiumCollectionAttempts {
			_, err = contract.RetryPremiumCollection(ctx, id)
			requireNoError(t, err)
		}
	}
	_, err = contract.RetryPremiumCollection(ctx, id)
	requireError(t, err, "maximum of 3 attempts")

	other, otherCtx := premiumFixture(t, 15_000)
	asInsurer(otherCtx)
	scheduled, err = other.SchedulePremiumCollections(otherCtx, "2026-01-31")
	requireNoError(t, err)
	asBank(otherCtx)
	_, err = processCollection(otherCtx, other, scheduled[0].ID, 1)
	requireNoError(t, err)
	asInsurer(otherCtx)
	policy, err := other.AdvancePolicyLifecycle(otherCtx, "policy-premium", "2026-03-01")
	requireNoError(t, err)
	if policy.Status != "LAPSED" {
		t.Fatalf("expected LAPSED, got %s", policy.Status)
	}
	_, err = other.RetryPremiumCollection(otherCtx, scheduled[0].ID)
	requireError(t, err, "cannot retry a premium from LAPSED")
}

func TestBankAccountLinkRequestIsApprovedByTheBank(t *testing.T) {
	contract := &Contract{}
	ctx := &testContext{stub: newMemoryStub()}
	asInsurer(ctx)
	_, err := contract.CreatePartnerAgreement(ctx, "agreement-bank-link", "BANK", "bank-demo", "Demo Bank", "Dhaka", "Preferred", "Accounts", "2026-01-01", "2028-12-31")
	requireNoError(t, err)

	setIdentity(ctx, "policyholder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.RequestBankAccountLink(ctx, "link-unknown-bank", "bank-missing", "Savings", "**** 1234")
	requireError(t, err, "")
	_, err = contract.RequestBankAccountLink(ctx, "link-plain", "bank-demo", "Savings", "1234")
	requireError(t, err, "maskedAccount")
	request, err := contract.RequestBankAccountLink(ctx, "link-1", "bank-demo", " Savings ", "**** 1234")
	requireNoError(t, err)
	if request.Status != "PENDING" || request.OwnerID != "policyholder1" || request.AccountLabel != "Savings" {
		t.Fatalf("unexpected link request: %+v", request)
	}
	_, err = contract.RequestBankAccountLink(ctx, "link-duplicate", "bank-demo", "Savings", "**** 1234")
	requireError(t, err, "already pending")

	setIdentity(ctx, "policyholder-2", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder2"})
	_, err = contract.ReadBankAccountLink(ctx, "link-1")
	requireError(t, err, "access denied")
	visible, err := contract.ListBankAccountLinks(ctx)
	requireNoError(t, err)
	if len(visible) != 0 {
		t.Fatalf("another policyholder saw %d link requests", len(visible))
	}
	_, err = contract.ReviewBankAccountLink(ctx, "link-1", "APPROVE", "account-linked", strings.Repeat("a", 64))
	requireError(t, err, "")

	asBank(ctx)
	_, err = contract.ReviewBankAccountLink(ctx, "link-1", "REJECT", "account-linked", strings.Repeat("a", 64))
	requireError(t, err, "cannot name an account")
	ctx.stub.transient[bankAccountTransientKey] = []byte(`{"accountTokenHash":"` + strings.Repeat("b", 64) + `","openingBalanceMinor":25000}`)
	request, err = contract.ReviewBankAccountLink(ctx, "link-1", "APPROVE", "account-linked", strings.Repeat("a", 64))
	requireNoError(t, err)
	if request.Status != "LINKED" || request.AccountReferenceID != "account-linked" {
		t.Fatalf("unexpected reviewed link: %+v", request)
	}
	account, err := contract.ReadBankAccountReference(ctx, "account-linked")
	requireNoError(t, err)
	if account.OwnerID != "policyholder1" || account.AccountType != "CUSTOMER" || account.Status != "VERIFIED" || account.BalanceMinor != 25_000 || account.MaskedAccount != "**** 1234" {
		t.Fatalf("approved link opened the wrong account: %+v", account)
	}
	_, err = contract.ReviewBankAccountLink(ctx, "link-1", "APPROVE", "account-again", strings.Repeat("a", 64))
	requireError(t, err, "must be PENDING")
	public, err := getState[BankAccountLinkRequest](ctx, "bankAccountLink", "link-1")
	requireNoError(t, err)
	if strings.Contains(string(ctx.stub.state[mustKey(t, ctx, "bankAccountReference", "account-linked")]), strings.Repeat("b", 64)) || public.Status != "LINKED" {
		t.Fatal("the account token reached public state")
	}

	setIdentity(ctx, "policyholder", "InsurerMSP", "policyholder", map[string]string{"subjectId": "policyholder1"})
	_, err = contract.RequestBankAccountLink(ctx, "link-2", "bank-demo", "Salary", "**** 9876")
	requireNoError(t, err)
	cancelled, err := contract.CancelBankAccountLink(ctx, "link-2")
	requireNoError(t, err)
	if cancelled.Status != "CANCELLED" {
		t.Fatalf("expected CANCELLED, got %s", cancelled.Status)
	}
	asBank(ctx)
	_, err = contract.ReviewBankAccountLink(ctx, "link-2", "REJECT", "", strings.Repeat("c", 64))
	requireError(t, err, "must be PENDING")
	_, err = contract.RequestBankAccountLink(ctx, "link-bank", "bank-demo", "Savings", "**** 5555")
	requireError(t, err, "")
}

func mustKey(t *testing.T, ctx *testContext, assetType, id string) string {
	t.Helper()
	key, err := stateKey(ctx, assetType, id)
	requireNoError(t, err)
	return key
}
