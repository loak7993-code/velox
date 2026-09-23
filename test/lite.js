// velox :: lite engine + auto-escalation tests
import velox from '../src/index.js';
import { startSite } from './site/serve.js';

const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond]);
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${cond ? '' : '  — ' + extra}`);
};

const site = await startSite();
const SITE = site.url;

// 1. raw lite fetch
const res = await velox.fetch(`${SITE}/page2.html`);
check('lite fetch status', res.status === 200);
check('lite fetch title', res.title() === 'Page Two');
check('lite fetch dom', res.doc.select('h1').textContent() === 'Second page');

// 2. parser selectors
const idx = await velox.fetch(SITE);
check('parser css', idx.doc.text('h1') === 'Welcome to Velox');
check('parser id', idx.doc.text('#main-title') === 'Welcome to Velox');
check('parser class list', idx.doc.selectAll('li.item').length === 3);
check('parser attr', idx.doc.attr('a', 'href') === '/page2.html');
check('parser tables', idx.doc.tables()[0].rows.length === 2);
check('parser forms', idx.doc.forms()[0].fields.length >= 3);
check('parser meta', idx.doc.meta().description === 'a page built to exercise velox');
check('parser jsonld', idx.doc.jsonld()[0]['@type'] === 'WebSite');
check('parser links resolved absolute', idx.doc.links(SITE)[0].href.startsWith('http://127.0.0.1'));
check('parser images', idx.doc.images().some((i) => i.src.includes('logo.svg')));
check('parser readable', idx.doc.readable().includes('# Welcome to Velox'));

// 3. gzip/redirects/cookies through the lite client
const redir = await velox.fetch(`${SITE}/redirect.html`);
check('lite redirects', redir.status === 200 && redir.url.endsWith('page2.html'), redir.url);

// 4. needsJS heuristics
check('needsJS: static page false', velox.needsJS(idx) === false);
const spa = await velox.fetch(`${SITE}/spa.html`);
check('needsJS: SPA shell true', velox.needsJS(spa) === true);

// 5. auto engine: static stays lite
const liteSession = await velox.open(SITE, { engine: 'auto', executablePath: process.env.VLOX_EXE || process.env.VELOX_BROWSER });
check('auto: static stays lite', liteSession.engine === 'lite');
check('auto: lite data methods', liteSession.title() === 'Velox Test Site');
check('auto: lite $()', (await liteSession.$('h1').text()) === 'Welcome to Velox');

// 6. auto engine: SPA escalates to browser
const spaSession = await velox.open(`${SITE}/spa.html`, { engine: 'auto', executablePath: process.env.VLOX_EXE || process.env.VELOX_BROWSER });
check('auto: SPA escalates', spaSession.engine === 'cdp', `engine=${spaSession.engine}`);
const jsContent = await spaSession.waitForSelector('#js-done', { timeout: 5000 }).then(() => spaSession.text('#js-done')).catch(() => null);
check('auto: JS content rendered', jsContent === 'spa content ready', String(jsContent));
await spaSession.close();

// 7. lite session transparent upgrade on browser op
const s2 = await velox.open(SITE, { engine: 'auto', executablePath: process.env.VLOX_EXE || process.env.VELOX_BROWSER });
check('upgrade starts lite', s2.engine === 'lite');
const shot = await s2.screenshot({ full: true });   // browser op → escalates
check('transparent upgrade screenshot', s2.engine === 'cdp' && shot.length > 3000, `${s2.engine}, ${shot.length}b`);
check('upgraded page works', (await s2.title()) === 'Velox Test Site');
await s2.close();

// 8. scrape one-shot
const data = await velox.scrape(SITE, { recipe: 'meta' });
check('scrape(meta)', data.title === 'Velox Test Site' && data.description.includes('velox'));

// 9. forced lite engine never launches a browser
const forced = await velox.open(SITE, { engine: 'lite' });
check('forced lite', forced.engine === 'lite');

site.server.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
