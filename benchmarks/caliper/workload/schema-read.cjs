'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

class SchemaReadWorkload extends WorkloadModuleBase {
  async submitTransaction() {
    return this.sutAdapter.sendRequests({
      contractId: this.roundArguments.contractId,
      contractFunction: 'GetSchemaVersion',
      contractArguments: [],
      invokerIdentity: 'insurerAdmin',
      readOnly: true,
    });
  }
}

module.exports.createWorkloadModule = () => new SchemaReadWorkload();
