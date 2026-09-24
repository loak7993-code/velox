// Diagnostic: WHY detectChallenge missed it + what the Turnstile DOM really looks like
import velox from './src/index.js';
const px = await velox.proxyForward({ server:'http://geo.iproyal.com:12321',
  username:'V7CPpfXDqljBNFTZ', password:'FzOXHZ1bwTiOyP9R_country-us' });
const browser = await velox.launch({ headless: true, proxy: px });
const page = await browser.newPage({ stealth: true });
await page.goto('https://brightdata.com/cp/signup', { waitUntil: 'interactive', timeout: 60000 });
await new Promise(r => setTimeout(r, 12000));

// what actually exists in the DOM?
const dom = await page.eval(`(() => {
  const nodes = document.querySelectorAll('iframe, [class*=captcha], [id^=turnstile], [id*=turnstile], [class*=turnstile], [id^=g-recaptcha], [id^=hcaptcha], [id^=arkose], [id^=awswaf]');
  return Array.from(nodes).map(n => ({ tag:n.tagName, id:n.id||null, cls:(n.className||'').toString().slice(0,50) }));
})()`);
console.log('WIDGET NODES:', JSON.stringify(dom, null, 1));
const scripts = await page.eval(`Array.from(document.scripts).map(s=>s.src).filter(Boolean)`);
console.log('\nSCRIPTS:', JSON.stringify(scripts).slice(0, 400));
const tsApi = await page.eval(`typeof window.turnstile`);
console.log('\nwindow.turnstile:', tsApi);
const token = await page.eval(`(document.querySelector('input[name="cf-turnstile-response"]')||{}).value`);
console.log('token field value:', JSON.stringify(token));
// is the widget container really built out?
const inner = await page.eval(`(() => { const c = document.querySelector('[id^=turnstile]'); return c ? { id:c.id, html:(c.innerHTML||'').length, childEls:c.children.length } : null; })()`);
console.log('container:', JSON.stringify(inner));
await browser.close();
