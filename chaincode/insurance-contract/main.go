package main

import (
	"log"
	"os"
	"runtime/debug"

	"github.com/hyperledger/fabric-chaincode-go/v2/shim"
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

	address, id := os.Getenv("CHAINCODE_SERVER_ADDRESS"), os.Getenv("CHAINCODE_ID")
	if address != "" || id != "" {
		if address == "" || id == "" {
			log.Fatal("CHAINCODE_SERVER_ADDRESS and CHAINCODE_ID must be set together")
		}
		server := &shim.ChaincodeServer{CCID: id, Address: address, CC: chaincode, TLSProps: shim.TLSProperties{Disabled: true}}
		if err := server.Start(); err != nil {
			log.Panicf("start insurance chaincode service: %v", err)
		}
		return
	}
	if err := chaincode.Start(); err != nil {
		log.Panicf("start insurance chaincode: %v", err)
	}
}
