'use strict';

const { LatencySampledWorkload } = require('./latency-samples.cjs');

class MixedPolicyClaimWorkload extends LatencySampledWorkload {
  constructor() {
    super();
    this.sequence = 0;
  }

  async submitTransaction() {
    this.sequence += 1;
    const fixtureCount = Number(this.roundArguments.fixtureCount ?? 1);
    if (!Number.isInteger(fixtureCount) || fixtureCount < 1 || fixtureCount > 5) throw new Error('fixtureCount must be between 1 and 5');
    const fixture = (this.sequence + this.workerIndex - 1) % fixtureCount + 1;
    const hospital = fixture === 1 ? 'hospital-demo' : `hospital-${fixture}`;
    const policy = fixtureCount === 1 ? 'phase2-load-policy' : `phase2-load-policy-${fixture}`;
    if (this.sequence % 2 === 1) {
      return this.sendMeasured({
        contractId: this.roundArguments.contractId,
        contractFunction: 'ReadPolicy',
        contractArguments: [policy],
        invokerIdentity: 'policyholder1',
        readOnly: true,
      });
    }
    return this.sendMeasured({
      contractId: this.roundArguments.contractId,
      contractFunction: 'SubmitInvoiceClaim',
      contractArguments: [
        `caliper-mixed-claim-${Date.now()}-${this.workerIndex}-${this.sequence}`,
        policy, hospital, `showcase-invoice-${hospital}`,
        '50000', '2026-06-15', 'a'.repeat(64),
      ],
      invokerIdentity: 'policyholder1',
      readOnly: false,
    });
  }
}

module.exports.createWorkloadModule = () => new MixedPolicyClaimWorkload();
