package main

import (
	"log"
	"os"
	"runtime/debug"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
	insurance "github.com/kazi-kamruddin/block-insure-fabric/chaincode/insurance-contract/src"
)

func main() {
	// Give peer-launched chaincode a soft memory target on the shared dev-lite host.
	if _, configured := os.LookupEnv("GOMEMLIMIT"); !configured {
		debug.SetMemoryLimit(192 << 20)
	}

	chaincode, err := contractapi.NewChaincode(&insurance.Contract{})
	if err != nil {
		log.Panicf("create insurance chaincode: %v", err)
	}

	if err := chaincode.Start(); err != nil {
		log.Panicf("start insurance chaincode: %v", err)
	}
}
