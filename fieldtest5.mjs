import velox from './src/index.js';
const browser = await velox.launch({ headless: true });
const page = await browser.newPage({ stealth: true });

console.log('── [8] netlog() + response bodies ──');
page.netlog(e => true);   // start collecting
await page.goto('https://httpbin.org/json', { waitUntil: 'interactive' });
await new Promise(r => setTimeout(r, 3000));
const log = page.netlog ? (typeof page.netlog === 'function' ? page.netlog() : null) : null;
console.log('  netlog entries:', Array.isArray(log) ? log.length : typeof log);
if (Array.isArray(log)) {
  const j = log.find(e => /json/i.test(e.url));
  if (j && j.json) {
    const body = await j.json();
    console.log('  ✅ entry.json() works:', JSON.stringify(body).slice(0, 100));
    console.log('  entry fields:', Object.keys(j).join(', '));
  } else if (j) console.log('  entry (no json helper):', Object.keys(j).join(', '));
}

console.log('\n── [9] waitForResponse ──');
try {
  const p = page.waitForResponse ? page.waitForResponse(/json/) : null;
  if (p) { console.log('  ✅ waitForResponse exists'); await p.catch(() => {}); }
  else console.log('  ⚠ not exposed');
} catch (e) { console.log('  err:', String(e).slice(0, 60)); }

console.log('\n── [10] gotoWithRetry ──');
try {
  // deliberately bad host first to exercise retries, then a good one
  const r = await page.gotoWithRetry('https://httpbin.org/headers', { retries: 2, backoff: 300, onAttempt: (i, err) => console.log('    attempt', i, err ? 'err' : 'ok') });
  console.log('  ✅ landed:', (await page.url()).slice(0, 50));
} catch (e) { console.log('  err:', String(e).slice(0, 80)); }

// retry on a genuinely broken host
try {
  await page.gotoWithRetry('https://nonexistent-domain-xyz123.com', { retries: 2, backoff: 200, timeout: 5000 });
  console.log('  ❌ should have thrown');
} catch (e) { console.log('  ✅ bad host thrown after retries:', String(e).slice(0, 60)); }

console.log('\n── [11] importHAR / parseNetscape (bonus) ──');
const fs = await import('node:fs');
try {
  const c = await page.importCurl('a=1; b=2', { domain: 'example.org' });
  console.log('  importCurl:', JSON.stringify(c));
} catch (e) { console.log('  err:', String(e).slice(0, 60)); }

await browser.close();
