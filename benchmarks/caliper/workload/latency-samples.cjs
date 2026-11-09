'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

class LatencySampledWorkload extends WorkloadModuleBase {
  async initializeWorkloadModule(...args) {
    await super.initializeWorkloadModule(...args);
    this.latencySamples = [];
  }

  async sendMeasured(request) {
    const started = process.hrtime.bigint();
    let error = false;
    try {
      return await this.sutAdapter.sendRequests(request);
    } catch (cause) {
      error = true;
      throw cause;
    } finally {
      this.latencySamples.push({
        function: request.contractFunction,
        readOnly: request.readOnly,
        elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
        threw: error,
      });
    }
  }

  async cleanupWorkloadModule() {
    const runId = process.env.CALIPER_PHASE2_RUN_ID ?? 'manual';
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid CALIPER_PHASE2_RUN_ID');
    const folder = path.resolve('docs/results/phase2-caliper/samples');
    fs.mkdirSync(folder, { recursive: true });
    const filename = path.join(folder, `${runId}-round${this.roundIndex}-worker${this.workerIndex}.json`);
    fs.writeFileSync(filename, `${JSON.stringify({ runId, roundIndex: this.roundIndex, workerIndex: this.workerIndex, samples: this.latencySamples })}\n`);
    await super.cleanupWorkloadModule();
  }
}

module.exports = { LatencySampledWorkload };
