#!/usr/bin/env node
/**
 * Site-wide blurry-image sweep.
 *
 * Visits a set of public surfaces with a headless retina viewport (DPR 2),
 * scrolls to trigger lazy-loading, then in each page flags every <img> the
 * browser is UPSCALING — intrinsic pixels (naturalWidth) below the displayed
 * size × DPR. Those render soft/blurry. Aggregates a ranked report by URL and
 * by image, so you can see which surfaces and which sources are worst.
 *
 * This is the automated, multi-page version of scripts/maintenance/blurry-image-audit.js
 * (the paste-into-console one-pager).
 *
 * Usage (resolves playwright from the main checkout's node_modules):
 *   node scripts/tools/blurry-image-sweep.mjs
 *   node scripts/tools/blurry-image-sweep.mjs https://sourcelibrary.org/gallery https://sourcelibrary.org/book/<slug>
 *   RATIO=0.5 node scripts/tools/blurry-image-sweep.mjs       # stricter (only badly upscaled)
 *   OUT=/tmp/blur.json node scripts/tools/blurry-image-sweep.mjs
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const RATIO = parseFloat(process.env.RATIO || '0.66'); // intrinsic must be >= RATIO * shownPx*DPR
const DPR = parseFloat(process.env.DPR || '2');        // emulate Retina (worst case)
const OUT = process.env.OUT || '/tmp/blurry-image-sweep.json';

const DEFAULT_URLS = [
  'https://sourcelibrary.org/',
  'https://sourcelibrary.org/gallery',
  'https://sourcelibrary.org/browse/title',
  'https://sourcelibrary.org/browse/author',
  'https://sourcelibrary.org/collections',
  'https://sourcelibrary.org/book/books-of-alchemy-geber',
  'https://sourcelibrary.org/book/splendor-solis-the-splendour-of-the-sun-trismosin',
];

const urls = process.argv.slice(2).filter(a => a.startsWith('http'));
const targets = urls.length ? urls : DEFAULT_URLS;

// Runs in the page. Flags upscaled <img>s. (Playwright passes a single arg.)
function auditInPage({ ratio, dpr }) {
  const rows = [];
  for (const img of document.querySelectorAll('img')) {
    const cssW = img.clientWidth;
    if (!cssW || !img.naturalWidth) continue;
    const needed = cssW * dpr;
    const r = img.naturalWidth / needed;
    if (r < ratio) {
      rows.push({
        upscale: +(needed / img.naturalWidth).toFixed(2),
        shownPx: Math.round(cssW),
        intrinsicPx: img.naturalWidth,
        src: (img.currentSrc || img.src || '').slice(0, 160),
        alt: (img.alt || '').slice(0, 50),
      });
    }
  }
  return rows;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = () => {
        window.scrollBy(0, 800);
        y += 800;
        if (y >= document.body.scrollHeight - window.innerHeight) return resolve();
        setTimeout(step, 250);
      };
      step();
    });
  });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
const report = [];

for (const url of targets) {
  const page = await ctx.newPage();
  let rows = [];
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await autoScroll(page);
    await page.waitForTimeout(1500); // let lazy images settle
    rows = await page.evaluate(auditInPage, { ratio: RATIO, dpr: DPR });
  } catch (e) {
    console.log(`  ✗ ${url} — ${e.message.split('\n')[0]}`);
  }
  rows.sort((a, b) => b.upscale - a.upscale);
  report.push({ url, blurry: rows.length, worst: rows.slice(0, 15) });
  console.log(`${rows.length.toString().padStart(4)} blurry  ${url}`);
  await page.close();
}

await browser.close();

writeFileSync(OUT, JSON.stringify({ ratio: RATIO, dpr: DPR, generated: new Date().toISOString(), report }, null, 2));
console.log(`\n— worst offenders —`);
const all = report.flatMap(r => r.worst.map(w => ({ ...w, url: r.url })));
all.sort((a, b) => b.upscale - a.upscale);
for (const w of all.slice(0, 20)) {
  console.log(`  ${String(w.upscale).padStart(5)}x  ${w.intrinsicPx}px→${w.shownPx}px  ${w.src}`);
}
console.log(`\nfull report: ${OUT}`);
