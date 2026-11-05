#!/usr/bin/env node
// PRIOR ART: scripts/audit/embed-link-leaks.mjs — fetches embed HTML and checks links; a layout loop only exists in a browser, in a frame that resizes.
//
// Does a partner's book page settle at a sane height inside a frame that fits its
// content? A page sized in viewport units grows the frame that grows it (#8054):
// every book page on the Embassy's site opened on a blown-up crop for six days,
// and no request failed, because everything returned 200.
//
// Fails if the frame ends up far taller than the same page in a normal window, or
// if the hero is far taller than a window.
//
//   node scripts/audit/embed-frame-height.mjs                    fixed book + a random sample, on the Embassy's real page
//   node scripts/audit/embed-frame-height.mjs --harness          the same, in a local stand-in for embed/v1.js
//   node scripts/audit/embed-frame-height.mjs --base http://localhost:3000 --path /embed/bph/book/<slug>
//   --alert       page ntfy on 1 and on 2, never on 0 (the daily cron)
//   --shots DIR   save a screenshot of each failing page
//   --sample N    random books added to the fixed one (default 4)
//
// Browser: CHROME_PATH, else Playwright's own, else a puppeteer chrome-headless-shell.
// Exit: 0 ran clean. 1 ran, found a page that fails. 2 could not run, which is not a pass.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { ntfyPost } from '../lib/ntfy-send.mjs';

const args = process.argv.slice(2);
const opt = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const has = (name) => args.includes(name);

const base = opt('--base')[0] ?? 'https://sourcelibrary.org';
const shots = opt('--shots')[0];
const sampleSize = Number(opt('--sample')[0] ?? 4);
const givenPaths = opt('--path');
const isLocal = base.startsWith('http://');
const useHarness = has('--harness') || isLocal;
const EFM_PAGE = 'https://www.embassyofthefreemind.com/digital-collection-search';
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'https://ntfy.sh/sourcelibrary-uptime';
const FIXED_BOOK = '/embed/bph/book/the-book-of-the-angel-raziel';
const WINDOWS = [[1440, 1000], [390, 844]];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const MAX_GROWTH = 1.5; // framed height against windowed height
const MAX_HERO_PX = 1100;
const SETTLE_MS = isLocal ? 20000 : 10000;

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = join(homedir(), '.cache/puppeteer/chrome-headless-shell');
  if (existsSync(join(homedir(), '.cache/ms-playwright')) || !existsSync(root)) return undefined;
  for (const version of readdirSync(root)) {
    for (const dir of readdirSync(join(root, version))) {
      const candidate = join(root, version, dir, 'chrome-headless-shell');
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

async function alert(title, priority, body) {
  if (!has('--alert')) return;
  try {
    await ntfyPost(NTFY_TOPIC, { method: 'POST', headers: { Title: title, Priority: priority, Tags: 'warning' }, body });
  } catch (e) {
    console.log(`ntfy failed: ${e.message}`);
  }
}

// Books on the partner's own listing, so the sample follows what visitors can reach.
async function sampleBooks(ctx) {
  if (sampleSize <= 0) return [];
  // The listing renders client-side, so read its links from a loaded page, not the HTML.
  const page = await ctx.newPage();
  await page.goto(`${base}/embed/bph`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(SETTLE_MS);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href*="/book/"]')].map((a) => new URL(a.href).pathname));
  await page.close();
  const found = [...new Set(hrefs)]
    .filter((p) => /^\/embed\/bph\/book\/[^/]+$/.test(p) && p !== FIXED_BOOK);
  if (!found.length) console.log(`note: no books listed at ${base}/embed/bph; fixed book only`);
  return found.sort(() => Math.random() - 0.5).slice(0, sampleSize);
}

// The frame under test: the partner's real page with the real embed script, or a stand-in.
async function openFramed(page, path, height) {
  if (!useHarness) {
    const slug = path.split('/book/')[1];
    await page.goto(`${EFM_PAGE}?book=${encodeURIComponent(slug)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(SETTLE_MS);
    const framed = await page.evaluate(() => document.getElementById('sl-embed-iframe')?.offsetHeight ?? 0);
    return { framed, frame: page.frames().find((f) => f.url().includes('/embed/bph')) };
  }
  // A local server is framed from its own origin: Chrome blocks a public origin framing localhost.
  const hostUrl = isLocal ? `${base}/__frame-host` : 'https://host.test/';
  await page.route(`${hostUrl}**`, (route) => route.fulfill({
    contentType: 'text/html',
    body:
      `<!doctype html><body style="margin:0"><iframe id="f" style="display:block;width:100%;height:${height}px;border:0" src="${base}${path}"></iframe>` +
      `<script>addEventListener('message',function(e){if(e.source===f.contentWindow&&e.data&&e.data.type==='sl-resize')f.style.height=Math.max(${height},parseInt(e.data.height,10))+'px'})</script>`,
  }));
  await page.goto(hostUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(SETTLE_MS);
  const framed = await page.evaluate(() => document.getElementById('f').offsetHeight);
  return { framed, frame: page.frames().find((f) => f !== page.mainFrame()) };
}

async function measure(browser, path, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, userAgent: UA });
  try {
    const plain = await ctx.newPage();
    await plain.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await plain.waitForTimeout(5000);
    const windowed = await plain.evaluate(
      () => document.getElementById('main-content')?.scrollHeight ?? document.documentElement.scrollHeight,
    );

    const page = await ctx.newPage();
    const { framed, frame } = await openFramed(page, path, height);
    if (!frame) throw new Error('no Source Library frame on the page');
    const hero = await frame.evaluate(() => document.querySelector('section')?.clientHeight ?? 0);
    if (!hero || framed <= height) throw new Error(`frame never reported a height (hero ${hero}, frame ${framed})`);

    const bad = framed > windowed * MAX_GROWTH || hero > MAX_HERO_PX;
    const line = `${width}x${height} ${path} frame=${framed} window=${windowed} hero=${hero}`;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${line}`);
    if (bad && shots) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `${path.split('/').pop()}-${width}.png`) });
    }
    return { bad, line };
  } finally {
    await ctx.close();
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: chromePath() });
  const fails = [];
  const skips = [];
  let measured = 0;
  try {
    const ctx = await browser.newContext({ userAgent: UA });
    const targets = givenPaths.length ? givenPaths : [FIXED_BOOK, ...(await sampleBooks(ctx))];
    await ctx.close();
    for (const path of targets) {
      for (const [width, height] of WINDOWS) {
        try {
          const { bad, line } = await measure(browser, path, width, height);
          measured += 1;
          if (bad) fails.push(line);
        } catch (e) {
          skips.push(`${width}x${height} ${path}`);
          console.log(`SKIP ${width}x${height} ${path}: ${e.message.slice(0, 160)}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`${new Date().toISOString()} ${measured} measured, ${fails.length} failed, ${skips.length} skipped`);
  if (fails.length) {
    await alert('Partner frame: book page too tall', 'high',
      `${fails.length} of ${measured} frame checks failed. A partner book page is not fitting its frame, so visitors may see a blown-up crop (#8054).\n${fails.slice(0, 4).join('\n')}\nCheck: node scripts/audit/embed-frame-height.mjs`);
    return 1;
  }
  if (!measured) throw new Error(`nothing measured (${skips.length} skipped)`);
  return 0;
}

main().then((code) => process.exit(code)).catch(async (e) => {
  // A crash is the instrument failing, never a finding.
  console.log(`NOT RUN: ${e.message.slice(0, 300)}`);
  await alert('Partner frame check could not run', 'default',
    `embed-frame-height could not measure anything, so a broken partner page would go unseen: ${e.message.slice(0, 200)}`);
  process.exit(2);
});
