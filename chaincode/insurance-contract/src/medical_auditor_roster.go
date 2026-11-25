package insurance

import (
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type AuditorRoster struct {
	Version      string   `json:"version"`
	Subjects     []string `json:"subjects"`
	Status       string   `json:"status"`
	ApprovedMSPs []string `json:"approvedMsps"`
}

func (c *Contract) ProposeAuditorRoster(ctx contractapi.TransactionContextInterface, version, subjectsJSON string) (*AuditorRoster, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("medical auditor roster requires dev-lite")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	var subjects []string
	if !idPattern.MatchString(version) || json.Unmarshal([]byte(subjectsJSON), &subjects) != nil || len(subjects) != 6 {
		return nil, fmt.Errorf("auditor roster requires a version and exactly six subjects")
	}
	slices.Sort(subjects)
	for i, subject := range subjects {
		if !idPattern.MatchString(subject) || (i > 0 && subjects[i-1] == subject) {
			return nil, fmt.Errorf("invalid or duplicate auditor subject")
		}
	}
	roster := &AuditorRoster{Version: version, Subjects: subjects, Status: "PROPOSED", ApprovedMSPs: []string{}}
	if err := putState(ctx, "auditorRoster", version, roster); err != nil {
		return nil, err
	}
	return roster, emit(ctx, "AuditorRosterUpdated", roster)
}

func (c *Contract) ReadAuditorRoster(ctx contractapi.TransactionContextInterface, version string) (*AuditorRoster, error) {
	return getState[AuditorRoster](ctx, "auditorRoster", version)
}

func (c *Contract) ApproveAuditorRoster(ctx contractapi.TransactionContextInterface, version string) (*AuditorRoster, error) {
	msp, err := medicalModelReleaseActor(ctx)
	if err != nil {
		return nil, err
	}
	roster, err := c.ReadAuditorRoster(ctx, version)
	if err != nil {
		return nil, err
	}
	if roster.Status != "PROPOSED" || slices.Contains(roster.ApprovedMSPs, msp) {
		return nil, fmt.Errorf("auditor roster approval is not eligible")
	}
	roster.ApprovedMSPs = append(roster.ApprovedMSPs, msp)
	slices.Sort(roster.ApprovedMSPs)
	if len(roster.ApprovedMSPs) == 3 {
		roster.Status = "APPROVED"
	}
	if err := overwriteAsset(ctx, "auditorRoster", version, roster); err != nil {
		return nil, err
	}
	return roster, emit(ctx, "AuditorRosterUpdated", roster)
}

func (c *Contract) ActivateAuditorRoster(ctx contractapi.TransactionContextInterface, version string) (*AuditorRoster, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	roster, err := c.ReadAuditorRoster(ctx, version)
	if err != nil {
		return nil, err
	}
	if roster.Status != "APPROVED" {
		return nil, fmt.Errorf("only an approved auditor roster can be activated")
	}
	roster.Status = "ACTIVE"
	if err := overwriteAsset(ctx, "auditorRoster", version, roster); err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "activeAuditorRoster", "medical", version); err != nil {
		return nil, err
	}
	return roster, emit(ctx, "AuditorRosterUpdated", roster)
}

func (c *Contract) activeAuditorRoster(ctx contractapi.TransactionContextInterface) (*AuditorRoster, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, nil
	}
	key, err := stateKey(ctx, "activeAuditorRoster", "medical")
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil || len(raw) == 0 {
		return nil, err
	}
	var version string
	if err := json.Unmarshal(raw, &version); err != nil {
		return nil, err
	}
	return c.ReadAuditorRoster(ctx, version)
}

func (c *Contract) ReadActiveAuditorRoster(ctx contractapi.TransactionContextInterface) (*AuditorRoster, error) {
	roster, err := c.activeAuditorRoster(ctx)
	if err == nil && roster == nil {
		return nil, fmt.Errorf("no active auditor roster")
	}
	return roster, err
}

func drawAuditors(claim *Claim, candidates []string) []string {
	seed := canonicalProtocolHash("medical-panel-draw-v1", claim.ID, strconv.Itoa(claim.Version), strconv.Itoa(claim.ReviewRound+1))
	ordered := slices.Clone(candidates)
	slices.SortFunc(ordered, func(a, b string) int {
		left := canonicalProtocolHash("medical-panel-seat-v1", seed, a)
		right := canonicalProtocolHash("medical-panel-seat-v1", seed, b)
		if left == right {
			return strings.Compare(a, b)
		}
		return strings.Compare(left, right)
	})
	return ordered
}
