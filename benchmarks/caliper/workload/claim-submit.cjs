'use strict';

const { LatencySampledWorkload } = require('./latency-samples.cjs');

class ClaimSubmitWorkload extends LatencySampledWorkload {
  constructor() {
    super();
    this.sequence = 0;
  }

  async submitTransaction() {
    this.sequence += 1;
    const id = `caliper-claim-${Date.now()}-${this.workerIndex}-${this.sequence}`;
    return this.sendMeasured({
      contractId: this.roundArguments.contractId,
      contractFunction: 'SubmitInvoiceClaim',
      contractArguments: [
        id, 'phase2-load-policy', 'hospital-demo', 'showcase-invoice-hospital-demo',
        '50000', '2026-06-15', 'a'.repeat(64),
      ],
      invokerIdentity: 'policyholder1',
      readOnly: false,
    });
  }
}

module.exports.createWorkloadModule = () => new ClaimSubmitWorkload();
