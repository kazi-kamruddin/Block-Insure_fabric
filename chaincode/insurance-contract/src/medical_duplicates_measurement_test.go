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
	switch group {
	case 1:
		gap, secondStay = rng.IntN(4), firstStay
		change := int64(1 + rng.IntN(10))
		if rng.IntN(2) == 0 {
			change = -change
		}
		secondBill = firstBill * (100 + change) / 100
	case 2:
		gap, secondID = rng.IntN(4), "first"
	case 3:
		gap, secondStay, secondBill, subject = 0, firstStay, firstBill, "patient-b"
	}
	episode := func(id string, day time.Time, stay int, bill int64) MedicalEpisode {
		return MedicalEpisode{ID: id, Service: "SURGERY", ServiceDate: day.Format(time.DateOnly),
			AdmissionDate: day.Format(time.DateOnly), DischargeDate: day.AddDate(0, 0, stay).Format(time.DateOnly), BillMinor: bill}
	}
	return duplicatePair{
		first:         episode("first", firstDay, firstStay, firstBill),
		second:        episode(secondID, firstDay.AddDate(0, 0, gap), secondStay, secondBill),
		secondSubject: subject, closeRepeat: group == 0 && gap <= 3,
	}
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
}
