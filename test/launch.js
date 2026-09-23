// velox :: launch.js — launch behaviour: browser resolution + sandbox self-healing
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${cond ? '' : '  — ' + extra}`);
};

const STUB = '/tmp/vx-stub-browser.sh';
const LOG = '/tmp/vx-stub-log';
const N = '/tmp/vx-stub-n';

// ── 1. a browser that fails with Chrome's "No usable sandbox" error must be
//       relaunched automatically with --no-sandbox (CI, Docker, Ubuntu 23.10+, WSL)
writeFileSync(STUB, `#!/bin/bash
echo "$*" >> ${LOG}
n=$(cat ${N} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${N}
if [ $n -eq 1 ]; then
  echo "[0923/122209:FATAL:content/browser/zygote_host/zygote_host_impl_linux.cc:129] No usable sandbox! If you are running on Ubuntu 23.10+" >&2
  exit 1
fi
echo "second attempt alive" >&2
sleep 20
`, { mode: 0o755 });
rmSync(LOG, { force: true }); rmSync(N, { force: true });

spawnSync(process.execPath, ['-e', `
  import('./src/index.js').then(async (m) => {
    try { await m.default.launch({ executablePath: '${STUB}', timeout: 2500 }); } catch {}
    process.exit(0);
  });
`], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, VELOX_NO_SANDBOX: '' } });

const attempts = existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n') : [];
check('sandbox failure triggers a retry', attempts.length === 2, `${attempts.length} attempt(s)`);
check('retry adds --no-sandbox', attempts[1]?.includes('--no-sandbox'), attempts[1] || '');
rmSync(STUB, { force: true }); rmSync(LOG, { force: true }); rmSync(N, { force: true });

// ── 2. VELOX_BROWSER must be honoured even though opts.browser defaults to 'auto'
const probe = spawnSync(process.execPath, ['-e', `
  import('./src/cdp/discovery.js').then(({ findBrowser }) => {
    process.stdout.write(findBrowser(process.env.VELOX_BROWSER || 'auto'));
  });
`], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, VELOX_BROWSER: '/bin/sh' }, encoding: 'utf8' });
check('VELOX_BROWSER resolves to the pinned binary', probe.stdout?.includes('/bin/sh'), probe.stdout);

// ── 3. discovery never returns something non-executable
const { discoverBrowsers } = await import('../src/cdp/discovery.js');
const found = discoverBrowsers();
check('discovery returns only executable paths', found.every((b) => existsSync(b.path)), JSON.stringify(found.map((f) => f.name)));

const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
