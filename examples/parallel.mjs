// velox :: examples — scrape 50 pages in parallel with the auto engine
import velox from '../src/index.js';

const URLs = Array.from({ length: 50 }, (_, i) => `https://example.com/?page=${i + 1}`);

const pool = new velox.Pool({
  browsers: 4,            // up to 4 browser processes
  pagesPerBrowser: 4,     // 16 concurrent pages
  pageOpts: { ads: true, stealth: true },
});

const t0 = Date.now();
const data = await pool.map(URLs, async (url, page) => {
  const s = await velox.open(url, { browser: page.browser, engine: 'auto' }).catch(() => null);
  if (!s) return { url, error: true };
  return { url, title: await s.title(), h1: await s.text('h1') };
}, { concurrency: 16 });

console.log(`${data.length} pages in ${Date.now() - t0}ms`);
console.log('sample:', data[0]);
await pool.close();
