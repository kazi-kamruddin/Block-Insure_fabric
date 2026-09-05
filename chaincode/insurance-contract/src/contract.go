package insurance

import "github.com/hyperledger/fabric-contract-api-go/v2/contractapi"

type Contract struct {
	contractapi.Contract
}

func (c *Contract) GetSchemaVersion() int {
	return SchemaVersion
}
