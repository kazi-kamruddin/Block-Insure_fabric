package insurance

import (
	"strings"
	"testing"
)

func collectedPremiumFixture(t *testing.T) (*Contract, *testContext, *PremiumCollection) {
	t.Helper()
	c, ctx, policy := premiumAuditFixture(t)
	mandate := &BankMandate{ID: "mandate-coordinated", PolicyID: policy.ID, AccountReferenceID: "account-audit-customer", AmountMinor: 100, Status: "ACTIVE", NextDebitDate: "2026-01-01", ExpiryDate: "2026-12-31"}
	requireNoError(t, putState(ctx, "bankMandate", mandate.ID, mandate))
	collection := &PremiumCollection{ID: "collection-coordinated", PolicyID: policy.ID, MandateID: mandate.ID, AmountMinor: 100, DueDate: "2026-01-01", Status: "DUE"}
	requireNoError(t, putState(ctx, "premiumCollection", collection.ID, collection))
	_, err := c.ExecuteManualPremiumPayment(ctx, "transfer-coordinated", "payment-coordinated", policy.ID, "account-audit-customer", "account-audit-insurer", "2026-01-01", "2026-01-30", 100, strings.Repeat("c", 64), strings.Repeat("d", 64))
	requireNoError(t, err)
	return c, ctx, collection
}

func TestQueuedCollectionRecognizesSettledOTPWithoutAnotherDebit(t *testing.T) {
	c, ctx, collection := collectedPremiumFixture(t)
	result, err := c.ProcessPremiumCollection(ctx, collection.ID, "unused-payment", "unused-transfer", "account-audit-insurer", "2026-01-30", strings.Repeat("e", 64))
	requireNoError(t, err)
	if result.Status != "COMPLETED" || result.PaymentID != "payment-coordinated" || result.TransferID != "transfer-coordinated" || result.AttemptCount != 0 {
		t.Fatalf("collection did not retain the existing financial lineage: %+v", result)
	}
	if ctx.stub.eventName != "PremiumCollectionReconciled" {
		t.Fatal("recognizing an earlier payment must not publish a new financial transfer event")
	}
	customer, err := c.ReadBankAccountReference(ctx, "account-audit-customer")
	requireNoError(t, err)
	insurer, err := c.ReadBankAccountReference(ctx, "account-audit-insurer")
	requireNoError(t, err)
	if customer.BalanceMinor != 900 || insurer.BalanceMinor != 1100 {
		t.Fatalf("reconciliation moved money: customer=%d insurer=%d", customer.BalanceMinor, insurer.BalanceMinor)
	}
	_, err = c.ReadBankTransfer(ctx, "unused-transfer")
	requireError(t, err, "does not exist")
	_, err = c.ReadPremiumPayment(ctx, "unused-payment")
	requireError(t, err, "does not exist")
	_, err = c.ProcessPremiumCollection(ctx, collection.ID, "duplicate-payment", "duplicate-transfer", "account-audit-insurer", "2026-01-30", strings.Repeat("f", 64))
	requireError(t, err, "not due")
}

func TestQueuedCollectionReconciliationRequiresExactPeriodAndDestination(t *testing.T) {
	for _, scenario := range []struct{ name, destination, end string }{
		{"different-period", "account-audit-insurer", "2026-01-29"},
		{"different-destination", "another-insurer-account", "2026-01-30"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			c, ctx, collection := collectedPremiumFixture(t)
			_, err := c.ProcessPremiumCollection(ctx, collection.ID, "unused-payment", "unused-transfer", scenario.destination, scenario.end, strings.Repeat("e", 64))
			requireError(t, err, "next due date")
			stored, err := c.ReadPremiumCollection(ctx, collection.ID)
			requireNoError(t, err)
			if stored.Status != "DUE" {
				t.Fatal("a different installment was treated as paid")
			}
		})
	}
}

func TestQueuedCollectionReconciliationRejectsInconsistentAndAmbiguousPayments(t *testing.T) {
	for _, ambiguous := range []bool{false, true} {
		c, ctx, collection := collectedPremiumFixture(t)
		if ambiguous {
			payment, err := c.ReadPremiumPayment(ctx, "payment-coordinated")
			requireNoError(t, err)
			payment.ID = "conflicting-historical-payment"
			transfer, err := c.ReadBankTransfer(ctx, payment.TransferID)
			requireNoError(t, err)
			transfer.ID = "conflicting-historical-transfer"
			transfer.PaymentID = payment.ID
			payment.TransferID = transfer.ID
			requireNoError(t, putState(ctx, "bankTransfer", transfer.ID, transfer))
			requireNoError(t, putState(ctx, "premiumPayment", payment.ID, payment))
		} else {
			transfer, err := c.ReadBankTransfer(ctx, "transfer-coordinated")
			requireNoError(t, err)
			transfer.Status = "BOUNCED"
			requireNoError(t, overwriteAsset(ctx, "bankTransfer", transfer.ID, transfer))
		}
		_, err := c.ProcessPremiumCollection(ctx, collection.ID, "unused-payment", "unused-transfer", "account-audit-insurer", "2026-01-30", strings.Repeat("e", 64))
		if ambiguous {
			requireError(t, err, "ambiguous")
		} else {
			requireError(t, err, "settled transfer linkage")
		}
	}
}

func TestQueuedCollectionReconciliationKeepsBankAuthorization(t *testing.T) {
	c, ctx, collection := collectedPremiumFixture(t)
	setIdentity(ctx, "admin", "InsurerMSP", "insurerAdmin", nil)
	_, err := c.ProcessPremiumCollection(ctx, collection.ID, "unused-payment", "unused-transfer", "account-audit-insurer", "2026-01-30", strings.Repeat("e", 64))
	requireError(t, err, "access denied")
}
