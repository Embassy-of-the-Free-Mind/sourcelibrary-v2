// Cross-browser, cross-size QA of the articles work. Writes qa-report.json and screenshots.
import { chromium, webkit, firefox } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:3466';
const OUT = process.argv[2];
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

const ARTICLES = [
  'ledgers-and-heavens', 'harmonic-justice', 'maya-ritual-in-the-colonial-dictionaries', 'preserved-by-enemies', 'hyperborea',
  'shipwrecks-and-buried-treasure', 'trees-of-life', 'one-sentence-of-hermes', 'four-commentaries-on-nothing', 'what-the-models-cannot-name',
  'drebbel', 'training-our-own-models', 'archive-ocr-against-proofread-pages', 'how-we-measure-ocr-quality', 'techniques-of-the-body',
];
const LISTINGS = ['/articles', '/articles/research', '/articles/page/2'];
const ALL = [...LISTINGS, ...ARTICLES.map((s) => `/articles/${s}`)];
const SAMPLE = ['/articles', '/articles/ledgers-and-heavens', '/articles/hyperborea', '/articles/drebbel', '/articles/techniques-of-the-body', '/articles/what-the-models-cannot-name'];

const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, mobile: true },
  tablet: { viewport: { width: 820, height: 1180 }, mobile: true },
  laptop: { viewport: { width: 1280, height: 800 }, mobile: false },
  desktop: { viewport: { width: 1920, height: 1080 }, mobile: false },
};
const RUNS = [
  { name: 'chrome', type: chromium, launch: { channel: 'chrome' }, sizes: ['phone', 'tablet', 'laptop', 'desktop'], pages: ALL },
  { name: 'webkit', type: webkit, launch: {}, sizes: ['phone', 'desktop'], pages: SAMPLE },
  { name: 'firefox', type: firefox, launch: {}, sizes: ['phone', 'desktop'], pages: SAMPLE },
];
// Noise that isn't ours: analytics, extensions, dev-only HMR chatter.
const IGNORE = /googletagmanager|gtag|analytics|favicon|Download the React DevTools|\[HMR\]|\[Fast Refresh\]|webpack-hmr|ERR_BLOCKED_BY_CLIENT|net::ERR_ABORTED/i;

const report = [];
for (const run of RUNS) {
  const browser = await run.type.launch(run.launch);
  for (const sizeName of run.sizes) {
    const size = SIZES[sizeName];
    const ctxOpts = { viewport: size.viewport };
    if (size.mobile && run.name !== 'firefox') Object.assign(ctxOpts, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const ctx = await browser.newContext(ctxOpts);
    // Dismiss the cookie banner so it doesn't sit in every screenshot.
    await ctx.addInitScript(() => { try { localStorage.setItem('sl_analytics_consent', 'declined'); } catch {} });
    for (const path of run.pages) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
      page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });
      const row = { browser: run.name, size: sizeName, path, errors };
      try {
        const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 240000 });
        row.status = res?.status();
        const slug = path.replace(/\//g, '_').replace(/^_/, '');
        await page.screenshot({ path: `${OUT}/shots/${run.name}-${sizeName}-${slug}-top.png` });
        // Scroll the whole page so lazy pictures load.
        await page.evaluate(async () => {
          const step = window.innerHeight * 0.8;
          for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        });
        await page.waitForTimeout(2500);
        Object.assign(row, await page.evaluate(() => {
          const doc = document.documentElement;
          const wide = [...document.querySelectorAll('body *')].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.right > window.innerWidth + 2 && r.width > 0 && getComputedStyle(el).position !== 'fixed' && !el.closest('[style*="overflow"], .overflow-x-auto, .overflow-hidden, .overflow-x-scroll');
          }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
          const imgs = [...document.querySelectorAll('main img, article img')];
          const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.getAttribute('src').slice(0, 120));
          return {
            hscroll: doc.scrollWidth > window.innerWidth + 1,
            scrollWidth: doc.scrollWidth,
            wide,
            h1: document.querySelectorAll('h1').length,
            images: imgs.length,
            broken,
          };
        }));
        // Mid-page screenshot for review.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.35));
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/shots/${run.name}-${sizeName}-${slug}-mid.png` });
        // Lightbox on article pages.
        if (path.split('/').length === 3 && !/^\/articles\/(research|page)/.test(path) && path !== '/articles') {
          const target = page.locator('.article-page main figure img').first();
          if (await target.count()) {
            await target.scrollIntoViewIfNeeded();
            await target.click({ timeout: 10000 });
            const open = await page.locator('[aria-label="Pictures in this article"]').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
            row.lightbox = open;
            if (open) {
              await page.waitForTimeout(1500);
              await page.screenshot({ path: `${OUT}/shots/${run.name}-${sizeName}-${slug}-lightbox.png` });
              await page.keyboard.press('Escape');
            }
          } else row.lightbox = 'no figure';
        }
      } catch (e) {
        row.fail = String(e).slice(0, 300);
      }
      report.push(row);
      fs.writeFileSync(`${OUT}/qa-report.json`, JSON.stringify(report, null, 1));
      console.log(`${run.name} ${sizeName} ${path} ${row.status ?? ''} hscroll=${row.hscroll} broken=${row.broken?.length ?? '?'} errors=${errors.length} lightbox=${row.lightbox ?? '-'}${row.fail ? ' FAIL ' + row.fail.slice(0, 80) : ''}`);
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
}
console.log('done', report.length);
