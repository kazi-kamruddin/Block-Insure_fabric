package insurance

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type medicalDuplicateEntry struct {
	EpisodeID     string
	ServiceDate   string
	AdmissionDate string
	DischargeDate string
	BillMinor     int64
}

const medicalDuplicateAmountBps int64 = 500

func (c *Contract) screenMedicalDuplicate(ctx contractapi.TransactionContextInterface, claim *Claim, episode *MedicalEpisode) error {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil
	}
	key, err := ctx.GetStub().GetPrivateData(oracleProofCollection, duplicateIndexSecret)
	if err != nil {
		return err
	}
	if len(key) != 32 {
		return fmt.Errorf("activate medical approvals before indexing claims")
	}
	matched, err := indexMedicalDuplicate(ctx, key, claim.ClaimantID, episode)
	if err != nil {
		return err
	}
	claim.MedicalDuplicateReview = claim.MedicalDuplicateReview || matched
	return nil
}

// Read exact private keys so simultaneous filings for the same beneficiary
// participate in MVCC even when there is no prior bucket. Never reject on similarity.
func indexMedicalDuplicate(ctx contractapi.TransactionContextInterface, key []byte, patient string, episode *MedicalEpisode) (bool, error) {
	return indexMedicalDuplicateWithAmountTolerance(ctx, key, patient, episode, medicalDuplicateAmountBps)
}

func indexMedicalDuplicateWithAmountTolerance(ctx contractapi.TransactionContextInterface, key []byte, patient string, episode *MedicalEpisode, amountBps int64) (bool, error) {
	date, err := validateDate("duplicate screening service date", episode.ServiceDate)
	if err != nil {
		return false, err
	}
	const maxPerDay = 64
	matched := false
	var own []medicalDuplicateEntry
	var ownKey string
	for offset := -3; offset <= 3; offset++ {
		mac := hmac.New(sha256.New, key)
		mac.Write([]byte(canonicalProtocolHash("fabric-medical-duplicate-v1", patient, episode.Service, date.AddDate(0, 0, offset).Format(time.DateOnly))))
		bucket := "medical-duplicate-v1-" + hex.EncodeToString(mac.Sum(nil))
		raw, err := ctx.GetStub().GetPrivateData(oracleProofCollection, bucket)
		if err != nil {
			return false, err
		}
		entries := []medicalDuplicateEntry{}
		if raw != nil {
			if err := json.Unmarshal(raw, &entries); err != nil {
				return false, err
			}
		}
		for _, other := range entries {
			if other.EpisodeID == episode.ID {
				continue
			}
			difference := max(other.BillMinor, episode.BillMinor) - min(other.BillMinor, episode.BillMinor)
			overlap := other.AdmissionDate <= episode.DischargeDate && episode.AdmissionDate <= other.DischargeDate
			if (overlap && difference <= medicalShare(max(other.BillMinor, episode.BillMinor), amountBps)) || (offset == 0 && difference == 0) {
				matched = true
			}
		}
		// A crowded bucket is explicitly referred so a bounded index never silently
		// clears a potentially ambiguous claim.
		if len(entries) >= maxPerDay {
			matched = true
		}
		if offset == 0 {
			ownKey, own = bucket, entries
		}
	}
	current := medicalDuplicateEntry{episode.ID, episode.ServiceDate, episode.AdmissionDate, episode.DischargeDate, episode.BillMinor}
	for i, previous := range own {
		if previous.EpisodeID == current.EpisodeID {
			own[i] = current
			return matched, writeMedicalPrivate(ctx, ownKey, own)
		}
	}
	if len(own) < maxPerDay {
		return matched, writeMedicalPrivate(ctx, ownKey, append(own, current))
	}
	return true, nil
}
