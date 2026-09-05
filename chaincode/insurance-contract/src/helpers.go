package insurance

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$`)

func requireIdentity(ctx contractapi.TransactionContextInterface, mspID, role string) (string, error) {
	identity := ctx.GetClientIdentity()
	actualMSP, err := identity.GetMSPID()
	if err != nil {
		return "", fmt.Errorf("read caller MSP: %w", err)
	}
	if actualMSP != mspID {
		return "", fmt.Errorf("access denied: caller MSP %s is not %s", actualMSP, mspID)
	}
	actualRole, found, err := identity.GetAttributeValue("role")
	if err != nil {
		return "", fmt.Errorf("read caller role: %w", err)
	}
	if !found || actualRole != role {
		return "", fmt.Errorf("access denied: %s role is required", role)
	}
	callerID, err := identity.GetID()
	if err != nil {
		return "", fmt.Errorf("read caller identity: %w", err)
	}
	return callerID, nil
}

func callerSubject(ctx contractapi.TransactionContextInterface) (string, error) {
	if subject, found, err := ctx.GetClientIdentity().GetAttributeValue("subjectId"); err != nil {
		return "", fmt.Errorf("read subjectId: %w", err)
	} else if found && strings.TrimSpace(subject) != "" {
		return subject, nil
	}
	return ctx.GetClientIdentity().GetID()
}

func timestamp(ctx contractapi.TransactionContextInterface) (string, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return "", fmt.Errorf("read transaction timestamp: %w", err)
	}
	return time.Unix(ts.Seconds, int64(ts.Nanos)).UTC().Format(time.RFC3339Nano), nil
}

func stateKey(ctx contractapi.TransactionContextInterface, assetType, id string) (string, error) {
	if !idPattern.MatchString(id) {
		return "", fmt.Errorf("invalid %s id %q", assetType, id)
	}
	return ctx.GetStub().CreateCompositeKey(assetType, []string{id})
}

func decisionKey(ctx contractapi.TransactionContextInterface, claimID, auditorID string) (string, error) {
	return ctx.GetStub().CreateCompositeKey("auditorDecision", []string{claimID, auditorID})
}

func getState[T any](ctx contractapi.TransactionContextInterface, assetType, id string) (*T, error) {
	key, err := stateKey(ctx, assetType, id)
	if err != nil {
		return nil, err
	}
	payload, err := ctx.GetStub().GetState(key)
	if err != nil {
		return nil, fmt.Errorf("read %s %s: %w", assetType, id, err)
	}
	if payload == nil {
		return nil, fmt.Errorf("%s %s does not exist", assetType, id)
	}
	var value T
	if err := json.Unmarshal(payload, &value); err != nil {
		return nil, fmt.Errorf("decode %s %s: %w", assetType, id, err)
	}
	return &value, nil
}

func listState[T any](ctx contractapi.TransactionContextInterface, assetType string) ([]T, error) {
	iterator, err := ctx.GetStub().GetStateByPartialCompositeKey(assetType, []string{})
	if err != nil {
		return nil, fmt.Errorf("list %s assets: %w", assetType, err)
	}
	defer iterator.Close()

	values := make([]T, 0)
	for iterator.HasNext() {
		entry, err := iterator.Next()
		if err != nil {
			return nil, fmt.Errorf("iterate %s assets: %w", assetType, err)
		}
		var value T
		if err := json.Unmarshal(entry.Value, &value); err != nil {
			return nil, fmt.Errorf("decode %s asset: %w", assetType, err)
		}
		values = append(values, value)
	}
	return values, nil
}

func putState(ctx contractapi.TransactionContextInterface, assetType, id string, value any) error {
	key, err := stateKey(ctx, assetType, id)
	if err != nil {
		return err
	}
	existing, err := ctx.GetStub().GetState(key)
	if err != nil {
		return fmt.Errorf("check %s %s: %w", assetType, id, err)
	}
	if existing != nil {
		return fmt.Errorf("%s %s already exists", assetType, id)
	}
	return overwriteState(ctx, key, value)
}

func overwriteAsset(ctx contractapi.TransactionContextInterface, assetType, id string, value any) error {
	key, err := stateKey(ctx, assetType, id)
	if err != nil {
		return err
	}
	return overwriteState(ctx, key, value)
}

func overwriteState(ctx contractapi.TransactionContextInterface, key string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode state: %w", err)
	}
	if err := ctx.GetStub().PutState(key, payload); err != nil {
		return fmt.Errorf("write state: %w", err)
	}
	return nil
}

func emit(ctx contractapi.TransactionContextInterface, name string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode %s event: %w", name, err)
	}
	if err := ctx.GetStub().SetEvent(name, payload); err != nil {
		return fmt.Errorf("emit %s event: %w", name, err)
	}
	return nil
}

func validateHash(field, value string) error {
	if len(value) != 64 {
		return fmt.Errorf("%s must be a 64-character SHA-256 hex value", field)
	}
	if _, err := hex.DecodeString(value); err != nil {
		return fmt.Errorf("%s must be valid hexadecimal", field)
	}
	return nil
}

func validateDate(field, value string) (time.Time, error) {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return time.Time{}, fmt.Errorf("%s must use YYYY-MM-DD", field)
	}
	return parsed, nil
}
