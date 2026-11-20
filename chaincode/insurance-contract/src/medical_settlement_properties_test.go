package insurance

import (
	"crypto/sha256"
	"fmt"
	"math/rand/v2"
	"testing"
)

func TestDevLiteSeededSettlementProperties(t *testing.T) {
	const seed, stream uint64 = 1_900_013, 72
	const sequences, steps = 2_000, 20
	rng := rand.New(rand.NewPCG(seed, stream))
	t.Logf("seed=%d stream=%d sequences=%d steps=%d", seed, stream, sequences, steps)
	actions := [4]int{}
	confirmed, bounced, refused := 0, 0, 0
	for sequence := range sequences {
		f := newMedicalSettlementFixture(t)
		wantFunds := int64(10_100)
		trace := make([]string, 0, steps)
		for step := range steps {
			action := rng.IntN(len(actions))
			actions[action]++
			id := fmt.Sprintf("action-%d", step)
			reference := fmt.Sprintf("%x", sha256.Sum256([]byte(id)))
			var err error
			switch action {
			case 0:
				trace = append(trace, "authorize")
				setIdentity(f.context, "insurer", "InsurerMSP", "insurerAdmin", nil)
				_, err = f.authorize()
			case 1:
				trace = append(trace, "confirm")
				setIdentity(f.context, "bank", "BankMSP", "bankOfficer", nil)
				var result *Settlement
				result, err = f.contract.ConfirmSettlement(f.context, "settlement", id, reference)
				if err == nil && result.Status == "CONFIRMED" {
					confirmed++
				}
				if err == nil && result.Status == "PAYMENT_FAILED" {
					bounced++
				}
			default:
				direction, sign := "CREDIT", int64(1)
				if action == 3 {
					direction, sign = "DEBIT", -1
				}
				account := "reserve"
				if rng.IntN(2) == 0 {
					account = "customer"
				}
				amount := int64(1 + rng.IntN(12_000))
				trace = append(trace, fmt.Sprintf("%s %s %d", direction, account, amount))
				setIdentity(f.context, "bank", "BankMSP", "bankOfficer", nil)
				_, err = f.contract.AdjustBankAccountBalance(f.context, id, account, direction, amount, reference)
				if err == nil {
					wantFunds += sign * amount
				}
			}
			if err != nil {
				refused++
			}
			if err := checkMedicalSettlementProperties(f, wantFunds); err != nil {
				t.Fatalf("seed=%d stream=%d sequence=%d step=%d trace=%v: %v", seed, stream, sequence, step, trace, err)
			}
		}
	}
	t.Logf("authorize=%d confirm=%d credit=%d debit=%d confirmed=%d bounced=%d refused=%d",
		actions[0], actions[1], actions[2], actions[3], confirmed, bounced, refused)
	if confirmed == 0 || bounced == 0 || refused == 0 {
		t.Fatal("generated actions did not exercise confirmation, bounce, and refusal")
	}
}

func checkMedicalSettlementProperties(f medicalSettlementFixture, wantFunds int64) error {
	setIdentity(f.context, "bank", "BankMSP", "bankOfficer", nil)
	source, err := f.contract.ReadBankAccountReference(f.context, "reserve")
	if err != nil {
		return err
	}
	destination, err := f.contract.ReadBankAccountReference(f.context, "customer")
	if err != nil {
		return err
	}
	if got := source.BalanceMinor + destination.BalanceMinor; got != wantFunds || source.BalanceMinor < 0 || destination.BalanceMinor < 0 {
		return fmt.Errorf("funds not conserved after external adjustments: total=%d want=%d", got, wantFunds)
	}

	claim, err := f.contract.ReadClaim(f.context, f.claim.ID)
	if err != nil {
		return err
	}
	cert, err := f.contract.verifyMedicalApproval(f.context, claim)
	if err != nil {
		return err
	}
	if cert.AmountMinor != claim.AmountMinor {
		return fmt.Errorf("certificate amount differs from current claim")
	}
	transfers, err := f.contract.ListBankTransfers(f.context)
	if err != nil {
		return err
	}
	payouts := 0
	for _, transfer := range transfers {
		if transfer.Method == "CLAIM_PAYOUT" && transfer.Status == "SETTLED" {
			payouts++
			if transfer.SettlementID != claim.MedicalSettlementID || transfer.AmountMinor != claim.AmountMinor {
				return fmt.Errorf("settled transfer does not match the current claim")
			}
		}
	}
	if payouts > 1 || (payouts == 1) != (claim.Status == "SETTLED") {
		return fmt.Errorf("payout count %d conflicts with claim status %s", payouts, claim.Status)
	}
	if claim.Status != "APPROVED" {
		settlement, err := f.contract.ReadSettlement(f.context, claim.MedicalSettlementID)
		if err != nil {
			return err
		}
		if cert.ClaimVersion != claim.Version || cert.Hash != settlement.ApprovalCertificateHash || cert.AmountMinor != settlement.AmountMinor {
			return fmt.Errorf("settlement certificate, version, or amount differs from the current claim")
		}
		if claim.Status == "SETTLED" {
			liability, err := f.contract.ReadLiability(f.context, "liability-claim-"+claim.ID)
			if err != nil {
				return err
			}
			if settlement.Status != "CONFIRMED" || liability.Status != "PAID" || liability.AmountMinor != cert.AmountMinor {
				return fmt.Errorf("settled claim lacks matching confirmation and paid liability")
			}
		}
	}
	return nil
}
