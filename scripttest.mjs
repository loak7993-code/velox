import velox from './src/index.js';
const px = await velox.proxyForward({ server:'http://geo.iproyal.com:12321',
  username:'V7CPpfXDqljBNFTZ', password:'FzOXHZ1bwTiOyP9R_country-us' });
const browser = await velox.launch({ headless: true, proxy: px });
const page = await browser.newPage({ stealth: true });
await page.goto('https://brightdata.com/cp/signup', { waitUntil: 'interactive', timeout: 60000 });
await new Promise(r => setTimeout(r, 20000));

const api = await page.eval(`({ turnstile: typeof window.turnstile, recaptcha: typeof window.grecaptcha, hcaptcha: typeof window.hcaptcha })`);
const srcs = await page.eval(`Array.from(document.scripts).map(s=>s.src||'').filter(Boolean)`);
const regexHit = await page.eval(`Array.from(document.scripts).some(s => /captcha|turnstile|recaptcha|hcaptcha|arkose|waf|px-cloud/i.test(s.src||''))`);
const cfScripts = srcs.filter(s => /cloudflare|turnstile/i.test(s));
console.log('window APIs:', JSON.stringify(api));
console.log('script src regex hit  :', regexHit, '  ← what detectChallenge/waitForCaptchaToken use');
console.log('actual cloudflare cf scripts in DOM:', JSON.stringify(cfScripts));
console.log('total scripts:', srcs.length);
console.log('\n→ window.turnstile =', api.turnstile, '| src-scan finds it:', cfScripts.length > 0);
await browser.close();
