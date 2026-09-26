'use strict';

const { LatencySampledWorkload } = require('./latency-samples.cjs');

class MixedPolicyClaimWorkload extends LatencySampledWorkload {
  constructor() {
    super();
    this.sequence = 0;
  }

  async submitTransaction() {
    this.sequence += 1;
    if (this.sequence % 2 === 1) {
      return this.sendMeasured({
        contractId: this.roundArguments.contractId,
        contractFunction: 'ReadPolicy',
        contractArguments: ['phase2-load-policy'],
        invokerIdentity: 'policyholder1',
        readOnly: true,
      });
    }
    return this.sendMeasured({
      contractId: this.roundArguments.contractId,
      contractFunction: 'SubmitInvoiceClaim',
      contractArguments: [
        `caliper-mixed-claim-${Date.now()}-${this.workerIndex}-${this.sequence}`,
        'phase2-load-policy', 'hospital-demo', 'showcase-invoice-hospital-1',
        '50000', '2026-06-15', 'a'.repeat(64),
      ],
      invokerIdentity: 'policyholder1',
      readOnly: false,
    });
  }
}

module.exports.createWorkloadModule = () => new MixedPolicyClaimWorkload();
