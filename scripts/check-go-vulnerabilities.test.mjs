import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeGoScan } from './check-go-vulnerabilities.mjs';
const config = JSON.stringify({ config: { scanner_name: 'govulncheck' } });
test('called findings fail even when scanner JSON mode exits zero', () => {
  const summary = summarizeGoScan(config + '\n' + JSON.stringify({ finding: { osv: 'GO-synthetic', trace: [{ function: 'Run', package: 'a{b}' }] } }));
  assert.equal(summary.status, 'FAILED'); assert.deepEqual(summary.called, ['GO-synthetic']);
});
test('noncalled findings remain visible and clean streams pass', () => {
  const summary = summarizeGoScan(config + JSON.stringify({ finding: { osv: 'GO-import-only', trace: [{ package: 'unused' }] } }));
  assert.equal(summary.status, 'PASSED'); assert.deepEqual(summary.all, ['GO-import-only']);
  assert.equal(summarizeGoScan(config).status, 'PASSED');
});
test('truncation, provider errors and missing scanner configuration fail closed', () => {
  for (const input of ['{}', config + '{', 'database unavailable\n' + config, config + '\nexit 1']) assert.throws(() => summarizeGoScan(input));
});
