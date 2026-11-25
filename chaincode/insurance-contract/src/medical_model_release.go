package insurance

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const genesisMedicalModelID = "frozen-medical-v1"
const frozenMedicalModelVersion = "fabric-xgb-synthetic-v1"
const frozenMedicalModelHash = "4954e2d2c71422d415c1d50d32687412479fee5bf61a3a9e283760726e6120b4"
const medicalModelE2 = "fabric-xgb-synthetic-e2"
const medicalReleaseActivationDelay = 10 * time.Minute

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
	GovernanceVersion   int      `json:"governanceVersion,omitempty" metadata:",optional"`
	ApprovedAt          string   `json:"approvedAt,omitempty" metadata:",optional"`
	ResumeReasonHash    string   `json:"resumeReasonHash,omitempty" metadata:",optional"`
	AttestationRound    int      `json:"attestationRound,omitempty" metadata:",optional"`
	AttestationRoster   string   `json:"attestationRoster,omitempty" metadata:",optional"`
	OracleAttesters     []string `json:"oracleAttesters,omitempty" metadata:",optional"`
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
		Status: "REGISTERED", GovernanceVersion: 2, AttestationRound: 1, ApprovedMSPs: []string{}}
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
	if release.Status != "REGISTERED" && release.Status != "CANDIDATE" {
		return nil, fmt.Errorf("only a registered release may enter SHADOW")
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
	if release.Status != "SHADOW" && release.Status != "RESUME_PENDING" {
		return nil, fmt.Errorf("only a SHADOW or RESUME_PENDING release may be approved")
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
		if release.GovernanceVersion >= 2 {
			if err := requireCurrentReleaseAttestations(ctx, release); err != nil {
				return nil, err
			}
		}
		release.OracleInstalledHash = strings.ToLower(installedArtifactHash)
	} else if installedArtifactHash != "" {
		return nil, fmt.Errorf("only Oracle may attest the installed evaluator")
	}
	release.ApprovedMSPs = append(release.ApprovedMSPs, msp)
	if len(release.ApprovedMSPs) == 3 {
		if release.GovernanceVersion >= 2 {
			if err := requireCurrentReleaseAttestations(ctx, release); err != nil {
				return nil, err
			}
			release.ApprovedAt, err = ledgerTimestamp(ctx)
			if err != nil {
				return nil, err
			}
			release.Status = "APPROVED"
			return saveMedicalModelRelease(ctx, release)
		}
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
	if !slices.Contains([]string{"SHADOW", "PROMOTED", "APPROVED", "ACTIVE", "RESUME_PENDING"}, release.Status) {
		return nil, fmt.Errorf("only a shadow, approved, active or resuming model release may be held")
	}
	release.Status, release.HoldReasonHash = "HELD", strings.ToLower(reasonHash)
	return saveMedicalModelRelease(ctx, release)
}

func requireCurrentReleaseAttestations(ctx contractapi.TransactionContextInterface, release *MedicalModelRelease) error {
	roster, err := new(Contract).ReadActiveOracleRoster(ctx)
	if err != nil {
		return err
	}
	if roster.Version != release.AttestationRoster {
		return fmt.Errorf("release requires two attestations from the current Oracle roster")
	}
	count := 0
	for _, subject := range roster.Subjects {
		if !slices.Contains(release.OracleAttesters, subject.SubjectID) {
			continue
		}
		revoked, err := oracleSubjectRevoked(ctx, subject)
		if err != nil {
			return err
		}
		if !revoked {
			count++
		}
	}
	if count < 2 {
		return fmt.Errorf("release requires two distinct Oracle attestations matching the artifact")
	}
	return nil
}

func (c *Contract) AttestMedicalModelRelease(ctx contractapi.TransactionContextInterface, id, installedHash string) (*MedicalModelRelease, error) {
	_, subject, err := requireOracleIdentity(ctx)
	if err != nil {
		return nil, err
	}
	release, err := c.ReadMedicalModelRelease(ctx, id)
	if err != nil {
		return nil, err
	}
	if release.GovernanceVersion < 2 || (release.Status != "SHADOW" && release.Status != "RESUME_PENDING") || installedHash != release.ArtifactHash {
		return nil, fmt.Errorf("release is not eligible for this Oracle artifact attestation")
	}
	roster, err := c.ReadActiveOracleRoster(ctx)
	if err != nil {
		return nil, err
	}
	if err := requireOracleRosterSubject(ctx, roster.Version, subject); err != nil {
		return nil, err
	}
	if release.AttestationRoster != roster.Version {
		release.AttestationRoster = roster.Version
		release.OracleAttesters = nil
		release.OracleInstalledHash = ""
		release.ApprovedMSPs = slices.DeleteFunc(release.ApprovedMSPs, func(msp string) bool { return msp == "OracleMSP" })
	}
	if slices.Contains(release.OracleAttesters, subject) {
		return nil, fmt.Errorf("Oracle subject already attested this release round")
	}
	release.OracleAttesters = append(release.OracleAttesters, subject)
	slices.Sort(release.OracleAttesters)
	return saveMedicalModelRelease(ctx, release)
}

func (c *Contract) ActivateMedicalModelRelease(ctx contractapi.TransactionContextInterface, id string) (*MedicalModelRelease, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	release, err := c.ReadMedicalModelRelease(ctx, id)
	if err != nil {
		return nil, err
	}
	now, err := ledgerNow(ctx)
	if err != nil {
		return nil, err
	}
	approvedAt, parseErr := time.Parse(time.RFC3339Nano, release.ApprovedAt)
	if release.Status != "APPROVED" || parseErr != nil || now.Before(approvedAt.Add(medicalReleaseActivationDelay)) {
		return nil, fmt.Errorf("release activation requires approval and a ten-minute delay")
	}
	if err := requireCurrentReleaseAttestations(ctx, release); err != nil {
		return nil, err
	}
	release.Status = "ACTIVE"
	if release.IntendedTask == "ROUTING" {
		if err := overwriteAsset(ctx, "activeMedicalModelRelease", "ROUTING", id); err != nil {
			return nil, err
		}
	}
	return saveMedicalModelRelease(ctx, release)
}

func (c *Contract) RequestMedicalModelResume(ctx contractapi.TransactionContextInterface, id, reasonHash string) (*MedicalModelRelease, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if !oracleV2Hash.MatchString(reasonHash) {
		return nil, fmt.Errorf("resume requires a reason hash")
	}
	release, err := c.ReadMedicalModelRelease(ctx, id)
	if err != nil {
		return nil, err
	}
	if release.Status != "HELD" || release.GovernanceVersion < 2 {
		return nil, fmt.Errorf("only a held governed release may request resume")
	}
	release.Status = "RESUME_PENDING"
	release.ResumeReasonHash = reasonHash
	release.ApprovedAt, release.AttestationRoster, release.OracleInstalledHash = "", "", ""
	release.ApprovedMSPs, release.OracleAttesters = []string{}, nil
	release.AttestationRound++
	return saveMedicalModelRelease(ctx, release)
}

func (c *Contract) ReadActiveMedicalModelRelease(ctx contractapi.TransactionContextInterface) (*MedicalModelRelease, error) {
	id, err := getState[string](ctx, "activeMedicalModelRelease", "ROUTING")
	if err != nil {
		return nil, err
	}
	return c.ReadMedicalModelRelease(ctx, *id)
}

func (c *Contract) ListMedicalModelReleases(ctx contractapi.TransactionContextInterface) ([]MedicalModelRelease, error) {
	return listState[MedicalModelRelease](ctx, "medicalModelRelease")
}

func (c *Contract) requireActiveMedicalV2Release(ctx contractapi.TransactionContextInterface) (*MedicalModelRelease, error) {
	release, err := c.ReadActiveMedicalModelRelease(ctx)
	if err != nil || release.Status != "ACTIVE" || release.ModelVersion != medicalModelE2 || release.GovernanceVersion < 2 {
		return nil, fmt.Errorf("active E2 routing release is unavailable")
	}
	return release, nil
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
	return release.Status == "HELD" || (release.GovernanceVersion >= 2 && release.Status != "ACTIVE"), nil
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
