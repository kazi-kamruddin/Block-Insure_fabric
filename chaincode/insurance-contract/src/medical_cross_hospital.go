package insurance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type crossHospitalEpisode struct {
	HospitalID    string
	AdmissionDate string
	DischargeDate string
}

func (c *Contract) indexCrossHospitalOverlap(ctx contractapi.TransactionContextInterface, secret []byte, patient string, episode *MedicalEpisode) (bool, error) {
	bucket := "medical-cross-hospital-" + medicalPatientToken(secret, "fabric-medical-cross-hospital-v1", patient, episode.Service)
	raw, err := ctx.GetStub().GetPrivateData(oracleProofCollection, bucket)
	if err != nil {
		return false, err
	}
	entries := map[string]crossHospitalEpisode{}
	if len(raw) == 0 {
		claims, err := listState[Claim](ctx, "claim")
		if err != nil {
			return false, err
		}
		for _, claim := range claims {
			if claim.ClaimantID != patient || claim.EpisodeID == "" || claim.EpisodeID == episode.ID {
				continue
			}
			prior, err := readMedicalEpisode(ctx, claim.EpisodeID, claim.EpisodeRevision)
			if err != nil {
				return false, err
			}
			if prior.Service == episode.Service {
				entries[prior.ID] = crossHospitalEpisode{prior.HospitalID, prior.AdmissionDate, prior.DischargeDate}
			}
		}
	} else if err := json.Unmarshal(raw, &entries); err != nil {
		return false, err
	}
	matched := false
	for _, prior := range entries {
		if prior.HospitalID != episode.HospitalID && prior.AdmissionDate <= episode.DischargeDate && episode.AdmissionDate <= prior.DischargeDate {
			matched = true
			break
		}
	}
	entries[episode.ID] = crossHospitalEpisode{episode.HospitalID, episode.AdmissionDate, episode.DischargeDate}
	return matched, writeMedicalPrivate(ctx, bucket, entries)
}

func (c *Contract) ExplainMedicalDuplicate(ctx contractapi.TransactionContextInterface, claimID string) (*Claim, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "policyholder"); err != nil {
		return nil, err
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	if subject != claim.ClaimantID || claim.MedicalDuplicateReason != "CROSS_HOSPITAL_OVERLAP" ||
		(claim.Status != "SUBMITTED" && claim.Status != "ORACLE_FAILED" && claim.Status != "MEDICAL_REVIEW_REQUIRED") {
		return nil, fmt.Errorf("claimant and an open cross-hospital referral are required")
	}
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return nil, err
	}
	explanation := transient["medicalDuplicateExplanation"]
	if len(explanation) > 1000 || !utf8.Valid(explanation) || strings.TrimSpace(string(explanation)) == "" {
		return nil, fmt.Errorf("provide a private explanation of up to 1000 UTF-8 bytes")
	}
	hash := sha256.Sum256(explanation)
	digest := hex.EncodeToString(hash[:])
	if claim.MedicalDuplicateExplanationHash == digest {
		return claim, nil
	}
	if claim.MedicalDuplicateExplanationHash != "" {
		return nil, fmt.Errorf("a duplicate explanation is already recorded")
	}
	key, err := privateStateKey(ctx, "medicalDuplicateExplanation", medicalRevisionKey(claim.ID, claim.Version))
	if err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutPrivateData(oracleProofCollection, key, explanation); err != nil {
		return nil, err
	}
	claim.MedicalDuplicateExplanationHash = digest
	return claim, overwriteAsset(ctx, "claim", claim.ID, claim)
}
