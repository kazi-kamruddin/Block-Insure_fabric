package main

import (
	"testing"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
	insurance "github.com/kazi-kamruddin/block-insure-fabric/chaincode/insurance-contract/src"
)

func TestContractMetadataIsValid(t *testing.T) {
	if _, err := contractapi.NewChaincode(&insurance.Contract{}); err != nil {
		t.Fatalf("contract metadata is invalid: %v", err)
	}
}
