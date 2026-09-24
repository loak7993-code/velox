import velox from './src/index.js';
const px = await velox.proxyForward({ server:'http://geo.iproyal.com:12321',
  username:'V7CPpfXDqljBNFTZ', password:'FzOXHZ1bwTiOyP9R_country-us' });
const browser = await velox.launch({ headless: true, proxy: px });
const page = await browser.newPage({ stealth: true });
await page.goto('https://brightdata.com/cp/signup', { waitUntil: 'interactive', timeout: 60000 });

console.log('── detectChallenge over time (same page, snapshot vs poll) ──');
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const info = await page.detectChallenge().catch(e => ({ err: String(e).slice(0, 40) }));
  const inputs = await page.count('input');
  const tsNodes = await page.count('[id^=turnstile]');
  console.log(`  [+${(i+1)*3}s] type=${JSON.stringify(info.type)} tokenPresent=${info.tokenPresent ?? '-'} containerId=${String(info.containerId).slice(0,32)} | inputs=${inputs} tsNodes=${tsNodes}`);
}
await browser.close();
