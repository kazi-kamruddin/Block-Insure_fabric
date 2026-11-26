package insurance

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
)

// coverFixture publishes a realistic medical product on the isolated medical
// channel: BDT 1,250 per 30 days, BDT 300,000 overall limit, surgery sublimit
// BDT 150,000, 10% deductible capped at BDT 5,000 and an 80% insurer share.
type coverFixture struct {
	t        *testing.T
	contract *Contract
	ctx      *testContext
	episodes int
	payments int
}

const coverPremium int64 = 125_000

func newCoverFixture(t *testing.T, waitingDays int) *coverFixture {
	t.Helper()
	f := &coverFixture{t: t, contract: &Contract{}}
	stub := newMemoryStub()
	stub.channelID = medicalCandidateChannel
	f.ctx = &testContext{stub: stub}
	f.on("2026-09-05")
	f.insurer()
	hash := strings.Repeat("a", 64)
	_, err := f.contract.CreatePartnerAgreement(f.ctx, "agreement-hospital", "HOSPITAL", "hospital-one", "Hospital", "Dhaka", "Preferred", "Intake", "2026-01-01", "2028-01-01")
	requireNoError(t, err)
	_, err = f.contract.CreatePartnerAgreement(f.ctx, "agreement-bank", "BANK", "bank-demo", "Bank", "Dhaka", "Preferred", "Premiums", "2026-01-01", "2028-01-01")
	requireNoError(t, err)
	_, err = f.contract.CreatePolicyPackage(f.ctx, "surgical", "Surgical Care", "Surgery", coverPremium, 30_000_000, hash)
	requireNoError(t, err)
	_, err = f.contract.ConfigurePolicyPackagePartners(f.ctx, "surgical", `["hospital-one"]`, `["bank-demo"]`)
	requireNoError(t, err)
	_, err = f.contract.ConfigureMedicalRules(f.ctx, "surgical", "SURGERY", 15_000_000, 1000, 500_000, 8000, waitingDays, 90, false)
	requireNoError(t, err)
	_, err = f.contract.PublishPolicyPackage(f.ctx, "surgical")
	requireNoError(t, err)
	f.bank()
	_, err = openTestBankAccount(f.ctx, f.contract, "account-customer", "bank-demo", "owner", "CUSTOMER", "Salary", "**** 4821", strings.Repeat("b", 64), 5_000_000)
	requireNoError(t, err)
	_, err = openTestBankAccount(f.ctx, f.contract, "account-insurer", "bank-demo", "insurer", "INSURER", "Premiums", "**** 9001", strings.Repeat("c", 64), 0)
	requireNoError(t, err)
	return f
}

// on sets the ledger clock to noon in Dhaka on the given date.
func (f *coverFixture) on(date string) {
	day, err := time.Parse(time.DateOnly, date)
	requireNoError(f.t, err)
	f.ctx.stub.timestamp = timestamppb.New(day.Add(6 * time.Hour))
}

func (f *coverFixture) insurer() { setIdentity(f.ctx, "insurer", "InsurerMSP", "insurerAdmin", nil) }
func (f *coverFixture) bank()    { setIdentity(f.ctx, "bank-officer", "BankMSP", "bankOfficer", nil) }
func (f *coverFixture) holder() {
	setIdentity(f.ctx, "owner", "InsurerMSP", "policyholder", map[string]string{"subjectId": "owner"})
}

func (f *coverFixture) acquire(id, start, end string) (*Policy, error) {
	f.insurer()
	pkg, err := f.contract.ReadPolicyPackage(f.ctx, "surgical")
	requireNoError(f.t, err)
	f.holder()
	return f.contract.AcquireMedicalPolicy(f.ctx, id, "surgical", start, end, pkg.TermsHash)
}

func (f *coverFixture) pay(policyID, start, end string) error {
	f.bank()
	f.payments++
	reference := fmt.Sprintf("%064x", 9_000+f.payments)
	_, err := f.contract.ExecuteManualPremiumPayment(f.ctx, "transfer-"+policyID+"-"+start, "payment-"+policyID+"-"+start, policyID,
		"account-customer", "account-insurer", start, end, coverPremium, reference, strings.Repeat("f", 64))
	return err
}

func (f *coverFixture) policy(id string) *Policy {
	f.insurer()
	policy, err := f.contract.ReadPolicy(f.ctx, id)
	requireNoError(f.t, err)
	return policy
}

// quote records a verified hospital stay and asks for the reimbursement quote.
func (f *coverFixture) quote(policyID, admission, service string) (*MedicalQuote, error) {
	f.episodes++
	reference := fmt.Sprintf("%064x", 7_000+f.episodes)
	setIdentity(f.ctx, "hospital-one", "HospitalMSP", "hospitalOfficer", map[string]string{"subjectId": "hospital-one"})
	f.ctx.stub.transient["medicalEpisode"] = []byte(`{"patientReferenceHash":"` + strings.Repeat("a", 64) + `","service":"SURGERY","serviceDate":"` + service +
		`","admissionDate":"` + admission + `","dischargeDate":"` + service + `","invoiceDate":"` + service + `","billMinor":8500000}`)
	head, err := f.contract.SaveMedicalEpisode(f.ctx, reference, 0)
	requireNoError(f.t, err)
	f.insurer()
	_, err = f.contract.VerifyMedicalAssociation(f.ctx, head.ID, 1, "owner", strings.Repeat("d", 64), true)
	requireNoError(f.t, err)
	f.holder()
	return f.contract.QuoteMedicalClaim(f.ctx, policyID, head.ID, 1)
}

func TestMedicalCoverIsNeverBackdated(t *testing.T) {
	f := newCoverFixture(t, 0)
	_, err := f.acquire("policy-past", "2026-09-04", "2027-09-03")
	requireError(t, err, "never backdated")
	_, err = f.acquire("policy-far", "2026-11-05", "2027-11-04")
	requireError(t, err, "at most 60 days ahead, by 2026-11-04")
	_, err = f.acquire("policy-long", "2026-09-05", "2027-09-06")
	requireError(t, err, "at most one year")
	policy, err := f.acquire("policy-today", "2026-09-05", "2027-09-05")
	requireNoError(t, err)
	if policy.Status != "PENDING_PAYMENT" || policy.CoverStartDate != "" {
		t.Fatalf("a bought policy has no cover before payment: %+v", policy)
	}
	_, err = f.acquire("policy-ahead", "2026-11-04", "2027-11-03")
	requireNoError(t, err)
	// The Dhaka business date decides "today": 19:00 UTC is already the next day.
	f.ctx.stub.timestamp = timestamppb.New(time.Date(2026, time.September, 5, 19, 0, 0, 0, time.UTC))
	_, err = f.acquire("policy-utc", "2026-09-05", "2027-09-05")
	requireError(t, err, "ledger business date 2026-09-06")
}

func TestCoverStartsWhenTheFirstPremiumSettles(t *testing.T) {
	f := newCoverFixture(t, 0)
	_, err := f.acquire("policy-late", "2026-09-05", "2027-09-04")
	requireNoError(t, err)
	_, err = f.acquire("policy-stale", "2026-09-05", "2027-09-04")
	requireNoError(t, err)

	f.on("2026-09-10")
	requireNoError(t, f.pay("policy-late", "2026-09-05", "2026-10-04"))
	policy := f.policy("policy-late")
	if policy.Status != "ACTIVE" || policy.CoverStartDate != "2026-09-10" || policy.PaidThroughDate != "2026-10-04" {
		t.Fatalf("cover must start on the payment date: %+v", policy)
	}
	f.on("2026-09-12")
	_, err = f.quote("policy-late", "2026-09-08", "2026-09-08")
	requireError(t, err, "before cover started on 2026-09-10")
	// R3: discharge and service fall after cover started, but the stay did not.
	_, err = f.quote("policy-late", "2026-09-09", "2026-09-11")
	requireError(t, err, "began on 2026-09-09, before cover started")
	quote, err := f.quote("policy-late", "2026-09-10", "2026-09-11")
	requireNoError(t, err)
	// BDT 85,000 bill: 10% deductible capped at BDT 5,000, 80% of BDT 80,000.
	if quote.EligibleMinor != 8_500_000 || quote.DeductibleMinor != 500_000 || quote.PayableMinor != 6_400_000 {
		t.Fatalf("unexpected realistic quote: %+v", quote)
	}

	f.on("2026-09-21")
	requireError(t, f.pay("policy-stale", "2026-09-05", "2026-10-04"), "had to be paid by 2026-09-20")
}

func TestWaitingPeriodCountsFromCoverStart(t *testing.T) {
	f := newCoverFixture(t, 10)
	_, err := f.acquire("policy-wait", "2026-09-05", "2027-09-04")
	requireNoError(t, err)
	f.on("2026-09-06")
	requireNoError(t, f.pay("policy-wait", "2026-09-05", "2026-10-04"))
	f.on("2026-09-20")
	_, err = f.quote("policy-wait", "2026-09-15", "2026-09-17")
	requireError(t, err, "inside the waiting period that ends on 2026-09-16")
	_, err = f.quote("policy-wait", "2026-09-16", "2026-09-17")
	requireNoError(t, err)
}

func TestRenewalPaidInGraceKeepsCoverContinuous(t *testing.T) {
	f := newCoverFixture(t, 0)
	_, err := f.acquire("policy-grace", "2026-09-05", "2027-09-04")
	requireNoError(t, err)
	requireNoError(t, f.pay("policy-grace", "2026-09-05", "2026-10-04"))
	f.on("2026-10-15")
	requireNoError(t, f.pay("policy-grace", "2026-10-05", "2026-11-03"))
	_, err = f.quote("policy-grace", "2026-10-10", "2026-10-10")
	requireNoError(t, err)
	f.on("2026-11-20")
	requireError(t, f.pay("policy-grace", "2026-11-04", "2026-12-03"), "grace period for the installment due 2026-11-04 ended on 2026-11-19")
}

func TestLapsedPolicyIsReinstatedWithoutCoveringTheGap(t *testing.T) {
	f := newCoverFixture(t, 3)
	_, err := f.acquire("policy-lapse", "2026-09-05", "2027-09-04")
	requireNoError(t, err)
	requireNoError(t, f.pay("policy-lapse", "2026-09-05", "2026-10-04"))

	f.on("2026-10-25")
	requireError(t, f.pay("policy-lapse", "2026-10-05", "2026-11-03"), "ended on 2026-10-20")
	f.insurer()
	policy, err := f.contract.AdvancePolicyLifecycle(f.ctx, "policy-lapse", "2026-10-25")
	requireNoError(t, err)
	if policy.Status != "LAPSED" {
		t.Fatalf("expected LAPSED, got %s", policy.Status)
	}
	_, err = f.contract.AdvancePolicyLifecycle(f.ctx, "policy-lapse", "2026-10-10")
	requireError(t, err, "only expiry or reinstatement")
	requireError(t, f.pay("policy-lapse", "2026-10-05", "2026-11-03"), "missed installments cannot be paid")
	f.holder()
	_, err = f.contract.RequestBankMandate(f.ctx, "mandate-lapse", "policy-lapse", "account-customer", "2027-09-04")
	requireError(t, err, "ask the Insurer to reinstate it")

	f.insurer()
	policy, err = f.contract.ReinstatePolicy(f.ctx, "policy-lapse", strings.Repeat("e", 64))
	requireNoError(t, err)
	if policy.Status != "LAPSED" || policy.ReinstatedDate != "2026-10-25" || policy.NextPremiumDueDate != "2026-10-25" || policy.PaidThroughDate != "2026-10-04" {
		t.Fatalf("unexpected reinstatement offer: %+v", policy)
	}
	requireError(t, f.pay("policy-lapse", "2026-10-05", "2026-11-03"), "missed installments cannot be paid")
	// The offer is for the reinstatement day only; a later payment needs a new one.
	f.on("2026-10-26")
	requireError(t, f.pay("policy-lapse", "2026-10-25", "2026-11-23"), "missed installments cannot be paid")
	f.insurer()
	_, err = f.contract.ReinstatePolicy(f.ctx, "policy-lapse", strings.Repeat("e", 64))
	requireNoError(t, err)
	requireNoError(t, f.pay("policy-lapse", "2026-10-26", "2026-11-24"))
	policy = f.policy("policy-lapse")
	if policy.Status != "ACTIVE" || policy.CoverStartDate != "2026-09-05" || policy.ReinstatedDate != "2026-10-26" || policy.PaidThroughDate != "2026-11-24" {
		t.Fatalf("unexpected reinstated policy: %+v", policy)
	}
	_, err = f.contract.ReinstatePolicy(f.ctx, "policy-lapse", strings.Repeat("e", 64))
	requireError(t, err, "is ACTIVE and cannot be reinstated")

	f.on("2026-10-30")
	_, err = f.quote("policy-lapse", "2026-10-15", "2026-10-15")
	requireError(t, err, "no fully paid installment")
	_, err = f.quote("policy-lapse", "2026-10-27", "2026-10-28")
	requireError(t, err, "waiting period that ends on 2026-10-29")
	_, err = f.quote("policy-lapse", "2026-10-29", "2026-10-29")
	requireNoError(t, err)
	// Treatment during the original paid period stays claimable.
	_, err = f.quote("policy-lapse", "2026-09-20", "2026-09-20")
	requireNoError(t, err)
}

func TestFirstPremiumByMandateWithBounceRetryAndReinstatement(t *testing.T) {
	f := newCoverFixture(t, 0)
	_, err := f.acquire("policy-eft", "2026-09-07", "2027-09-06")
	requireNoError(t, err)
	f.holder()
	mandate, err := f.contract.RequestBankMandate(f.ctx, "mandate-eft", "policy-eft", "account-customer", "2027-09-06")
	requireNoError(t, err)
	if mandate.NextDebitDate != "2026-09-07" {
		t.Fatalf("the first debit is on the start date: %+v", mandate)
	}
	f.bank()
	_, err = f.contract.ReviewBankMandate(f.ctx, "mandate-eft", "APPROVE", strings.Repeat("d", 64))
	requireNoError(t, err)
	_, err = f.contract.AdjustBankAccountBalance(f.ctx, "drain", "account-customer", "DEBIT", 4_950_000, strings.Repeat("9", 64))
	requireNoError(t, err)

	f.insurer()
	scheduled, err := f.contract.SchedulePremiumCollections(f.ctx, "2026-09-05")
	requireNoError(t, err)
	if len(scheduled) != 0 {
		t.Fatalf("nothing is due before the start date: %+v", scheduled)
	}
	f.on("2026-09-07")
	f.insurer()
	scheduled, err = f.contract.SchedulePremiumCollections(f.ctx, "2026-09-07")
	requireNoError(t, err)
	if len(scheduled) != 1 {
		t.Fatalf("expected the first installment, got %+v", scheduled)
	}
	first := scheduled[0].ID
	collect := func(id, end, suffix string) *PremiumCollection {
		f.bank()
		collection, err := f.contract.ProcessPremiumCollection(f.ctx, id, "payment-eft-"+suffix, "transfer-eft-"+suffix, "account-insurer", end, strings.Repeat(suffix, 64))
		requireNoError(t, err)
		return collection
	}
	if collection := collect(first, "2026-10-06", "1"); collection.Status != "BOUNCED" {
		t.Fatalf("expected a bounce, got %+v", collection)
	}
	if policy := f.policy("policy-eft"); policy.Status != "PENDING_PAYMENT" || policy.CoverStartDate != "" {
		t.Fatalf("a bounced first premium gives no cover: %+v", policy)
	}
	f.bank()
	// BDT 2,000 leaves BDT 750 after this debit, so the next one bounces too.
	_, err = f.contract.AdjustBankAccountBalance(f.ctx, "deposit", "account-customer", "CREDIT", 150_000, strings.Repeat("8", 64))
	requireNoError(t, err)
	f.on("2026-09-09")
	f.insurer()
	_, err = f.contract.RetryPremiumCollection(f.ctx, first)
	requireNoError(t, err)
	if collection := collect(first, "2026-10-06", "2"); collection.Status != "COMPLETED" {
		t.Fatalf("expected the retry to settle, got %+v", collection)
	}
	if policy := f.policy("policy-eft"); policy.Status != "ACTIVE" || policy.CoverStartDate != "2026-09-09" || policy.NextPremiumDueDate != "2026-10-07" {
		t.Fatalf("cover starts when the retried debit settles: %+v", policy)
	}

	// The next debit bounces and the customer does not pay within grace.
	f.on("2026-10-07")
	f.insurer()
	scheduled, err = f.contract.SchedulePremiumCollections(f.ctx, "2026-10-07")
	requireNoError(t, err)
	if len(scheduled) != 1 {
		t.Fatalf("expected the second installment, got %+v", scheduled)
	}
	second := scheduled[0].ID
	if collection := collect(second, "2026-11-05", "3"); collection.Status != "BOUNCED" {
		t.Fatalf("expected a bounce, got %+v", collection)
	}
	f.on("2026-10-23")
	f.insurer()
	_, err = f.contract.RetryPremiumCollection(f.ctx, second)
	requireError(t, err, "ended on 2026-10-22")
	policy, err := f.contract.ReinstatePolicy(f.ctx, "policy-eft", strings.Repeat("e", 64))
	requireNoError(t, err)
	if policy.Status != "LAPSED" || policy.ReinstatedDate != "2026-10-23" {
		t.Fatalf("an overdue ACTIVE policy is reinstated as lapsed: %+v", policy)
	}
	stale, err := f.contract.ReadPremiumCollection(f.ctx, second)
	requireNoError(t, err)
	if stale.Status != "SUPERSEDED" {
		t.Fatalf("the missed installment's collection is superseded: %+v", stale)
	}
	scheduled, err = f.contract.SchedulePremiumCollections(f.ctx, "2026-10-23")
	requireNoError(t, err)
	if len(scheduled) != 1 || scheduled[0].DueDate != "2026-10-23" {
		t.Fatalf("the reinstatement premium is collected by the mandate: %+v", scheduled)
	}
	f.bank()
	_, err = f.contract.AdjustBankAccountBalance(f.ctx, "deposit-2", "account-customer", "CREDIT", 200_000, strings.Repeat("7", 64))
	requireNoError(t, err)
	if collection := collect(scheduled[0].ID, "2026-11-21", "4"); collection.Status != "COMPLETED" {
		t.Fatalf("expected the reinstatement debit to settle, got %+v", collection)
	}
	if policy := f.policy("policy-eft"); policy.Status != "ACTIVE" || policy.PaidThroughDate != "2026-11-21" {
		t.Fatalf("unexpected reinstated policy: %+v", policy)
	}
}

func TestFirstPremiumRetryStopsWhenTheOfferExpires(t *testing.T) {
	f := newCoverFixture(t, 0)
	_, err := f.acquire("policy-expiring", "2026-09-05", "2027-09-04")
	requireNoError(t, err)
	f.holder()
	_, err = f.contract.RequestBankMandate(f.ctx, "mandate-expiring", "policy-expiring", "account-customer", "2027-09-04")
	requireNoError(t, err)
	f.bank()
	_, err = f.contract.ReviewBankMandate(f.ctx, "mandate-expiring", "APPROVE", strings.Repeat("d", 64))
	requireNoError(t, err)
	_, err = f.contract.AdjustBankAccountBalance(f.ctx, "drain", "account-customer", "DEBIT", 5_000_000, strings.Repeat("9", 64))
	requireNoError(t, err)
	f.insurer()
	scheduled, err := f.contract.SchedulePremiumCollections(f.ctx, "2026-09-05")
	requireNoError(t, err)
	f.bank()
	_, err = f.contract.ProcessPremiumCollection(f.ctx, scheduled[0].ID, "payment-x", "transfer-x", "account-insurer", "2026-10-04", strings.Repeat("1", 64))
	requireNoError(t, err)
	f.on("2026-09-21")
	f.insurer()
	_, err = f.contract.RetryPremiumCollection(f.ctx, scheduled[0].ID)
	requireError(t, err, "had to be paid by 2026-09-20")
}

func TestCancellingAPolicyEndsItsMandates(t *testing.T) {
	f := newCoverFixture(t, 0)
	_, err := f.acquire("policy-cancel", "2026-09-05", "2027-09-04")
	requireNoError(t, err)
	f.holder()
	_, err = f.contract.RequestBankMandate(f.ctx, "mandate-cancel", "policy-cancel", "account-customer", "2027-09-04")
	requireNoError(t, err)
	_, err = f.contract.RequestBankMandate(f.ctx, "mandate-cancel-2", "policy-cancel", "account-customer", "2027-09-04")
	requireError(t, err, "already has a pending EFT mandate mandate-cancel")
	_, err = f.contract.CancelPolicy(f.ctx, "policy-cancel", strings.Repeat("e", 64))
	requireNoError(t, err)
	mandate, err := f.contract.ReadBankMandate(f.ctx, "mandate-cancel")
	requireNoError(t, err)
	if mandate.Status != "CANCELLED" {
		t.Fatalf("a cancelled policy's mandate stays usable: %+v", mandate)
	}
}

func TestLapseSupersedesQueuedCollections(t *testing.T) {
	f := newCoverFixture(t, 0)
	_, err := f.acquire("policy-queue", "2026-09-05", "2027-09-04")
	requireNoError(t, err)
	requireNoError(t, f.pay("policy-queue", "2026-09-05", "2026-10-04"))
	f.holder()
	_, err = f.contract.RequestBankMandate(f.ctx, "mandate-queue", "policy-queue", "account-customer", "2027-09-04")
	requireNoError(t, err)
	f.bank()
	_, err = f.contract.ReviewBankMandate(f.ctx, "mandate-queue", "APPROVE", strings.Repeat("d", 64))
	requireNoError(t, err)
	f.on("2026-10-05")
	f.insurer()
	scheduled, err := f.contract.SchedulePremiumCollections(f.ctx, "2026-10-05")
	requireNoError(t, err)
	if len(scheduled) != 1 {
		t.Fatalf("expected one due collection, got %+v", scheduled)
	}
	f.on("2026-10-21")
	f.insurer()
	_, err = f.contract.AdvancePolicyLifecycle(f.ctx, "policy-queue", "2026-10-21")
	requireNoError(t, err)
	collection, err := f.contract.ReadPremiumCollection(f.ctx, scheduled[0].ID)
	requireNoError(t, err)
	if collection.Status != "SUPERSEDED" {
		t.Fatalf("a lapsed policy's queued collection stays due: %+v", collection)
	}
	again, err := f.contract.SchedulePremiumCollections(f.ctx, "2026-10-21")
	requireNoError(t, err)
	if len(again) != 0 {
		t.Fatalf("a lapsed policy gets no new collections: %+v", again)
	}
}

func TestCancelledPolicyStillCoversEarlierTreatment(t *testing.T) {
	f := newCoverFixture(t, 0)
	_, err := f.acquire("policy-ended", "2026-09-05", "2027-09-04")
	requireNoError(t, err)
	requireNoError(t, f.pay("policy-ended", "2026-09-05", "2026-10-04"))
	f.on("2026-09-15")
	f.holder()
	policy, err := f.contract.CancelPolicy(f.ctx, "policy-ended", strings.Repeat("e", 64))
	requireNoError(t, err)
	if policy.CancelledDate != "2026-09-15" {
		t.Fatalf("expected the cancellation date, got %+v", policy)
	}
	f.on("2026-09-20")
	_, err = f.quote("policy-ended", "2026-09-10", "2026-09-12")
	requireNoError(t, err)
	_, err = f.quote("policy-ended", "2026-09-15", "2026-09-15")
	requireError(t, err, "cancelled on 2026-09-15")
	_, err = f.quote("policy-ended", "2026-09-14", "2026-09-16")
	requireError(t, err, "cancelled on 2026-09-15")
}
