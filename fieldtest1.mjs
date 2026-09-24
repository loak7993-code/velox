// Test 1: the eval fix (the #1 wall) + waitForLoadState + importSession
import velox from './src/index.js';

const browser = await velox.launch({ headless: true });
const page = await browser.newPage({ stealth: true });
await page.goto('https://example.com', { waitUntil: 'load' });
console.log('── [1] eval serialization (was silent {} all day) ──');
const cases = [
  ["string primitive      ", `'hello'`],
  ["number primitive      ", `42`],
  ["array                 ", `[1,2,3]`],
  ["object                ", `({a:1, b:'two'})`],
  ["nested object         ", `({x:{y:[1,2,{z:'deep'}]}})`],
  ["boolean               ", `true`],
  ["null                  ", `null`],
  ["document.title        ", `document.title`],
  ["body.innerText.length ", `document.body.innerText.length`],
  ["script count          ", `document.scripts.length`],
  ["Object.keys(doc)      ", `Object.keys(document).length`],
  ["function-form         ", `() => document.title`],
  ["querySelectorAll len  ", `document.querySelectorAll('a').length`],
  ["map -> array of strs  ", `Array.from(document.querySelectorAll('a')).map(a => a.href)`],
];
let pass = 0;
for (const [label, expr] of cases) {
  try {
    const v = await page.eval(expr);
    const good = v !== undefined && JSON.stringify(v) !== '{}' && v !== null && v !== '' || expr.includes('null');
    console.log(`  ${good ? '✅' : '❌'} ${label} → ${JSON.stringify(v)?.slice(0, 60)}`);
    if (good) pass++;
  } catch (e) {
    console.log(`  ❌ ${label} → ERR ${String(e).slice(0, 50)}`);
  }
}
console.log(`  ${pass}/${cases.length} eval cases OK`);

console.log('\n── [2] waitForLoadState alias ──');
try {
  if (typeof page.waitForLoadState === 'function') {
    await page.waitForLoadState('load', 5000);
    console.log('  ✅ waitForLoadState exists and ran');
  } else console.log('  ❌ still missing');
} catch (e) { console.log('  ⚠ exists but:', String(e).slice(0, 60)); }

console.log('\n── [3] importSession / importCurl (domain normalization) ──');
try {
  // THE bug from today: bare domain 'amazon.com' vs request to www.amazon.com
  const res = await page.importSession([
    { name: 'a_bare', value: 'v1', domain: 'example.com' },
    { name: 'b_dotted', value: 'v2', domain: '.example.com' },
    { name: 'c_url', value: 'v3', url: 'https://example.com/path' },
    { name: 'c_url', value: 'v3b', url: 'https://example.com/path' },   // dupe → later wins
    { name: 'd_nodomain', value: 'v4' },
  ]);
  console.log('  result:', JSON.stringify(res).slice(0, 250));
} catch (e) { console.log('  ❌', String(e).slice(0, 80)); }
try {
  const c = await page.importCurl('cookie: x=1; y=2; z=3', { domain: 'example.com' });
  console.log('  importCurl:', JSON.stringify(c).slice(0, 150));
} catch (e) { console.log('  importCurl err:', String(e).slice(0, 80)); }

await browser.close();
