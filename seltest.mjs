import velox from './src/index.js';
const px = await velox.proxyForward({ server:'http://geo.iproyal.com:12321',
  username:'V7CPpfXDqljBNFTZ', password:'FzOXHZ1bwTiOyP9R_country-us' });
const browser = await velox.launch({ headless: true, proxy: px });
const page = await browser.newPage({ stealth: true });
await page.goto('https://brightdata.com/cp/signup', { waitUntil: 'interactive', timeout: 60000 });
await new Promise(r => setTimeout(r, 12000));

console.log('── selector-engine vs native querySelector ──\n');
const sels = [
  '[id^="turnstile_container"]',          // prefix attr  ← in the WIDGETS table
  '[id^=turnstile_container]',            // prefix attr, unquoted
  '.cf-turnstile',
  '[class*="turnstile"]',                 // substring attr
  'iframe[src*="challenges.cloudflare.com"]',
  'input[name="cf-turnstile-response"]',  // exact attr
  'input',                                 // plain tag
  '[id]',                                  // raw attr presence
];
for (const s of sels) {
  const vCount = await page.count(s).catch(e => 'ERR:' + String(e).slice(0, 30));
  const native = await page.eval(`document.querySelectorAll(${JSON.stringify(s)}).length`).catch(() => 'evalerr');
  const match = vCount === native ? '✅' : '❌ MISMATCH';
  console.log(`  ${match}  velox.count=${String(vCount).padEnd(6)} native=${String(native).padEnd(6)} ${s}`);
}
await browser.close();
