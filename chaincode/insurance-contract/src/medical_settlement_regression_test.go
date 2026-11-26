package insurance

import (
	"strings"
	"testing"
)

type medicalSettlementFixture struct {
	contract *Contract
	context  *testContext
	claim    *Claim
}

func newMedicalSettlementFixture(t *testing.T) medicalSettlementFixture {
	t.Helper()
	contract, ctx := medicalTestContext()
	ctx.stub.channelID = medicalDevLiteChannel
	digest := strings.Repeat("a", 64)
	episodeID := strings.Repeat("b", 64)
	ctx.stub.transient["duplicateIndexKey"] = []byte(strings.Repeat("k", 32))
	_, err := contract.ActivateMedicalApprovalCertificates(ctx)
	requireNoError(t, err)

	_, err = contract.CreatePartnerAgreement(ctx, "bank-partner", "BANK", "partner-bank", "Fixture Bank", "Dhaka", "Preferred",
		"Synthetic settlement", "2026-01-01", "2027-01-01")
	requireNoError(t, err)
	setIdentity(ctx, "bank", "BankMSP", "bankOfficer", nil)
	_, err = contract.openBankAccount(ctx, "reserve", "partner-bank", "insurer", "INSURER", "Reserve", "**** 1111", digest, 10_000)
	requireNoError(t, err)
	_, err = contract.openBankAccount(ctx, "customer", "partner-bank", "holder", "CUSTOMER", "Customer", "**** 2222", strings.Repeat("c", 64), 100)
	requireNoError(t, err)
	setIdentity(ctx, "insurer", "InsurerMSP", "insurerAdmin", nil)

	claim := &Claim{ID: "medical-payout", PolicyID: "paid-policy", ClaimantID: "holder", HospitalID: "hospital",
		EpisodeID: episodeID, EpisodeRevision: 1, MedicalAssociationKey: "verified", MedicalAssociationVersion: 1,
		IncidentDate: "2026-09-04", DescriptionHash: digest, AmountMinor: 4_000, Version: 1, Status: "ORACLE_PENDING",
		CurrentOracleRequestID: "current-oracle"}
	requireNoError(t, putState(ctx, "claim", claim.ID, claim))
	requireNoError(t, putState(ctx, "medicalEpisode", episodeID,
		&MedicalEpisodeHead{ID: episodeID, HospitalID: claim.HospitalID, Revision: 1, RevisionHash: digest}))
	requireNoError(t, putState(ctx, "medicalAssociationVersion", "verified", struct{ Version int }{1}))
	requireNoError(t, putState(ctx, "policy", claim.PolicyID, &Policy{
		ID: claim.PolicyID, PolicyholderID: claim.ClaimantID, BankIDs: []string{"partner-bank"}, PremiumMinor: 100,
	}))
	requireNoError(t, putState(ctx, "bankTransfer", "paid-transfer", &BankTransfer{ID: "paid-transfer", Status: "SETTLED", PaymentID: "premium"}))
	requireNoError(t, putState(ctx, "premiumPayment", "premium", &PremiumPayment{
		ID: "premium", PolicyID: claim.PolicyID, TransferID: "paid-transfer", AmountMinor: 100,
		PeriodStartDate: "2026-09-01", PeriodEndDate: "2026-09-30",
	}))
	request := &OracleRequest{ID: claim.CurrentOracleRequestID, ClaimID: claim.ID, ClaimVersion: claim.Version, Status: "PENDING"}
	requireNoError(t, putState(ctx, "oracleRequest", request.ID, request))
	now, err := ledgerTimestamp(ctx)
	requireNoError(t, err)
	requireNoError(t, contract.finalizeOracleRequest(ctx, request, claim, true, digest, "EXACT_CONSENSUS", now))
	if claim.Status != "APPROVED" {
		t.Fatalf("fixture Oracle approval reached %s", claim.Status)
	}
	return medicalSettlementFixture{contract: contract, context: ctx, claim: claim}
}

func (f medicalSettlementFixture) authorize() (*Settlement, error) {
	return f.contract.AuthorizeSettlement(f.context, "settlement", f.claim.ID, "reserve", "customer")
}

func (f medicalSettlementFixture) confirm(transfer string) (*Settlement, error) {
	setIdentity(f.context, "bank", "BankMSP", "bankOfficer", nil)
	return f.contract.ConfirmSettlement(f.context, "settlement", transfer, strings.Repeat("d", 64))
}

func TestDevLiteSettlementLedgerConsistency(t *testing.T) {
	t.Run("current amount and one payout", func(t *testing.T) {
		f := newMedicalSettlementFixture(t)
		authorized, err := f.authorize()
		requireNoError(t, err)
		paid, err := f.confirm("payout")
		requireNoError(t, err)
		_, err = f.confirm("another-payout")
		requireError(t, err, "must be AUTHORIZED or PAYMENT_FAILED")
		cert, err := f.contract.ReadMedicalApprovalCertificate(f.context, f.claim.ID, f.claim.Version)
		requireNoError(t, err)
		claim, err := f.contract.ReadClaim(f.context, f.claim.ID)
		requireNoError(t, err)
		liability, err := f.contract.ReadLiability(f.context, "liability-claim-"+f.claim.ID)
		requireNoError(t, err)
		source, err := f.contract.ReadBankAccountReference(f.context, "reserve")
		requireNoError(t, err)
		destination, err := f.contract.ReadBankAccountReference(f.context, "customer")
		requireNoError(t, err)
		if claim.Status != "SETTLED" || paid.Status != "CONFIRMED" || liability.Status != "PAID" ||
			cert.Hash != authorized.ApprovalCertificateHash || cert.Hash != paid.ApprovalCertificateHash ||
			cert.ClaimVersion != claim.Version || cert.AmountMinor != claim.AmountMinor || cert.AmountMinor != paid.AmountMinor ||
			source.BalanceMinor != 6_000 || destination.BalanceMinor != 4_100 {
			t.Fatal("certificate, settlement, liability, or balances did not agree after confirmation")
		}
	})

	t.Run("authorization requires current approval amount", func(t *testing.T) {
		f := newMedicalSettlementFixture(t)
		f.claim.AmountMinor++
		requireNoError(t, overwriteAsset(f.context, "claim", f.claim.ID, f.claim))
		_, err := f.authorize()
		requireError(t, err, "approval certificate")
	})

	t.Run("confirmation requires authorized amount", func(t *testing.T) {
		f := newMedicalSettlementFixture(t)
		authorized, err := f.authorize()
		requireNoError(t, err)
		authorized.AmountMinor++
		requireNoError(t, overwriteAsset(f.context, "settlement", authorized.ID, authorized))
		_, err = f.confirm("payout")
		requireError(t, err, "superseded medical claim version")
	})

	t.Run("confirmation requires current unchanged episode", func(t *testing.T) {
		f := newMedicalSettlementFixture(t)
		_, err := f.authorize()
		requireNoError(t, err)
		head, err := medicalEpisodeHead(f.context, f.claim.EpisodeID)
		requireNoError(t, err)
		head.Revision++
		requireNoError(t, overwriteAsset(f.context, "medicalEpisode", head.ID, head))
		_, err = f.confirm("payout")
		requireError(t, err, "newer revision")
	})

	t.Run("authorization requires approval for the selected version", func(t *testing.T) {
		f := newMedicalSettlementFixture(t)
		f.claim.Version++
		requireNoError(t, overwriteAsset(f.context, "claim", f.claim.ID, f.claim))
		_, err := f.authorize()
		requireError(t, err, "current medical approval certificate")
	})

	t.Run("authorization rejects inconsistent certificate fields", func(t *testing.T) {
		f := newMedicalSettlementFixture(t)
		cert, err := f.contract.ReadMedicalApprovalCertificate(f.context, f.claim.ID, f.claim.Version)
		requireNoError(t, err)
		cert.AmountMinor++
		requireNoError(t, overwriteAsset(f.context, "medicalApprovalCertificate", cert.ID, cert))
		_, err = f.authorize()
		requireError(t, err, "approval certificate")
	})
}

func TestDevLitePositiveOracleRetainsRequiredReview(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		reason string
		dupe   bool
	}{{name: "correction", reason: "CORRECTION"}, {name: "duplicate", dupe: true}} {
		t.Run(scenario.name, func(t *testing.T) {
			contract, ctx := medicalTestContext()
			ctx.stub.channelID = medicalDevLiteChannel
			claim := &Claim{ID: "fixture-claim", EpisodeID: strings.Repeat("a", 64), Version: 2, Status: "ORACLE_PENDING",
				MedicalRevisionKind: scenario.reason, MedicalDuplicateReview: scenario.dupe, CurrentOracleRequestID: "fixture-request"}
			request := &OracleRequest{ID: claim.CurrentOracleRequestID, ClaimID: claim.ID, ClaimVersion: claim.Version, Status: "PENDING"}
			requireNoError(t, putState(ctx, "claim", claim.ID, claim))
			requireNoError(t, putState(ctx, "oracleRequest", request.ID, request))
			now, err := ledgerTimestamp(ctx)
			requireNoError(t, err)
			requireNoError(t, contract.finalizeOracleRequest(ctx, request, claim, true, strings.Repeat("a", 64), "EXACT_CONSENSUS", now))
			updated, err := contract.ReadClaim(ctx, claim.ID)
			requireNoError(t, err)
			if updated.Status != "MEDICAL_REVIEW_REQUIRED" {
				t.Fatalf("mandatory panel review did not survive a positive Oracle result: %s", updated.Status)
			}
		})
	}
}
