package insurance

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const patientTokenEpoch = "medical"

type MedicalPatientTokenEpoch struct {
	Version   int    `json:"version"`
	RotatedAt string `json:"rotatedAt"`
}

func (c *Contract) RotateMedicalPatientTokenKey(ctx contractapi.TransactionContextInterface, expectedVersion int) (*MedicalPatientTokenEpoch, error) {
	if !usesMedicalApprovalCertificates(ctx) {
		return nil, fmt.Errorf("patient token rotation requires dev-lite")
	}
	if _, err := requireIdentity(ctx, "InsurerMSP", "insurerAdmin"); err != nil {
		return nil, err
	}
	key, err := stateKey(ctx, "medicalPatientTokenKeyVersion", patientTokenEpoch)
	if err != nil {
		return nil, err
	}
	raw, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, err
	}
	var current MedicalPatientTokenEpoch
	if len(raw) > 0 {
		existing, err := getState[MedicalPatientTokenEpoch](ctx, "medicalPatientTokenKeyVersion", patientTokenEpoch)
		if err != nil {
			return nil, err
		}
		current = *existing
	}
	if expectedVersion != current.Version || current.Version == 999999999 {
		return nil, fmt.Errorf("patient token key version changed")
	}
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return nil, err
	}
	secret := transient["channelPatientKey"]
	if len(secret) != 32 || bytes.Equal(secret, make([]byte, 32)) {
		return nil, fmt.Errorf("a fresh 32-byte patient key is required in transient data")
	}
	if current.Version > 0 {
		prior, err := readMedicalPatientTokenKey(ctx, current.Version)
		if err != nil {
			return nil, err
		}
		if hmac.Equal(secret, prior) {
			return nil, fmt.Errorf("rotated patient key must differ from the current key")
		}
	}
	now, err := ledgerTimestamp(ctx)
	if err != nil {
		return nil, err
	}
	next := &MedicalPatientTokenEpoch{Version: current.Version + 1, RotatedAt: now}
	if err := ctx.GetStub().PutPrivateData(oracleProofCollection, medicalPatientTokenSecret(next.Version), secret); err != nil {
		return nil, err
	}
	if err := overwriteState(ctx, key, next); err != nil {
		return nil, err
	}
	return next, emit(ctx, "MedicalPatientTokenKeyRotated", next)
}

func medicalPatientTokenSecret(version int) string {
	return "medicalPatientTokenSecret-" + strconv.Itoa(version)
}

func readMedicalPatientTokenKey(ctx contractapi.TransactionContextInterface, version int) ([]byte, error) {
	key, err := ctx.GetStub().GetPrivateData(oracleProofCollection, medicalPatientTokenSecret(version))
	if err != nil || version < 1 || len(key) != 32 {
		return nil, fmt.Errorf("pinned patient token key is unavailable")
	}
	return key, nil
}

func medicalPatientToken(key []byte, purpose string, parts ...string) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(canonicalProtocolHash(purpose, parts...)))
	return hex.EncodeToString(mac.Sum(nil))
}
