package insurance

import (
	"encoding/json"
	"fmt"
	"slices"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type OracleRosterSubject struct {
	SubjectID  string `json:"subjectId"`
	KeyVersion int    `json:"keyVersion"`
}

type OracleRoster struct {
	Version               string                `json:"version"`
	Subjects              []OracleRosterSubject `json:"subjects"`
	RequiredConfirmations int                   `json:"requiredConfirmations"`
	Status                string                `json:"status"`
	ApprovedMSPs          []string              `json:"approvedMsps"`
}

type oracleSubjectRevocation struct {
	ReasonHash string `json:"reasonHash"`
	RevokedAt  string `json:"revokedAt"`
}

func (c *Contract) ProposeOracleRoster(ctx contractapi.TransactionContextInterface, version, subjectsJSON string) (*OracleRoster, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	var subjects []OracleRosterSubject
	if !idPattern.MatchString(version) || json.Unmarshal([]byte(subjectsJSON), &subjects) != nil || len(subjects) != 3 {
		return nil, fmt.Errorf("Oracle roster requires exactly three subjects")
	}
	seen := map[string]bool{}
	for _, subject := range subjects {
		if !idPattern.MatchString(subject.SubjectID) || seen[subject.SubjectID] || subject.KeyVersion < 1 || subject.KeyVersion > 999999999 {
			return nil, fmt.Errorf("invalid or duplicate Oracle roster subject")
		}
		seen[subject.SubjectID] = true
	}
	roster := &OracleRoster{Version: version, Subjects: subjects, RequiredConfirmations: 2, Status: "PROPOSED", ApprovedMSPs: []string{}}
	if err := putState(ctx, "oracleRoster", version, roster); err != nil {
		return nil, err
	}
	return roster, emit(ctx, "OracleRosterUpdated", roster)
}

func (c *Contract) ReadOracleRoster(ctx contractapi.TransactionContextInterface, version string) (*OracleRoster, error) {
	return getState[OracleRoster](ctx, "oracleRoster", version)
}

func (c *Contract) ListOracleRosters(ctx contractapi.TransactionContextInterface) ([]OracleRoster, error) {
	return listState[OracleRoster](ctx, "oracleRoster")
}

func (c *Contract) ApproveOracleRoster(ctx contractapi.TransactionContextInterface, version string) (*OracleRoster, error) {
	msp, err := medicalModelReleaseActor(ctx)
	if err != nil {
		return nil, err
	}
	roster, err := c.ReadOracleRoster(ctx, version)
	if err != nil {
		return nil, err
	}
	if roster.Status != "PROPOSED" || slices.Contains(roster.ApprovedMSPs, msp) {
		return nil, fmt.Errorf("Oracle roster approval is not eligible")
	}
	roster.ApprovedMSPs = append(roster.ApprovedMSPs, msp)
	slices.Sort(roster.ApprovedMSPs)
	if len(roster.ApprovedMSPs) == 3 {
		roster.Status = "APPROVED"
	}
	if err := overwriteAsset(ctx, "oracleRoster", version, roster); err != nil {
		return nil, err
	}
	return roster, emit(ctx, "OracleRosterUpdated", roster)
}

func (c *Contract) ActivateOracleRoster(ctx contractapi.TransactionContextInterface, version string) (*OracleRoster, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	roster, err := c.ReadOracleRoster(ctx, version)
	if err != nil {
		return nil, err
	}
	if roster.Status != "APPROVED" {
		return nil, fmt.Errorf("only a newly approved roster may be activated")
	}
	for _, subject := range roster.Subjects {
		revoked, err := oracleSubjectRevoked(ctx, subject)
		if err != nil {
			return nil, err
		}
		if revoked {
			return nil, fmt.Errorf("cannot activate a roster with a revoked Oracle")
		}
	}
	roster.Status = "ACTIVE"
	if err := overwriteAsset(ctx, "oracleRoster", version, roster); err != nil {
		return nil, err
	}
	if err := overwriteAsset(ctx, "activeOracleRoster", "medical", version); err != nil {
		return nil, err
	}
	return roster, emit(ctx, "OracleRosterUpdated", roster)
}

func (c *Contract) ReadActiveOracleRoster(ctx contractapi.TransactionContextInterface) (*OracleRoster, error) {
	version, err := getState[string](ctx, "activeOracleRoster", "medical")
	if err != nil {
		return nil, err
	}
	return c.ReadOracleRoster(ctx, *version)
}

func (c *Contract) RevokeOracleSubject(ctx contractapi.TransactionContextInterface, subjectID string, keyVersion int, reasonHash string) error {
	if _, err := medicalModelReleaseActor(ctx); err != nil {
		return err
	}
	if !idPattern.MatchString(subjectID) || len(subjectID) > 115 || keyVersion < 1 || keyVersion > 999999999 || !oracleV2Hash.MatchString(reasonHash) {
		return fmt.Errorf("invalid Oracle subject revocation")
	}
	at, err := ledgerTimestamp(ctx)
	if err != nil {
		return err
	}
	if err := putState(ctx, "oracleSubjectRevocation", sourceKey(subjectID, keyVersion), oracleSubjectRevocation{ReasonHash: reasonHash, RevokedAt: at}); err != nil {
		return err
	}
	return emit(ctx, "OracleSubjectRevoked", OracleRosterSubject{SubjectID: subjectID, KeyVersion: keyVersion})
}

func oracleSubjectRevoked(ctx contractapi.TransactionContextInterface, subject OracleRosterSubject) (bool, error) {
	key, err := stateKey(ctx, "oracleSubjectRevocation", sourceKey(subject.SubjectID, subject.KeyVersion))
	if err != nil {
		return false, err
	}
	record, err := ctx.GetStub().GetState(key)
	return len(record) > 0, err
}

func requireOracleRosterSubject(ctx contractapi.TransactionContextInterface, version, subjectID string) error {
	roster, err := new(Contract).ReadOracleRoster(ctx, version)
	if err != nil {
		return err
	}
	for _, subject := range roster.Subjects {
		if subject.SubjectID != subjectID {
			continue
		}
		revoked, err := oracleSubjectRevoked(ctx, subject)
		if err != nil {
			return err
		}
		key, exists, err := ctx.GetClientIdentity().GetAttributeValue("oracleKeyVersion")
		if err != nil {
			return err
		}
		if revoked || (!exists && subject.KeyVersion != 1) || (exists && key != strconv.Itoa(subject.KeyVersion)) {
			return fmt.Errorf("Oracle subject key is revoked or does not match the request's roster")
		}
		return nil
	}
	return fmt.Errorf("Oracle subject is not assigned in this roster")
}

func (c *Contract) RecordLedgerInstance(ctx contractapi.TransactionContextInterface, id string) (string, error) {
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return "", err
	}
	if !oracleV2Hash.MatchString(id) {
		return "", fmt.Errorf("invalid ledger provisioning ID")
	}
	if err := putState(ctx, "ledgerInstance", "provisioning", id); err != nil {
		return "", err
	}
	return id, emit(ctx, "LedgerInstanceRecorded", id)
}

func (c *Contract) ReadLedgerInstance(ctx contractapi.TransactionContextInterface) (string, error) {
	key, err := stateKey(ctx, "ledgerInstance", "provisioning")
	if err != nil {
		return "", err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil || len(raw) == 0 {
		return "", err
	}
	var id string
	if err := json.Unmarshal(raw, &id); err != nil {
		return "", err
	}
	return id, nil
}
