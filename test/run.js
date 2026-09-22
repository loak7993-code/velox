// velox :: run.js — run every test suite
import { spawnSync } from 'node:child_process';

const suites = [
  ['smoke (cdp core)', 'test/smoke.js'],
  ['lite + auto engine', 'test/lite.js'],
  ['pool', 'test/pool.js'],
  ['playwright parity', 'test/parity.js'],
];

let failed = 0;
for (const [name, file] of suites) {
  console.log(`\n━━━ ${name} ━━━`);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname });
  if (r.status !== 0) failed++;
}
console.log(`\n${failed === 0 ? 'ALL SUITES PASSED' : failed + ' SUITE(S) FAILED'}`);
process.exit(failed ? 1 : 0);
