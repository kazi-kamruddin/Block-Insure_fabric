package insurance

import (
	"fmt"
	"slices"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const genesisMedicalModelID = "frozen-medical-v1"
const frozenMedicalModelVersion = "fabric-xgb-synthetic-v1"
const frozenMedicalModelHash = "4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4"

type MedicalModelRelease struct {
	ID                  string   `json:"id"`
	ModelVersion        string   `json:"modelVersion"`
	ArtifactHash        string   `json:"artifactHash"`
	FeatureSchema       string   `json:"featureSchema"`
	CalibrationVersion  string   `json:"calibrationVersion"`
	IntendedTask        string   `json:"intendedTask"`
	ShadowEvidenceHash  string   `json:"shadowEvidenceHash"`
	Status              string   `json:"status"`
	ApprovedMSPs        []string `json:"approvedMsps"`
	HoldReasonHash      string   `json:"holdReasonHash"`
	OracleInstalledHash string   `json:"oracleInstalledHash"`
}

func (c *Contract) ReadMedicalModelRelease(ctx contractapi.TransactionContextInterface, id string) (*MedicalModelRelease, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("medical model releases require the dev-lite channel")
	}
	return getState[MedicalModelRelease](ctx, "medicalModelRelease", id)
}

func (c *Contract) RegisterMedicalModelRelease(ctx contractapi.TransactionContextInterface, id, modelVersion, artifactHash, featureSchema, calibrationVersion, task string) (*MedicalModelRelease, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("medical model releases require the dev-lite channel")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if id == genesisMedicalModelID {
		return nil, fmt.Errorf("model release identifier is reserved")
	}
	for _, value := range []string{id, modelVersion, featureSchema, calibrationVersion} {
		if !idPattern.MatchString(value) {
			return nil, fmt.Errorf("invalid model release identifier or version")
		}
	}
	if err := validateHash("artifactHash", artifactHash); err != nil {
		return nil, err
	}
	if task != "ROUTING" && task != "ADVISORY" {
		return nil, fmt.Errorf("intended task must be ROUTING or ADVISORY")
	}
	release := &MedicalModelRelease{ID: id, ModelVersion: modelVersion, ArtifactHash: strings.ToLower(artifactHash),
		FeatureSchema: featureSchema, CalibrationVersion: calibrationVersion, IntendedTask: task,
		Status: "CANDIDATE", ApprovedMSPs: []string{}}
	if err := putState(ctx, "medicalModelRelease", id, release); err != nil {
		return nil, err
	}
	return release, emit(ctx, "MedicalModelReleaseRegistered", release)
}

func (c *Contract) ShadowMedicalModelRelease(ctx contractapi.TransactionContextInterface, id, evidenceHash string) (*MedicalModelRelease, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if err := validateHash("shadowEvidenceHash", evidenceHash); err != nil {
		return nil, err
	}
	release, err := c.ReadMedicalModelRelease(ctx, id)
	if err != nil {
		return nil, err
	}
	if release.Status != "CANDIDATE" {
		return nil, fmt.Errorf("only a CANDIDATE release may enter SHADOW")
	}
	release.Status, release.ShadowEvidenceHash = "SHADOW", strings.ToLower(evidenceHash)
	return saveMedicalModelRelease(ctx, release)
}

func medicalModelReleaseActor(ctx contractapi.TransactionContextInterface) (string, error) {
	_, msp, role, err := identityDetails(ctx)
	if err != nil {
		return "", err
	}
	switch {
	case msp == "InsurerMSP" && role == "insurerAdmin",
		msp == "AuditorMSP" && role == "auditor",
		msp == "OracleMSP" && role == "oracle":
		return msp, nil
	default:
		return "", fmt.Errorf("model release requires an Insurer, Auditor, or Oracle role")
	}
}

func (c *Contract) ApproveMedicalModelRelease(ctx contractapi.TransactionContextInterface, id, installedArtifactHash string) (*MedicalModelRelease, error) {
	msp, err := medicalModelReleaseActor(ctx)
	if err != nil {
		return nil, err
	}
	release, err := c.ReadMedicalModelRelease(ctx, id)
	if err != nil {
		return nil, err
	}
	if release.Status != "SHADOW" {
		return nil, fmt.Errorf("only a SHADOW release may be approved")
	}
	if slices.Contains(release.ApprovedMSPs, msp) {
		return nil, fmt.Errorf("this MSP already approved")
	}
	if msp == "OracleMSP" {
		if err := validateHash("installedArtifactHash", installedArtifactHash); err != nil {
			return nil, err
		}
		if !strings.EqualFold(installedArtifactHash, release.ArtifactHash) {
			return nil, fmt.Errorf("installed evaluator does not match the release artifact")
		}
		release.OracleInstalledHash = strings.ToLower(installedArtifactHash)
	} else if installedArtifactHash != "" {
		return nil, fmt.Errorf("only Oracle may attest the installed evaluator")
	}
	release.ApprovedMSPs = append(release.ApprovedMSPs, msp)
	if len(release.ApprovedMSPs) == 3 {
		release.Status = "PROMOTED"
		if release.IntendedTask == "ROUTING" {
			if _, err := c.activeMedicalRoutingRelease(ctx); err != nil {
				return nil, err
			}
			if err := overwriteAsset(ctx, "activeMedicalModelRelease", "ROUTING", release.ID); err != nil {
				return nil, err
			}
		}
	}
	return saveMedicalModelRelease(ctx, release)
}

func (c *Contract) HoldMedicalModelRelease(ctx contractapi.TransactionContextInterface, id, reasonHash string) (*MedicalModelRelease, error) {
	if _, err := medicalModelReleaseActor(ctx); err != nil {
		return nil, err
	}
	if err := validateHash("holdReasonHash", reasonHash); err != nil {
		return nil, err
	}
	release, err := c.ReadMedicalModelRelease(ctx, id)
	if err != nil {
		return nil, err
	}
	if release.Status != "SHADOW" && release.Status != "PROMOTED" {
		return nil, fmt.Errorf("only a SHADOW or PROMOTED release may be held")
	}
	release.Status, release.HoldReasonHash = "HELD", strings.ToLower(reasonHash)
	return saveMedicalModelRelease(ctx, release)
}

func saveMedicalModelRelease(ctx contractapi.TransactionContextInterface, release *MedicalModelRelease) (*MedicalModelRelease, error) {
	if err := overwriteAsset(ctx, "medicalModelRelease", release.ID, release); err != nil {
		return nil, err
	}
	return release, emit(ctx, "MedicalModelReleaseUpdated", release)
}

func (c *Contract) activeMedicalRoutingRelease(ctx contractapi.TransactionContextInterface) (*MedicalModelRelease, error) {
	key, err := stateKey(ctx, "activeMedicalModelRelease", "ROUTING")
	if err != nil {
		return nil, err
	}
	value, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if value != nil {
		id, err := getState[string](ctx, "activeMedicalModelRelease", "ROUTING")
		if err != nil {
			return nil, err
		}
		return c.ReadMedicalModelRelease(ctx, *id)
	}
	genesis := &MedicalModelRelease{ID: genesisMedicalModelID, ModelVersion: frozenMedicalModelVersion,
		ArtifactHash: frozenMedicalModelHash, FeatureSchema: "frozen-medical-v1", CalibrationVersion: "frozen-threshold-v1",
		IntendedTask: "ROUTING", Status: "PROMOTED", ApprovedMSPs: []string{}}
	if err := putState(ctx, "medicalModelRelease", genesis.ID, genesis); err != nil {
		return nil, err
	}
	if err := putState(ctx, "activeMedicalModelRelease", "ROUTING", genesis.ID); err != nil {
		return nil, err
	}
	return genesis, nil
}

func (c *Contract) heldMedicalRequest(ctx contractapi.TransactionContextInterface, request *OracleRequest) (bool, error) {
	if !usesMedicalApprovalCertificates(ctx) || effectiveMedicalModelReleaseID(request) == "" {
		return false, nil
	}
	id := effectiveMedicalModelReleaseID(request)
	if request.ModelReleaseID == "" {
		if _, err := c.activeMedicalRoutingRelease(ctx); err != nil {
			return false, err
		}
	}
	release, err := c.ReadMedicalModelRelease(ctx, id)
	if err != nil {
		return false, err
	}
	return release.Status == "HELD", nil
}

func effectiveMedicalModelReleaseID(request *OracleRequest) string {
	if request == nil {
		return ""
	}
	if request.ModelReleaseID == "" && request.ModelVersion == frozenMedicalModelVersion && request.ModelHash == frozenMedicalModelHash {
		return genesisMedicalModelID
	}
	return request.ModelReleaseID
}

func (c *Contract) requireUsableMedicalRelease(ctx contractapi.TransactionContextInterface, request *OracleRequest) error {
	held, err := c.heldMedicalRequest(ctx, request)
	if err != nil {
		return err
	}
	if held {
		return fmt.Errorf("model release is held; prepare panel review")
	}
	return nil
}
