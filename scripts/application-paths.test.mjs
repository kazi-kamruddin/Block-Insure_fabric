import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { makeApplicationPathsAbsolute } from '../apps/web/scripts/load-environment.mjs';
test('configured workflow recovery root is anchored before standalone cwd changes', () => {
  const previousRoot=process.env.WORKFLOW_OPERATION_ROOT, previousOtp=process.env.OTP_STATE_ROOT;
  try {
    const app=path.join(os.tmpdir(),'synthetic-fabric/apps/web');
    for(const configured of ['../../data/workflow-operations',' ../../data/workflow-operations ']) {
      process.env.WORKFLOW_OPERATION_ROOT=configured;
      makeApplicationPathsAbsolute(app);
      assert.equal(process.env.WORKFLOW_OPERATION_ROOT,path.resolve(app,'../../data/workflow-operations'));
    }
  } finally {
    if(previousRoot===undefined)delete process.env.WORKFLOW_OPERATION_ROOT;else process.env.WORKFLOW_OPERATION_ROOT=previousRoot;
    if(previousOtp===undefined)delete process.env.OTP_STATE_ROOT;else process.env.OTP_STATE_ROOT=previousOtp;
  }
});
