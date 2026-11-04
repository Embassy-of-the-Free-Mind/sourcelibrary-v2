#!/usr/bin/env node
// PRIOR ART: scripts/audit/embed-link-leaks.mjs — fetches embed HTML and checks links; a layout loop only exists in a browser, in a frame that resizes.
//
// Does a partner page settle at a sane height inside a frame that fits its content?
// Loads each path in a real iframe under a host that behaves like public/embed/v1.js,
// and fails if the frame ends up far taller than the same page in a normal window,
// or if the book hero is far taller than a window.
//
//   node scripts/audit/embed-frame-height.mjs [--base https://sourcelibrary.org] [--path /embed/bph/book/<slug>]...
//
// Needs playwright-core and CHROME_PATH (or a puppeteer chrome-headless-shell).
// Exit 0 pass, 1 a page failed, 2 nothing could be measured (not a pass).
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const base = opt('--base')[0] ?? 'https://sourcelibrary.org';
const paths = opt('--path');
if (!paths.length) paths.push('/embed/bph/book/the-book-of-the-angel-raziel');

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = join(homedir(), '.cache/puppeteer/chrome-headless-shell');
  if (!existsSync(root)) return undefined;
  for (const version of readdirSync(root)) {
    for (const dir of readdirSync(join(root, version))) {
      const candidate = join(root, version, dir, 'chrome-headless-shell');
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const WINDOWS = [[1440, 1000], [390, 844]];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const MAX_GROWTH = 1.5; // framed height against windowed height
const MAX_HERO_PX = 1100;

const browser = await chromium.launch({ executablePath: chromePath() });
// A local server is framed from its own origin: Chrome blocks a public origin framing localhost.
const hostUrl = base.startsWith('http://') ? `${base}/__frame-host` : 'https://host.test/';
let failed = 0;
let measured = 0;

for (const path of paths) {
  for (const [width, height] of WINDOWS) {
    const ctx = await browser.newContext({ viewport: { width, height }, userAgent: UA });
    try {
      const plain = await ctx.newPage();
      await plain.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await plain.waitForTimeout(5000);
      const windowed = await plain.evaluate(
        () => document.getElementById('main-content')?.scrollHeight ?? document.documentElement.scrollHeight,
      );

      const page = await ctx.newPage();
      await page.route(hostUrl + '**', (route) => route.fulfill({
        contentType: 'text/html',
        body:
          `<!doctype html><body style="margin:0"><iframe id="f" style="display:block;width:100%;height:${height}px;border:0" src="${base}${path}"></iframe>` +
          `<script>addEventListener('message',function(e){if(e.source===f.contentWindow&&e.data&&e.data.type==='sl-resize')f.style.height=Math.max(${height},parseInt(e.data.height,10))+'px'})</script>`,
      }));
      await page.goto(hostUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(base.startsWith('http://') ? 20000 : 9000);
      const framed = await page.evaluate(() => document.getElementById('f').offsetHeight);
      const frame = page.frames().find((f) => f !== page.mainFrame());
      const hero = await frame.evaluate(() => document.querySelector('section')?.clientHeight ?? 0);
      if (!hero || framed <= height) throw new Error(`frame never reported a height (hero ${hero}, frame ${framed})`);

      measured += 1;
      const bad = framed > windowed * MAX_GROWTH || hero > MAX_HERO_PX;
      if (bad) failed += 1;
      console.log(`${bad ? 'FAIL' : 'ok  '} ${width}x${height} ${path} frame=${framed} window=${windowed} hero=${hero}`);
    } catch (e) {
      console.log(`SKIP ${width}x${height} ${path}: ${e.message.slice(0, 160)}`);
    }
    await ctx.close();
  }
}
await browser.close();

if (!measured) {
  console.log('NOT RUN: nothing measured');
  process.exit(2);
}
console.log(`${measured} measured, ${failed} failed`);
process.exit(failed ? 1 : 0);
