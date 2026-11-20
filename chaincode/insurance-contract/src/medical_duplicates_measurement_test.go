package insurance

import (
	"encoding/json"
	"math/rand/v2"
	"strings"
	"testing"
	"time"
)

const duplicatePairsPerGroup = 1_000

type duplicatePair struct {
	first, second MedicalEpisode
	secondSubject string
	closeRepeat   bool
	dateShift     int
	amountChange  int
}

type duplicateReferralCount struct {
	Pairs    int `json:"pairs"`
	Referred int `json:"referred"`
}

func (c *duplicateReferralCount) observe(referred bool) {
	c.Pairs++
	if referred {
		c.Referred++
	}
}

type duplicateMeasurement struct {
	ToleranceBps      int64                  `json:"amountToleranceBps"`
	BenignRepeat      duplicateReferralCount `json:"benignRepeats"`
	BenignCloseRepeat duplicateReferralCount `json:"benignRepeatsWithinThreeDays"`
	EditedDuplicate   duplicateReferralCount `json:"editedDuplicates"`
	SameEpisode       duplicateReferralCount `json:"sameEpisodeCorrections"`
	DifferentPatient  duplicateReferralCount `json:"differentPatients"`
}

func makeDuplicatePair(rng *rand.Rand, group int) duplicatePair {
	firstDay := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, rng.IntN(60))
	firstStay := rng.IntN(4)
	firstBill := int64(10_000 + rng.IntN(90_001))
	gap, secondStay := 1+rng.IntN(90), rng.IntN(4)
	secondBill := firstBill * int64(70+rng.IntN(61)) / 100
	secondID, subject := "second", "patient-a"
	amountChange := 0
	switch group {
	case 1:
		gap, secondStay = rng.IntN(4), firstStay
		amountChange = 1 + rng.IntN(10)
		change := int64(amountChange)
		if rng.IntN(2) == 0 {
			change = -change
		}
		secondBill = firstBill * (100 + change) / 100
	case 2:
		gap, secondID = rng.IntN(4), "first"
	case 3:
		gap, secondStay, secondBill, subject = 0, firstStay, firstBill, "patient-b"
	case 4:
		gap = 1 + rng.IntN(14)
		if rng.IntN(5) == 0 {
			gap = 15 + rng.IntN(76)
		}
		gap += firstStay
	}
	episode := func(id string, day time.Time, stay int, bill int64) MedicalEpisode {
		return MedicalEpisode{ID: id, HospitalID: "hospital", Service: "SURGERY", ServiceDate: day.Format(time.DateOnly),
			AdmissionDate: day.Format(time.DateOnly), DischargeDate: day.AddDate(0, 0, stay).Format(time.DateOnly), BillMinor: bill}
	}
	return duplicatePair{
		first:         episode("first", firstDay, firstStay, firstBill),
		second:        episode(secondID, firstDay.AddDate(0, 0, gap), secondStay, secondBill),
		secondSubject: subject, closeRepeat: group == 0 && gap <= 3, dateShift: gap, amountChange: amountChange,
	}
}

type duplicatePolicyComparison struct {
	Current      duplicateReferralCount `json:"current"`
	OverlapFirst duplicateReferralCount `json:"overlapFirst"`
}

type duplicateFollowUp struct {
	Seed          uint64                    `json:"seed"`
	Causes        map[string]int            `json:"missCauses"`
	AmountBuckets [3]duplicateReferralCount `json:"byAmountChange"`
	DateBuckets   [4]duplicateReferralCount `json:"byDateShift"`
	Edited        duplicatePolicyComparison `json:"editedDuplicates"`
	Benign        duplicatePolicyComparison `json:"benignRepeats"`
	CloseBenign   duplicatePolicyComparison `json:"benignRepeatsWithinThreeDays"`
	Readmissions  duplicatePolicyComparison `json:"nonoverlappingReadmissions"`
}

func compareDuplicatePolicies(t *testing.T, seed uint64) duplicateFollowUp {
	t.Helper()
	rng := rand.New(rand.NewPCG(seed, 3))
	report := duplicateFollowUp{Seed: seed, Causes: map[string]int{
		"dateOutsideWindow": 0, "noStayOverlap": 0, "amountOutsideTolerance": 0, "multiple": 0,
	}}
	key := []byte(strings.Repeat("k", 32))
	for _, group := range []int{0, 1, 4} {
		if group == 4 {
			rng = rand.New(rand.NewPCG(seed, 4))
		}
		for pairNumber := range duplicatePairsPerGroup {
			pair := makeDuplicatePair(rng, group)
			_, ctx := medicalTestContext()
			_, err := indexMedicalDuplicate(ctx, key, "patient-a", &pair.first)
			requireNoError(t, err)
			current, err := indexMedicalDuplicate(ctx, key, pair.secondSubject, &pair.second)
			requireNoError(t, err)
			first, second := pair.first, pair.second
			overlap := first.AdmissionDate <= second.DischargeDate && second.AdmissionDate <= first.DischargeDate
			variant := overlap && first.HospitalID == second.HospitalID && first.Service == second.Service &&
				pair.secondSubject == "patient-a" && first.ID != second.ID
			comparison := &report.Benign
			switch group {
			case 0:
				if pair.closeRepeat {
					report.CloseBenign.Current.observe(current)
					report.CloseBenign.OverlapFirst.observe(variant)
				}
			case 1:
				comparison = &report.Edited
				amountBucket := 0
				if pair.amountChange >= 6 {
					amountBucket = 2
				} else if pair.amountChange >= 4 {
					amountBucket = 1
				}
				report.AmountBuckets[amountBucket].observe(current)
				report.DateBuckets[pair.dateShift].observe(current)
				if !current {
					causes := make([]string, 0, 3)
					if pair.dateShift > 3 {
						causes = append(causes, "dateOutsideWindow")
					}
					if !overlap {
						causes = append(causes, "noStayOverlap")
					}
					amount := max(first.BillMinor, second.BillMinor)
					if amount-min(first.BillMinor, second.BillMinor) > medicalShare(amount, medicalDuplicateAmountBps) {
						causes = append(causes, "amountOutsideTolerance")
					}
					switch len(causes) {
					case 0:
						t.Fatalf("seed=%d pair=%d: unclassified missed referral", seed, pairNumber)
					case 1:
						report.Causes[causes[0]]++
					default:
						report.Causes["multiple"]++
					}
				}
			case 4:
				comparison = &report.Readmissions
				if overlap {
					t.Fatalf("seed=%d pair=%d: authored readmission overlaps the prior stay", seed, pairNumber)
				}
			}
			comparison.Current.observe(current)
			comparison.OverlapFirst.observe(variant)
		}
	}
	return report
}

func measureDuplicateReferrals(t *testing.T, seed uint64, amountBps int64) duplicateMeasurement {
	t.Helper()
	rng := rand.New(rand.NewPCG(seed, 3))
	measurement := duplicateMeasurement{ToleranceBps: amountBps}
	counts := []*duplicateReferralCount{&measurement.BenignRepeat, &measurement.EditedDuplicate,
		&measurement.SameEpisode, &measurement.DifferentPatient}
	key := []byte(strings.Repeat("k", 32))
	for group, count := range counts {
		for pairNumber := range duplicatePairsPerGroup {
			pair := makeDuplicatePair(rng, group)
			_, ctx := medicalTestContext()
			screen := func(subject string, episode *MedicalEpisode) (bool, error) {
				if amountBps == medicalDuplicateAmountBps {
					return indexMedicalDuplicate(ctx, key, subject, episode)
				}
				return indexMedicalDuplicateWithAmountTolerance(ctx, key, subject, episode, amountBps)
			}
			first, err := screen("patient-a", &pair.first)
			requireNoError(t, err)
			if first {
				t.Fatalf("seed=%d group=%d pair=%d: an empty index referred the first episode", seed, group, pairNumber)
			}
			referred, err := screen(pair.secondSubject, &pair.second)
			requireNoError(t, err)
			if referred && (group == 2 || group == 3) {
				t.Fatalf("seed=%d group=%d pair=%d: same-episode correction or different patient was referred in a two-episode index", seed, group, pairNumber)
			}
			count.observe(referred)
			if pair.closeRepeat {
				measurement.BenignCloseRepeat.observe(referred)
			}
		}
	}
	return measurement
}

func TestDevLiteDuplicateScreenMeasurement(t *testing.T) {
	const tuneSeed, reportSeed uint64 = 190_031, 190_032
	var selected duplicateMeasurement
	var tuning []duplicateMeasurement
	for _, tolerance := range []int64{100, 250, 500, 750, 1_000} {
		candidate := measureDuplicateReferrals(t, tuneSeed, tolerance)
		tuning = append(tuning, candidate)
		// At most 2% of the authored benign repeats may be referred on the tuning seed.
		if candidate.BenignRepeat.Referred*100 <= 2*candidate.BenignRepeat.Pairs &&
			(selected.ToleranceBps == 0 || candidate.EditedDuplicate.Referred > selected.EditedDuplicate.Referred) {
			selected = candidate
		}
	}
	if selected.ToleranceBps == 0 {
		t.Fatal("no candidate fits the synthetic tuning referral budget")
	}
	report := struct {
		TuningSeed uint64                 `json:"tuningSeed"`
		ReportSeed uint64                 `json:"reportSeed"`
		Tuning     []duplicateMeasurement `json:"tuning"`
		Current    duplicateMeasurement   `json:"current"`
		Candidate  duplicateMeasurement   `json:"candidate"`
	}{tuneSeed, reportSeed, tuning, measureDuplicateReferrals(t, reportSeed, medicalDuplicateAmountBps),
		measureDuplicateReferrals(t, reportSeed, selected.ToleranceBps)}
	data, err := json.Marshal(report)
	requireNoError(t, err)
	t.Logf("duplicate-measurement %s", data)
	diagnostics := compareDuplicatePolicies(t, reportSeed)
	if diagnostics.Edited.Current != report.Current.EditedDuplicate || diagnostics.Benign.Current != report.Current.BenignRepeat {
		t.Fatal("follow-up did not use the original held-out pairs")
	}
	detail, err := json.Marshal(diagnostics)
	requireNoError(t, err)
	t.Logf("duplicate-follow-up %s", detail)
}
