// velox :: pool test — parallel scraping across pre-warmed pages
import { Pool } from '../src/pool.js';
import { startSite } from './site/serve.js';

const site = await startSite();
const SITE = site.url;
const pool = new Pool({
  browsers: 2, pagesPerBrowser: 2,
  launch: { executablePath: process.env.VLOX_EXE },
  pageOpts: {},
});

const urls = ['/page2.html', '/frame.html', '/', '/page2.html', '/', '/frame.html', '/', '/page2.html'];
const t0 = Date.now();
const titles = await pool.map(urls, (u, page) => page.goto(SITE + u, { waitUntil: 'interactive' }).then(() => page.title()));
const ms = Date.now() - t0;
console.log('titles:', titles);
console.log(`8 pages in parallel: ${ms}ms  (metrics: ${JSON.stringify(pool.metrics)})`);
await pool.close();
site.server.close();

const ok = titles.every((t) => ['Velox Test Site', 'Page Two', 'Frame Page'].includes(t));
console.log(ok && pool.metrics.created === 4 ? 'POOL OK' : 'POOL FAIL');
process.exit(ok ? 0 : 1);
