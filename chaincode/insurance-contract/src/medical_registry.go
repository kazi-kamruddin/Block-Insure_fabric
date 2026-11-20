package insurance

import (
	"fmt"
	"strings"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

type medicalRegistryPointer struct {
	SnapshotID string `json:"snapshotId"`
	Version    int    `json:"version"`
}

func (c *Contract) ProposeMedicalRegistrySnapshot(ctx contractapi.TransactionContextInterface, id, hospitalID string, version int, rootHash, rulesVersion, rulesHash string, recordCount int) (*OracleRegistrySnapshot, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("scoped registry proposals require the medical development channel")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	if _, err := stateKey(ctx, "medicalActiveRegistry", hospitalID); err != nil {
		return nil, err
	}
	return c.publishOracleRegistrySnapshot(ctx, id, hospitalID, version, rootHash, rulesVersion, rulesHash, recordCount)
}

func (c *Contract) AttestMedicalRegistrySnapshot(ctx contractapi.TransactionContextInterface, id, expectedRoot string) (*OracleRegistrySnapshot, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("registry attestation requires the medical development channel")
	}
	if _, err := requireIdentity(ctx, "HospitalMSP", "hospitalOfficer"); err != nil {
		return nil, err
	}
	snapshot, err := c.ReadOracleRegistrySnapshot(ctx, id)
	if err != nil {
		return nil, err
	}
	hospital, err := callerSubject(ctx)
	if err != nil {
		return nil, err
	}
	if hospital != snapshot.HospitalID {
		return nil, fmt.Errorf("assigned hospital must attest this snapshot")
	}
	if !strings.EqualFold(snapshot.RootHash, expectedRoot) {
		return nil, fmt.Errorf("registry root does not match the proposal")
	}
	if snapshot.Status == "ACTIVE" {
		return snapshot, nil
	}
	if snapshot.Status != "PROPOSED" {
		return nil, fmt.Errorf("registry snapshot must be proposed")
	}
	key, err := stateKey(ctx, "medicalActiveRegistry", hospital)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	if raw != nil {
		pointer, err := getState[medicalRegistryPointer](ctx, "medicalActiveRegistry", hospital)
		if err != nil {
			return nil, err
		}
		if snapshot.Version <= pointer.Version {
			return nil, fmt.Errorf("cannot activate an older registry snapshot")
		}
	}
	now, err := timestamp(ctx)
	if err != nil {
		return nil, err
	}
	snapshot.Status, snapshot.AttestedBy, snapshot.AttestedAt = "ACTIVE", hospital, now
	if err := overwriteAsset(ctx, "oracleRegistrySnapshot", snapshot.ID, snapshot); err != nil {
		return nil, err
	}
	if err := overwriteState(ctx, key, medicalRegistryPointer{snapshot.ID, snapshot.Version}); err != nil {
		return nil, err
	}
	return snapshot, emit(ctx, "MedicalRegistrySnapshotActivated", snapshot)
}

func requireActiveMedicalSnapshot(ctx contractapi.TransactionContextInterface, claim *Claim, snapshot *OracleRegistrySnapshot) error {
	if claim.EpisodeID == "" || snapshot.Status != "ACTIVE" || snapshot.HospitalID != claim.HospitalID {
		return fmt.Errorf("a hospital-attested registry snapshot is required")
	}
	current, err := getState[medicalRegistryPointer](ctx, "medicalActiveRegistry", claim.HospitalID)
	if err != nil {
		return err
	}
	if current.SnapshotID != snapshot.ID {
		return fmt.Errorf("registry snapshot was superseded; use the current attested snapshot")
	}
	return nil
}
