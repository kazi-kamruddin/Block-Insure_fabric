package insurance

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type MedicalOracleV2Source struct {
	DigestVersion     int    `json:"digestVersion,omitempty" metadata:",optional"`
	InvoiceID         string `json:"invoiceId"`
	InvoiceHash       string `json:"invoiceHash"`
	HospitalID        string `json:"hospitalId"`
	HospitalMSP       string `json:"hospitalMsp"`
	PatientHash       string `json:"patientReferenceHash"`
	PatientMSP        string `json:"patientIssuerMsp"`
	AssociationStatus string `json:"associationStatus"`
	Amount            int64  `json:"amountMinor"`
	Treatment         string `json:"treatmentType"`
	Diagnosis         string `json:"diagnosisCode"`
	Admission         string `json:"admissionDate"`
	Discharge         string `json:"dischargeDate"`
	InvoiceDate       string `json:"invoiceDate"`
	ServiceDate       string `json:"serviceDate"`
}

type MedicalOCRSummary struct {
	EvidenceID    string `json:"evidenceId"`
	InvoiceNumber string `json:"invoiceNumber"`
	AmountMinor   int64  `json:"amountMinor"`
	ServiceDate   string `json:"serviceDate"`
	HospitalID    string `json:"hospitalId"`
	DerivedFrom   string `json:"derivedFrom"`
}

type MedicalOracleV2Sources struct {
	Current MedicalOracleV2Source   `json:"current"`
	Priors  []MedicalOracleV2Source `json:"priors"`
	Receipt *MedicalOCRSummary      `json:"receipt,omitempty" metadata:",optional"`
}

var medicalReceiptNumber = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9./_-]{0,63}$`)

func (c *Contract) RecordMedicalOCRSummary(ctx contractapi.TransactionContextInterface, claimID string) error {
	claim, err := c.ReadClaim(ctx, claimID)
	if err != nil {
		return err
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return err
	}
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return err
	}
	if !(role == "policyholder" && subject == claim.ClaimantID || msp == "InsurerMSP" && role == "insurerAdmin") ||
		claim.EpisodeID == "" || !slices.Contains([]string{"SUBMITTED", "APPEAL_SUBMITTED"}, claim.Status) {
		return fmt.Errorf("receipt summary requires an eligible medical case and actor")
	}
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return err
	}
	var summary MedicalOCRSummary
	if len(transient["medicalOCRSummary"]) > 2048 || json.Unmarshal(transient["medicalOCRSummary"], &summary) != nil {
		return fmt.Errorf("invalid private medical receipt summary")
	}
	if summary.DerivedFrom == "" && usesMedicalApprovalCertificates(ctx) {
		summary.DerivedFrom = medicalHospitalFeedRecordID(claimID, claim.Version)
	}
	if !medicalReceiptNumber.MatchString(summary.InvoiceNumber) || summary.AmountMinor <= 0 || summary.AmountMinor > oracleV2SafeInteger ||
		!oracleV2Identifier.MatchString(summary.DerivedFrom) || summary.HospitalID != claim.HospitalID {
		return fmt.Errorf("invalid private medical receipt summary")
	}
	if _, err := validateDate("receipt service date", summary.ServiceDate); err != nil {
		return err
	}
	doc, err := c.ReadEvidenceReference(ctx, summary.EvidenceID)
	if err != nil || doc.ClaimID != claimID || !slices.Contains(claim.EvidenceIDs, summary.EvidenceID) {
		return fmt.Errorf("receipt evidence does not match the current claim")
	}
	return putPrivateState(ctx, "medicalOCRSummary", medicalRevisionKey(claim.ID, claim.Version), &summary)
}

func (c *Contract) ReadMedicalOracleSourcesForRequest(ctx contractapi.TransactionContextInterface, requestID string) (*MedicalOracleV2Sources, error) {
	return c.readMedicalOracleSources(ctx, requestID, false)
}

func (c *Contract) ReadMedicalOracleE3SourcesForRequest(ctx contractapi.TransactionContextInterface, requestID string) (*MedicalOracleV2Sources, error) {
	return c.readMedicalOracleSources(ctx, requestID, true)
}

func (c *Contract) readMedicalOracleSources(ctx contractapi.TransactionContextInterface, requestID string, e3 bool) (*MedicalOracleV2Sources, error) {
	_, subject, err := requireOracleIdentity(ctx)
	if err != nil {
		return nil, err
	}
	request, claim, err := c.currentOracleV2Request(ctx, requestID, subject)
	if err != nil {
		return nil, err
	}
	if (request.ModelVersion == medicalModelE3) != e3 {
		return nil, fmt.Errorf("source query does not match the pinned Oracle release")
	}
	project := medicalOracleV2Source
	if e3 {
		key, err := readMedicalPatientTokenKey(ctx, request.PatientTokenKeyVersion)
		if err != nil {
			return nil, err
		}
		project = func(head *MedicalEpisodeHead, episode *MedicalEpisode, association *MedicalAssociation) MedicalOracleV2Source {
			source := medicalOracleV2Source(head, episode, association)
			source.DigestVersion = head.DigestVersion
			if association != nil && association.Verified {
				source.PatientHash = medicalPatientToken(key, "fabric-medical-oracle-patient-v2", association.BeneficiaryID)
			} else {
				source.PatientHash = medicalPatientToken(key, "fabric-medical-oracle-unlinked-v2", head.HospitalID, episode.PatientReferenceHash)
			}
			return source
		}
	}
	head, err := currentMedicalHead(ctx, claim)
	if err != nil {
		return nil, err
	}
	episode, err := readMedicalEpisode(ctx, head.ID, head.Revision)
	if err != nil {
		return nil, err
	}
	cutoff, err := validateDate("current invoice date", episode.InvoiceDate)
	if err != nil {
		return nil, fmt.Errorf("CURRENT_SOURCE_UNAVAILABLE")
	}
	association, err := verifiedMedicalAssociation(ctx, episode, claim.ClaimantID)
	if err != nil {
		return nil, err
	}
	current := project(head, episode, association)
	result := &MedicalOracleV2Sources{Current: current, Priors: []MedicalOracleV2Source{}}
	start, end := cutoff.AddDate(0, 0, -90).Format(time.DateOnly), episode.InvoiceDate
	appendPrior := func(prior MedicalEpisodeHead) error {
		if prior.ID == head.ID {
			return nil
		}
		row, err := readMedicalEpisode(ctx, prior.ID, prior.Revision)
		if err != nil {
			return err
		}
		if row.InvoiceDate == "" && row.DischargeDate < end {
			return fmt.Errorf("CONTEXT_INCOMPLETE")
		}
		if row.InvoiceDate < start || row.InvoiceDate >= end {
			return nil
		}
		if len(result.Priors) >= 9999 {
			return fmt.Errorf("CONTEXT_OVERSIZED")
		}
		association, err := getPrivateState[MedicalAssociation](ctx, "medicalAssociation", medicalAssociationKey(row))
		if err != nil && !isMissingPrivate(ctx, "medicalAssociation", medicalAssociationKey(row)) {
			return err
		}
		result.Priors = append(result.Priors, project(&prior, row, association))
		return nil
	}
	index, err := ctx.GetStub().GetStateByPartialCompositeKey("hospitalEpisodeByDate", []string{claim.HospitalID})
	if err != nil {
		return nil, err
	}
	defer index.Close()
	for index.HasNext() {
		item, err := index.Next()
		if err != nil {
			return nil, err
		}
		_, parts, err := ctx.GetStub().SplitCompositeKey(item.Key)
		if err != nil || len(parts) != 3 {
			return nil, fmt.Errorf("invalid episode date index")
		}
		if parts[1] < start || parts[1] >= end {
			continue
		}
		prior, err := medicalEpisodeHead(ctx, parts[2])
		if err != nil {
			return nil, err
		}
		if err := appendPrior(*prior); err != nil {
			return nil, err
		}
	}
	// There is no pre-R1 hospital/date index. Only unindexed heads at this
	// hospital need private inspection, and this read never writes state.
	legacy, err := listState[MedicalEpisodeHead](ctx, "medicalEpisode")
	if err != nil {
		return nil, err
	}
	for _, prior := range legacy {
		if prior.HospitalID != claim.HospitalID || prior.ID == head.ID {
			continue
		}
		key, err := stateKey(ctx, "hospitalEpisodeIndexed", prior.ID)
		if err != nil {
			return nil, err
		}
		marker, err := ctx.GetStub().GetState(key)
		if err != nil {
			return nil, err
		}
		if len(marker) == 0 {
			if err := appendPrior(prior); err != nil {
				return nil, err
			}
		}
	}
	if id := medicalRevisionKey(claim.ID, claim.Version); !isMissingPrivate(ctx, "medicalOCRSummary", id) {
		result.Receipt, err = getPrivateState[MedicalOCRSummary](ctx, "medicalOCRSummary", id)
		if err != nil {
			return nil, err
		}
	}
	return result, nil
}

func isMissingPrivate(ctx contractapi.TransactionContextInterface, asset, id string) bool {
	key, err := stateKey(ctx, asset, id)
	if err != nil {
		return false
	}
	raw, err := ctx.GetStub().GetPrivateData(oracleProofCollection, key)
	return err == nil && len(raw) == 0
}

func medicalOracleV2Source(head *MedicalEpisodeHead, episode *MedicalEpisode, association *MedicalAssociation) MedicalOracleV2Source {
	source := MedicalOracleV2Source{InvoiceID: medicalRevisionKey(head.ID, head.Revision), InvoiceHash: head.RevisionHash,
		HospitalID: head.HospitalID, HospitalMSP: "HospitalMSP", PatientHash: episode.PatientReferenceHash,
		AssociationStatus: "UNVERIFIED", Amount: episode.BillMinor, Treatment: episode.Service, Diagnosis: episode.DiagnosisCode,
		Admission: episode.AdmissionDate, Discharge: episode.DischargeDate, InvoiceDate: episode.InvoiceDate, ServiceDate: episode.ServiceDate}
	if association != nil && association.Verified {
		source.PatientHash = patientSubjectHash(association.BeneficiaryID)
		source.PatientMSP = "InsurerMSP"
		source.AssociationStatus = "VERIFIED"
	}
	return source
}
