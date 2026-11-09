import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function summarizeGoScan(text) {
  const records = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') { if (depth++ === 0) start = index; }
    else if (character === '}') {
      if (--depth < 0) throw new Error('Invalid vulnerability output');
      if (depth === 0) records.push(JSON.parse(text.slice(start, index + 1)));
    } else if (depth === 0 && !/\s/.test(character)) throw new Error('Non-JSON vulnerability output; preserve and inspect scanner failure');
  }
  if (depth || quoted || !records.some(row => row.config?.scanner_name === 'govulncheck')) throw new Error('Incomplete vulnerability scan output');
  const findings = records.filter(row => row.finding).map(row => row.finding);
  const called = [...new Set(findings.filter(row => row.trace?.some(frame => frame.function)).map(row => row.osv))].sort();
  const all = [...new Set(findings.map(row => row.osv))].sort();
  return { status: called.length ? 'FAILED' : 'PASSED', called, all, findingCount: findings.length, config: records.find(row => row.config).config,
    interpretation: 'Called-symbol findings fail this gate. Other module/package findings remain visible. A zero scanner exit in JSON mode alone is not acceptance.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/check-go-vulnerabilities.mjs <completed-govulncheck-json-stream>');
  const summary = summarizeGoScan(readFileSync(file, 'utf8'));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== 'PASSED') process.exitCode = 1;
}
