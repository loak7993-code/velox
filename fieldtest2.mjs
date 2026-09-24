// Test 2: proxyForward (the #2 wall) — authenticated upstream, the case that failed all day
import velox from './src/index.js';

console.log('── [4] proxyForward + authenticated proxy ──');
const px = await velox.proxyForward({
  server: 'http://geo.iproyal.com:12321',
  username: 'V7CPpfXDqljBNFTZ',
  password: 'FzOXHZ1bwTiOyP9R_country-us',
});
console.log('  forwarder:', JSON.stringify(px));

const browser = await velox.launch({ headless: true, proxy: px });
const page = await browser.newPage({ stealth: true });
try {
  await page.goto('https://api.ipify.org', { waitUntil: 'interactive', timeout: 40000 });
  const ip = await page.text('body');
  const geo = await page.eval(`(async () => { try { const r = await fetch('http://ip-api.com/json/${ip}'); const j = await r.json(); return j.country + '/' + j.isp; } catch(e) { return 'geo-err'; } })()`);
  console.log(`  ✅ proxy via forwarder → ${ip} (${geo})`);
} catch (e) {
  console.log(`  ❌ ${String(e).slice(0, 100)}`);
}
await browser.close();
