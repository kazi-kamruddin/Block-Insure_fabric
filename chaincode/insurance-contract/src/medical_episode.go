package insurance

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const medicalCandidateChannel = "insurance-medical-reimbursement"

func isMedicalCandidate(ctx contractapi.TransactionContextInterface) bool {
	channel := ctx.GetStub().GetChannelID()
	return channel == medicalCandidateChannel || channel == medicalDevLiteChannel
}

// Only the reference commitment, revision number and digest are public.
type MedicalEpisodeHead struct {
	DigestVersion int    `json:"digestVersion,omitempty" metadata:",optional"`
	ID            string `json:"id"`
	HospitalID    string `json:"hospitalId"`
	Revision      int    `json:"revision"`
	RevisionHash  string `json:"revisionHash"`
}

type MedicalEpisode struct {
	DigestVersion        int    `json:"digestVersion,omitempty" metadata:",optional"`
	RevisionNonce        string `json:"revisionNonce,omitempty" metadata:",optional"`
	ID                   string `json:"id"`
	HospitalID           string `json:"hospitalId"`
	Revision             int    `json:"revision"`
	PatientReferenceHash string `json:"patientReferenceHash"`
	Service              string `json:"service"`
	ServiceDate          string `json:"serviceDate"`
	AdmissionDate        string `json:"admissionDate"`
	DischargeDate        string `json:"dischargeDate"`
	BillMinor            int64  `json:"billMinor"`
	InvoiceDate          string `json:"invoiceDate"`
	DiagnosisCode        string `json:"diagnosisCode"`
}

type medicalEpisodeInput struct {
	InvoiceDate          string `json:"invoiceDate"`
	DiagnosisCode        string `json:"diagnosisCode"`
	PatientReferenceHash string `json:"patientReferenceHash"`
	Service              string `json:"service"`
	ServiceDate          string `json:"serviceDate"`
	AdmissionDate        string `json:"admissionDate"`
	DischargeDate        string `json:"dischargeDate"`
	BillMinor            int64  `json:"billMinor"`
}

func medicalRevisionKey(id string, revision int) string {
	return canonicalProtocolHash("fabric-medical-episode-revision-v1", id, strconv.Itoa(revision))
}

func readMedicalEpisode(ctx contractapi.TransactionContextInterface, id string, revision int) (*MedicalEpisode, error) {
	return getPrivateState[MedicalEpisode](ctx, "medicalEpisodeRevision", medicalRevisionKey(id, revision))
}

// SaveMedicalEpisode records only factual intake. A compare-and-set revision
// protects corrections from concurrent writes; an identical retry is idempotent.
func (c *Contract) SaveMedicalEpisode(ctx contractapi.TransactionContextInterface, episodeReferenceHash string, expectedRevision int) (*MedicalEpisodeHead, error) {
	if !isMedicalCandidate(ctx) {
		return nil, fmt.Errorf("medical intake requires the isolated medical channel")
	}
	if _, err := requireIdentity(ctx, "HospitalMSP", "hospitalOfficer"); err != nil {
		return nil, err
	}
	hospital, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := c.requireActivePartner(ctx, "HOSPITAL", hospital); err != nil {
		return nil, err
	}
	if err := validateHash("episodeReferenceHash", episodeReferenceHash); err != nil {
		return nil, err
	}
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return nil, err
	}
	var input medicalEpisodeInput
	decoder := json.NewDecoder(bytes.NewReader(transient["medicalEpisode"]))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return nil, fmt.Errorf("invalid medical episode intake: %w", err)
	}
	if err := validateHash("patientReferenceHash", input.PatientReferenceHash); err != nil {
		return nil, err
	}
	if !validMedicalService(input.Service) || input.BillMinor <= 0 || input.BillMinor > 9007199254740991 {
		return nil, fmt.Errorf("invalid service category or billed amount")
	}
	admission, err := validateDate("admissionDate", input.AdmissionDate)
	if err != nil {
		return nil, err
	}
	discharge, err := validateDate("dischargeDate", input.DischargeDate)
	if err != nil || discharge.Before(admission) {
		return nil, fmt.Errorf("invalid discharge date")
	}
	if input.ServiceDate != "" {
		serviceDate, err := validateDate("serviceDate", input.ServiceDate)
		if err != nil || serviceDate.Before(admission) || serviceDate.After(discharge) {
			return nil, fmt.Errorf("documented service date must fall within the episode")
		}
	}
	if len(input.DiagnosisCode) > 40 {
		return nil, fmt.Errorf("invalid documented diagnosis code")
	}
	if input.InvoiceDate != "" {
		date, err := validateDate("invoice date", input.InvoiceDate)
		if err != nil || date.Before(discharge) {
			return nil, fmt.Errorf("invoice date cannot precede discharge")
		}
	}
	// A hospital documents care that has happened, so no episode date may be
	// later than the ledger's Asia/Dhaka business date.
	for _, documented := range []struct{ field, value string }{
		{"admission date", input.AdmissionDate}, {"discharge date", input.DischargeDate},
		{"service date", input.ServiceDate}, {"invoice date", input.InvoiceDate},
	} {
		if documented.value == "" {
			continue
		}
		if err := requireNotAfterLedgerDate(ctx, documented.field, documented.value); err != nil {
			return nil, err
		}
	}
	id := canonicalProtocolHash("fabric-medical-episode-v1", hospital, episodeReferenceHash)
	invoiceNumber := string(transient["medicalHospitalInvoiceNumber"])
	key, err := stateKey(ctx, "medicalEpisode", id)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	head := &MedicalEpisodeHead{ID: id, HospitalID: hospital}
	if raw != nil {
		if err := json.Unmarshal(raw, head); err != nil {
			return nil, err
		}
	}
	revision := &MedicalEpisode{ID: id, HospitalID: hospital,
		PatientReferenceHash: input.PatientReferenceHash, Service: input.Service, ServiceDate: input.ServiceDate,
		AdmissionDate: input.AdmissionDate, DischargeDate: input.DischargeDate, BillMinor: input.BillMinor, InvoiceDate: input.InvoiceDate, DiagnosisCode: input.DiagnosisCode}
	var previous *MedicalEpisode
	if head.Revision > 0 {
		previous, err = readMedicalEpisode(ctx, id, head.Revision)
		if err != nil {
			return nil, err
		}
		if medicalIntakeDigest(previous, "") == medicalIntakeDigest(revision, "") {
			return head, rememberMedicalInvoiceNumber(ctx, id, episodeReferenceHash, invoiceNumber)
		}
	}
	if expectedRevision != head.Revision {
		return nil, fmt.Errorf("episode revision changed; reload before saving a correction")
	}
	if usesMedicalApprovalCertificates(ctx) && input.InvoiceDate == "" {
		return nil, fmt.Errorf("invoice date is required for a new finalized episode revision")
	}
	roster, err := c.activeAuditorRoster(ctx)
	if err != nil {
		return nil, err
	}
	if roster != nil {
		nonce := transient["revisionNonce"]
		if len(nonce) != 32 || bytes.Equal(nonce, make([]byte, 32)) {
			return nil, fmt.Errorf("a fresh 32-byte transient revision nonce is required")
		}
		revision.DigestVersion, revision.RevisionNonce = 2, hex.EncodeToString(nonce)
		if previous != nil && previous.RevisionNonce == revision.RevisionNonce {
			return nil, fmt.Errorf("revision nonce must differ from the previous revision")
		}
	}
	if previous != nil {
		if previous.InvoiceDate != "" {
			oldIndex, err := ctx.GetStub().CreateCompositeKey("hospitalEpisodeByDate", []string{hospital, previous.InvoiceDate, id})
			if err != nil {
				return nil, err
			}
			if err := ctx.GetStub().DelState(oldIndex); err != nil {
				return nil, err
			}
		}
	}
	head.Revision++
	head.RevisionHash, head.DigestVersion = medicalIntakeDigest(revision, revision.RevisionNonce), revision.DigestVersion
	revision.Revision = head.Revision
	if err := putPrivateState(ctx, "medicalEpisodeRevision", medicalRevisionKey(id, head.Revision), revision); err != nil {
		return nil, err
	}
	if err := rememberMedicalInvoiceNumber(ctx, id, episodeReferenceHash, invoiceNumber); err != nil {
		return nil, err
	}
	if err := overwriteState(ctx, key, head); err != nil {
		return nil, err
	}
	if input.InvoiceDate != "" {
		index, err := ctx.GetStub().CreateCompositeKey("hospitalEpisodeByDate", []string{hospital, input.InvoiceDate, id})
		if err != nil {
			return nil, err
		}
		if err := ctx.GetStub().PutState(index, []byte("1")); err != nil {
			return nil, err
		}
		marker, err := stateKey(ctx, "hospitalEpisodeIndexed", id)
		if err != nil {
			return nil, err
		}
		if err := ctx.GetStub().PutState(marker, []byte("1")); err != nil {
			return nil, err
		}
	}
	return head, emit(ctx, "MedicalEpisodeSaved", head)
}

func medicalIntakeDigest(episode *MedicalEpisode, nonce string) string {
	fields := []string{episode.ID, episode.PatientReferenceHash, episode.Service, episode.ServiceDate, episode.AdmissionDate,
		episode.DischargeDate, strconv.FormatInt(episode.BillMinor, 10), episode.InvoiceDate, episode.DiagnosisCode}
	if nonce != "" {
		return canonicalProtocolHash("fabric-medical-intake-v2", append([]string{nonce}, fields...)...)
	}
	return canonicalProtocolHash("fabric-medical-intake-v1", fields...)
}

type MedicalRevisionDossierProof struct {
	MedicalEpisode
	PublicHash string `json:"publicHash"`
}

func (c *Contract) ReadMedicalRevisionDossierProof(ctx contractapi.TransactionContextInterface, claimID string) (*MedicalRevisionDossierProof, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return nil, err
	}
	episode, err := readMedicalEpisode(ctx, claim.EpisodeID, claim.EpisodeRevision)
	if err != nil {
		return nil, err
	}
	return &MedicalRevisionDossierProof{MedicalEpisode: *episode, PublicHash: medicalIntakeDigest(episode, episode.RevisionNonce)}, nil
}
