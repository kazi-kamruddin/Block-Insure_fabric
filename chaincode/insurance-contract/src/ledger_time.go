package insurance

import (
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

const ledgerTimeTolerance = 15 * time.Second

var dhakaBusinessZone = time.FixedZone("BDT", 6*3600)

func ledgerNow(ctx contractapi.TransactionContextInterface) (time.Time, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return time.Time{}, fmt.Errorf("read transaction timestamp: %w", err)
	}
	if err := ts.CheckValid(); err != nil {
		return time.Time{}, fmt.Errorf("invalid transaction timestamp: %w", err)
	}
	wallTime := time.Now()
	if clock, ok := ctx.(interface{ ledgerWallTime() time.Time }); ok {
		wallTime = clock.ledgerWallTime()
	}
	txTime := ts.AsTime()
	if txTime.Before(wallTime.Add(-ledgerTimeTolerance)) || txTime.After(wallTime.Add(ledgerTimeTolerance)) {
		return time.Time{}, fmt.Errorf("transaction timestamp outside tolerance")
	}
	return txTime, nil
}

func ledgerTimestamp(ctx contractapi.TransactionContextInterface) (string, error) {
	now, err := ledgerNow(ctx)
	if err != nil {
		return "", err
	}
	return now.Format(time.RFC3339Nano), nil
}

func dhakaDate(t time.Time) string {
	return t.In(dhakaBusinessZone).Format(time.DateOnly)
}
