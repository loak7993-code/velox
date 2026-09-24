// Test 3: detectChallenge + waitForCaptchaToken on the REAL Turnstile page
import velox from './src/index.js';

const px = await velox.proxyForward({
  server: 'http://geo.iproyal.com:12321',
  username: 'V7CPpfXDqljBNFTZ',
  password: 'FzOXHZ1bwTiOyP9R_country-us',
});
const browser = await velox.launch({ headless: true, proxy: px });
const page = await browser.newPage({ stealth: true });

console.log('[load] brightdata signup (the real Turnstile page)…');
await page.goto('https://brightdata.com/cp/signup', { waitUntil: 'interactive', timeout: 60000 });
await new Promise(r => setTimeout(r, 10000));

console.log('\n── [5] detectChallenge() ──');
const info = await page.detectChallenge().catch(e => ({ err: String(e).slice(0, 80) }));
console.log('  ' + JSON.stringify(info, null, 2).split('\n').join('\n  '));

console.log('\n── [6] waitForCaptchaToken() — the exact loop I hand-wrote 4× today ──');
try {
  const token = await page.waitForCaptchaToken(null, { timeout: 45000 });
  console.log('  ✅ TOKEN MINTED:', String(token).slice(0, 50));
} catch (e) {
  console.log('  ⏱ timed out — and it TELLS ME WHY (was a silent null before):');
  console.log('     state:', e.state);
  console.log('     detail:', JSON.stringify(e.detail));
}

console.log('\n── [7] debugDump() — one-call diagnosis ──');
const dump = await page.debugDump('velox-debug/bd').catch(e => ({ err: String(e).slice(0, 60) }));
console.log('  ' + JSON.stringify(dump).slice(0, 300));
await browser.close();
