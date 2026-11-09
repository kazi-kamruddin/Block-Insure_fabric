'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

class OracleThresholdWorkload extends WorkloadModuleBase {
  async submitTransaction() {
    return this.sutAdapter.sendRequests({
      contractId: this.roundArguments.contractId,
      contractFunction: 'EvaluateOracleThreshold',
      contractArguments: [this.roundArguments.responses, String(this.roundArguments.requiredConfirmations)],
      invokerIdentity: 'insurerAdmin',
      readOnly: true,
    });
  }
}

module.exports.createWorkloadModule = () => new OracleThresholdWorkload();
