package main

import (
	"log"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
	insurance "github.com/kazi-kamruddin/block-insure-fabric/chaincode/insurance-contract/src"
)

func main() {
	chaincode, err := contractapi.NewChaincode(&insurance.Contract{})
	if err != nil {
		log.Panicf("create insurance chaincode: %v", err)
	}

	if err := chaincode.Start(); err != nil {
		log.Panicf("start insurance chaincode: %v", err)
	}
}
