'use strict';

const { LatencySampledWorkload } = require('./latency-samples.cjs');

class RegistryWriteWorkload extends LatencySampledWorkload {
  constructor() {
    super();
    this.sequence = 0;
  }

  async submitTransaction() {
    this.sequence += 1;
    const unique = `${Date.now()}-${this.workerIndex}-${this.sequence}`;
    return this.sendMeasured({
      contractId: this.roundArguments.contractId,
      contractFunction: 'PublishOracleRegistrySnapshot',
      contractArguments: [
        `caliper-registry-${unique}`, '1', 'a'.repeat(64), `rules-${unique}`,
        'b'.repeat(64), '1',
      ],
      invokerIdentity: 'insurerAdmin',
      readOnly: false,
    });
  }
}

module.exports.createWorkloadModule = () => new RegistryWriteWorkload();
