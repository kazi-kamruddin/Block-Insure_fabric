package insurance

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type MedicalAssociation struct {
	BeneficiaryID        string `json:"beneficiaryId"`
	HospitalID           string `json:"hospitalId"`
	PatientReferenceHash string `json:"patientReferenceHash"`
	DecisionBasisHash    string `json:"decisionBasisHash"`
	Verifier             string `json:"verifier"`
	Version              int    `json:"version"`
	Verified             bool   `json:"verified"`
}

func medicalAssociationKey(episode *MedicalEpisode) string {
	return canonicalProtocolHash("fabric-medical-association-v1", episode.HospitalID, episode.PatientReferenceHash)
}

func medicalEpisodeHead(ctx contractapi.TransactionContextInterface, id string) (*MedicalEpisodeHead, error) {
	return getState[MedicalEpisodeHead](ctx, "medicalEpisode", id)
}

func (c *Contract) VerifyMedicalAssociation(ctx contractapi.TransactionContextInterface, episodeID string, expectedRevision int, beneficiaryID, decisionBasisHash string, verified bool) (*MedicalAssociation, error) {
	if !isMedicalCandidate(ctx) {
		return nil, fmt.Errorf("medical association requires the isolated medical channel")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if !idPattern.MatchString(beneficiaryID) {
		return nil, fmt.Errorf("invalid covered patient subject")
	}
	if err := validateHash("decisionBasisHash", decisionBasisHash); err != nil {
		return nil, err
	}
	head, err := medicalEpisodeHead(ctx, episodeID)
	if err != nil {
		return nil, err
	}
	if head.Revision != expectedRevision {
		return nil, fmt.Errorf("episode revision changed")
	}
	episode, err := readMedicalEpisode(ctx, episodeID, expectedRevision)
	if err != nil {
		return nil, err
	}
	id := medicalAssociationKey(episode)
	key, err := privateStateKey(ctx, "medicalAssociation", id)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetPrivateData(oracleProofCollection, key)
	if err != nil {
		return nil, err
	}
	var prior MedicalAssociation
	if raw != nil {
		if err := json.Unmarshal(raw, &prior); err != nil {
			return nil, err
		}
	}
	if prior.Verified && prior.BeneficiaryID != beneficiaryID {
		return nil, fmt.Errorf("revoke the previous association before selecting a different patient")
	}
	if prior.Version != 0 && prior.Verified == verified && prior.BeneficiaryID == beneficiaryID && prior.DecisionBasisHash == decisionBasisHash {
		return &prior, nil
	}
	if !verified && (!prior.Verified || prior.BeneficiaryID != beneficiaryID) {
		return nil, fmt.Errorf("no matching confirmed association to revoke")
	}
	actor, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	next := &MedicalAssociation{BeneficiaryID: beneficiaryID, HospitalID: episode.HospitalID,
		PatientReferenceHash: episode.PatientReferenceHash, DecisionBasisHash: decisionBasisHash,
		Verifier: actor, Version: prior.Version + 1, Verified: verified}
	if err := putPrivateState(ctx, "medicalAssociationAudit", canonicalProtocolHash("fabric-medical-association-audit-v1", id, strconv.Itoa(next.Version)), next); err != nil {
		return nil, err
	}
	payload, err := json.Marshal(next)
	if err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutPrivateData(oracleProofCollection, key, payload); err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "medicalAssociationVersion", id, struct {
		Version int `json:"version"`
	}{next.Version}); err != nil {
		return nil, err
	}
	return next, nil
}

func verifiedMedicalAssociation(ctx contractapi.TransactionContextInterface, episode *MedicalEpisode, beneficiary string) (*MedicalAssociation, error) {
	association, err := getPrivateState[MedicalAssociation](ctx, "medicalAssociation", medicalAssociationKey(episode))
	if err != nil || !association.Verified || association.BeneficiaryID != beneficiary {
		return nil, fmt.Errorf("episode is unavailable to this covered patient")
	}
	return association, nil
}

type MedicalEpisodeView struct {
	AssociationVersion   int    `json:"associationVersion"`
	ID                   string `json:"id"`
	HospitalID           string `json:"hospitalId"`
	Revision             int    `json:"revision"`
	Service              string `json:"service"`
	ServiceDate          string `json:"serviceDate"`
	AdmissionDate        string `json:"admissionDate"`
	DischargeDate        string `json:"dischargeDate"`
	BillMinor            int64  `json:"billMinor"`
	AssociationStatus    string `json:"associationStatus"`
	PatientReferenceHash string `json:"patientReferenceHash"`
	BeneficiaryID        string `json:"beneficiaryId"`
}

func (c *Contract) ListMedicalEpisodes(ctx contractapi.TransactionContextInterface) ([]MedicalEpisodeView, error) {
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return nil, err
	}
	if !isMedicalCandidate(ctx) || msp != "InsurerMSP" || (role != "policyholder" && role != "insurerAdmin") {
		return nil, fmt.Errorf("medical episode listing requires an insurer or covered patient")
	}
	subject, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	heads, err := listState[MedicalEpisodeHead](ctx, "medicalEpisode")
	if err != nil {
		return nil, err
	}
	rows := []MedicalEpisodeView{}
	for _, head := range heads {
		episode, err := readMedicalEpisode(ctx, head.ID, head.Revision)
		if err != nil {
			return nil, err
		}
		association, lookupErr := getPrivateState[MedicalAssociation](ctx, "medicalAssociation", medicalAssociationKey(episode))
		if role == "policyholder" && (lookupErr != nil || !association.Verified || association.BeneficiaryID != subject) {
			continue
		}
		row := MedicalEpisodeView{ID: head.ID, HospitalID: head.HospitalID, Revision: head.Revision,
			Service: episode.Service, ServiceDate: episode.ServiceDate, AdmissionDate: episode.AdmissionDate,
			DischargeDate: episode.DischargeDate, BillMinor: episode.BillMinor, AssociationStatus: "PENDING"}
		if lookupErr == nil && association.Verified {
			row.AssociationStatus = "VERIFIED"
			row.AssociationVersion = association.Version
		}
		if role == "insurerAdmin" {
			row.PatientReferenceHash = episode.PatientReferenceHash
			if lookupErr == nil {
				row.BeneficiaryID = association.BeneficiaryID
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}
