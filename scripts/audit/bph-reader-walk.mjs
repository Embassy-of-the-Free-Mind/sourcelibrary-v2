#!/usr/bin/env node
/**
 * bph-reader-walk: walk a partner's reading room in a real browser, as a visitor does.
 *
 * PRIOR ART: scripts/audit/embed-link-leaks.mjs fetches HTML and reads hrefs, so it cannot turn a
 * page, see a client-rendered result, or tell a clipped scan from a whole one (it stays the fast
 * link check; this is the slow visitor check). scripts/audit-bph-leaks.mjs crawls the subdomain
 * for foreign books and off-host links, not the reader. .claude/skills/qa-audit reads text quality.
 *
 * WHY. A visitor on embassyofthefreemind.com searches the catalogue, opens a record, opens the
 * digitised copy and turns pages inside an iframe of /embed/bph. Every break found on 2026-11-04
 * (#8047) was invisible to a status code: a stuck page turn, a link that left the frame, a results
 * list whose links only exist after hydration, a plate cut off by the scan pane (#8033).
 *
 * METHOD. For a fixed spread of books (the ones the 2026-11-04 walk used, chosen to include the
 * known hard cases), load the rooms pages and press ArrowRight three times, checking each step.
 * English is compared only across pages that hold a translation (Mongo says which), so front matter
 * with no English does not read as a stuck pane. Exit 1 on any problem, 2 if it could not run.
 *
 * READS ONLY (Mongo for start pages, public HTTP for the room).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/bph-reader-walk.mjs \
 *     --origin https://sourcelibrary.org --prefix /embed/bph [--books 16] [--out DIR] [--label embed]
 *   --prefix '' for the subdomain: --origin https://bph.sourcelibrary.org --prefix ''
 *   --query rosicrucian  the search arm's term;  --chrome PATH  the browser binary.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const origin = opt('origin', 'https://sourcelibrary.org').replace(/\/$/, '');
const prefix = opt('prefix', '/embed/bph').replace(/\/$/, '');
const maxBooks = Number(opt('books', 16));
const label = opt('label', prefix ? 'embed' : 'subdomain');
const query = opt('query', 'rosicrucian');
const outDir = opt('out', path.join(process.env.JOB_SCRATCH || tmpdir(), 'bph-reader-walk'));
mkdirSync(outDir, { recursive: true });

// The hard cases on purpose: fold-outs, a book with no-OCR gaps (Lead), books that stuck on turns (#8030).
const SLUGS = [
  'atalanta-fleeing-maier',
  'cabala-spiegel-der-kunst-und-natur-in-alchymia-michelspacher',
  'the-revelation-of-revelations-lead',
  'turris-babel-sive-judiciorum-de-fraternitate-rosaceae-andreae',
  'het-leeven-van-hai-ebn-yokdan-ibn-tufail',
  'geoffenbarter-einfluss-in-das-allgemeine-wohl-der-staaten-de-schleiss-von-lowenfeld-13060e',
  'historia-passionis-mortis-sepulturae-et-resurrectionis-jesu-loss',
  'on-the-hyleal-or-primaterial-universal-natural-chaos-khunrath',
  'the-most-hidden-secrets-of-the-principal-degrees-of-masonry-koppen',
  'versuch-uber-die-religion-der-alten-agypter-und-griechen-vogel',
  'thorough-account-of-the-first-principles-of-the-anabaptist-moded',
  'hirten-brief-an-die-wahren-und-achten-freymaurer-alten-haugwitz',
  'geistreiche-schrifften-weyer',
  'ain-schoner-christlicher-sendbrieff-und-bericht-schwenckfeld',
  'an-enquiry-into-the-patriarchal-and-druidical-religion-cooke',
  'd-espagnet-secret-work-of-hermetic-philosophy-post-1685-d-espagnet',
];

function findChrome() {
  const given = opt('chrome', process.env.CHROME_PATH);
  if (given) return given;
  const root = path.join(homedir(), '.cache/ms-playwright');
  if (existsSync(root)) {
    for (const d of readdirSync(root).filter(n => n.startsWith('chromium_headless_shell')).sort().reverse()) {
      const exe = path.join(root, d, 'chrome-headless-shell-linux64/chrome-headless-shell');
      if (existsSync(exe)) return exe;
    }
  }
  console.error('no browser: pass --chrome PATH');
  process.exit(2);
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
/** One translated page 40% of the way in (past front matter), and which pages hold English. */
async function startFor(slug) {
  const book = await db.collection('books').findOne({ slug, visible: true }, { projection: { id: 1, slug: 1, language: 1 } });
  if (!book) return null;
  const pages = await db.collection('pages').aggregate([
    { $match: { book_id: book.id, page_number: { $gt: 0 } } },
    { $sort: { page_number: 1 } },
    { $project: { id: 1, hasEn: { $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 20] } } },
  ]).toArray();
  const translated = pages.filter(p => p.hasEn);
  const pick = translated[Math.floor(translated.length * 0.4)] ?? pages[Math.floor(pages.length * 0.4)];
  // An English book has no translation pane: its English is the transcription.
  const section = /^en(glish)?\b/i.test(book.language || '') ? 'ocr' : 'translation';
  return pick ? { slug, page: pick.id, section, withEnglish: new Set(translated.map(p => p.id)) } : null;
}
const books = [];
for (const slug of SLUGS.slice(0, maxBooks)) {
  const s = await startFor(slug);
  if (s) books.push(s); else console.log(`skip ${slug}: not visible or no pages`);
}
// Wide leaves that must show whole (#8033), checked on desktop and phone.
const WIDE_LEAF = '/book/cabala-spiegel-der-kunst-und-natur-in-alchymia-michelspacher/page/69c857316c6f3cc53c853fbb';
await client.close();

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const host = new URL(origin).host;
const problems = [];
const known = new Set();
const note = (where, what) => { problems.push(`${where}: ${what}`); console.log(`  PROBLEM ${where}: ${what}`); };

async function open(ctx, urlPath, name) {
  const page = await ctx.newPage();
  const bad = [];
  const errs = [];
  page.on('response', r => {
    const u = r.url();
    if (r.status() >= 400 && /\/api\/|images\.sourcelibrary|\/_next\/static/.test(u)) bad.push(`${r.status()} ${u.replace(origin, '').slice(0, 90)}`);
  });
  page.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  let status = 0;
  try {
    const resp = await page.goto(origin + urlPath, { waitUntil: 'domcontentloaded', timeout: 90000 });
    status = resp?.status() ?? 0;
    await page.waitForTimeout(3500);
  } catch (e) { note(name, `load failed ${e.message.slice(0, 80)}`); }
  return { page, bad, errs, status };
}

// Sign-in leaves the host on purpose until EFM settles auth (#7702): counted apart, not a failure.
const isKnown = (pathname) => /^\/auth\//.test(pathname);
const links = (frame) => frame.evaluate(({ prefix, host }) => {
  const out = { off: [], leave: [], n: 0 };
  for (const a of document.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href');
    if (!h || h.startsWith('#') || h.startsWith('mailto:') || h.startsWith('javascript:')) continue;
    out.n++;
    let u; try { u = new URL(h, location.href); } catch { continue; }
    if (u.host.endsWith('sourcelibrary.org') && u.host !== host) out.off.push(u.pathname + u.search);
    else if (u.host === host && prefix && !u.pathname.startsWith(`${prefix}/`) && u.pathname !== prefix && !u.pathname.startsWith('/api/')) out.leave.push(u.pathname + u.search);
  }
  return out;
}, { prefix, host });

function checkLinks(where, l) {
  const off = [...new Set(l.off)], leave = [...new Set(l.leave)];
  for (const k of [...off, ...leave].filter(isKnown)) known.add(k.split('?')[0]);
  const realOff = off.filter(x => !isKnown(x)), realLeave = leave.filter(x => !isKnown(x));
  if (realOff.length) note(where, `links off the host: ${realOff.slice(0, 5).join(', ')}`);
  if (realLeave.length) note(where, `links leave the room: ${realLeave.slice(0, 5).join(', ')}`);
}

const isGlobal404 = (txt) => /Lost in the Stacks/i.test(txt);
const inRoom = (url) => { const u = new URL(url); return u.host === host && (!prefix || u.pathname === prefix || u.pathname.startsWith(`${prefix}/`)); };

const reader = (page, section = 'translation') => page.evaluate((section) => {
  const on = e => e.getBoundingClientRect().width > 0;
  const en = [...document.querySelectorAll(`[data-reader-section="${section}"] [data-reader-panel]`)].find(on);
  const img = [...document.images].filter(on).filter(i => i.getBoundingClientRect().width > 150).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  return {
    pageId: location.pathname.split('/').pop(),
    path: location.pathname,
    scan: img ? img.currentSrc : null,
    loaded: img ? img.complete && img.naturalWidth > 0 : false,
    en: en ? en.innerText.replace(/[\s​-‍]+/g, ' ') : null,
    error: /Something went wrong|This page could not be found/i.test(document.body.innerText),
  };
}, section);

/** A slow scan is not a stuck one: give it 8 s before reading the step. */
const settledReader = async (page, section) => {
  await page.waitForFunction(() => {
    const img = [...document.images].filter(i => i.getBoundingClientRect().width > 150).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    return img && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 8000 }).catch(() => {});
  return reader(page, section);
};

/** Is the whole leaf on screen? Rendered box against natural shape, then against every clipping ancestor. */
const leafFit = (page) => page.evaluate(() => {
  const on = e => e.getBoundingClientRect().width > 0;
  const img = [...document.images].filter(on).filter(i => i.getBoundingClientRect().width > 120).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  if (!img || !img.naturalWidth) return null;
  const r = img.getBoundingClientRect();
  let visible = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  for (let n = img.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.overflow === 'visible' && s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const b = n.getBoundingClientRect();
    visible = { top: Math.max(visible.top, b.top), bottom: Math.min(visible.bottom, b.bottom), left: Math.max(visible.left, b.left), right: Math.min(visible.right, b.right) };
  }
  const fit = getComputedStyle(img).objectFit;
  return {
    natural: img.naturalWidth / img.naturalHeight,
    box: r.width / r.height,
    fit,
    shownH: (visible.bottom - visible.top) / r.height,
    shownW: (visible.right - visible.left) / r.width,
    size: `${Math.round(r.width)}x${Math.round(r.height)}`,
  };
});
function checkFit(where, f) {
  if (!f) { note(where, 'no scan image to measure'); return; }
  const stretched = f.fit !== 'contain' && Math.abs(f.box - f.natural) / f.natural > 0.03;
  if (stretched) note(where, `scan cropped: box ${f.box.toFixed(2)} vs leaf ${f.natural.toFixed(2)}, object-fit ${f.fit}, ${f.size}`);
  if (f.shownH < 0.98 || f.shownW < 0.98) note(where, `scan clipped by its pane: ${Math.round(f.shownW * 100)}% x ${Math.round(f.shownH * 100)}% visible, ${f.size}`);
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// The room's own pages. A hidden book's record must say so and offer no read link.
for (const [name, urlPath, expect404] of [
  ['home', prefix || '/'],
  ['catalogue', `${prefix}/catalog`],
  ['record', `${prefix}/catalog/9180`],
  ['record-hidden-book', `${prefix}/catalog/19198`],
  ['search', `${prefix}/search?q=${encodeURIComponent(query)}`],
  ['not-found', `${prefix}/no-such-page-walk`, true],
]) {
  const { page, bad, errs, status } = await open(ctx, urlPath, name);
  if (name === 'search') await page.waitForSelector('a[href*="/book/"]', { timeout: 30000 }).catch(() => note(name, 'no book result appeared in 30 s'));
  const txt = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  const l = await links(page);
  console.log(`${name} ${status} links=${l.n} text=${txt.length} ${txt.slice(0, 70)}`);
  if (status >= 400 && !expect404) note(name, `HTTP ${status}`);
  if (isGlobal404(txt)) note(name, 'global 404 page');
  if (!expect404 && /Something went wrong|This page could not be found/i.test(txt)) note(name, 'error page');
  if (expect404 && !/not (?:be )?found|not here/i.test(txt)) note(name, 'no plain not-found message');
  if (name === 'record-hidden-book') {
    if (!/No digitised copy is available here/i.test(txt)) note(name, 'does not say no digitised copy is available');
    if (await page.locator('a[href*="/book/"]').count()) note(name, 'offers a read link to a hidden book');
  }
  checkLinks(name, l);
  if (bad.length) note(name, `failed requests: ${[...new Set(bad)].slice(0, 3).join(' ; ')}`);
  if (errs.length) note(name, `script errors: ${errs[0]}`);
  await page.screenshot({ path: path.join(outDir, `${label}-${name}.png`) });
  await page.close();
}

// Clicks, not hrefs: where does the visitor actually land?
{
  const { page } = await open(ctx, `${prefix}/catalog/9180`, 'new-search');
  await page.getByRole('link', { name: 'New search' }).first().click({ timeout: 15000 }).catch(e => note('new-search', `no link: ${e.message.slice(0, 80)}`));
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(4000);
  const txt = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  if (!inRoom(page.url())) note('new-search', `left the room: ${page.url()}`);
  if (isGlobal404(txt) || /could not be found/i.test(txt)) note('new-search', 'landed on a 404');
  if (!/catalogue/i.test(txt)) note('new-search', 'landed somewhere with no catalogue');
  console.log(`new-search -> ${page.url().replace(origin, '')}`);
  await page.screenshot({ path: path.join(outDir, `${label}-new-search.png`) });
  await page.close();
}
{
  const { page } = await open(ctx, `${prefix}/search?q=${encodeURIComponent(query)}`, 'search-click');
  const hit = page.locator('a[href*="/book/"]').first();
  await hit.waitFor({ timeout: 30000 }).catch(() => {});
  if (await hit.count()) {
    await hit.click({ timeout: 15000 }).catch(e => note('search-click', e.message.slice(0, 80)));
    await page.waitForURL(/\/book\//, { timeout: 30000 }).catch(() => note('search-click', 'never reached a book'));
    await page.waitForTimeout(3000);
    if (!inRoom(page.url())) note('search-click', `left the room: ${page.url()}`);
    console.log(`search-click -> ${page.url().replace(origin, '')}`);
  } else note('search-click', 'no result to click');
  await page.close();
}

// The real surface: inside an iframe on the partner's site. A frame that leaves goes blank (DENY).
if (prefix) {
  const frameCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const parent = 'https://embassyofthefreemind.com/__walk';
  await frameCtx.route(parent, r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><iframe id=f src="${origin}${prefix}/catalog/9180" style="width:100%;height:880px;border:0"></iframe>` }));
  const page = await frameCtx.newPage();
  await page.goto(parent, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => note('iframe', e.message.slice(0, 80)));
  await page.waitForTimeout(6000);
  const frame = page.frames().find(f => f !== page.mainFrame());
  if (!frame) note('iframe', 'no frame');
  else {
    if (!inRoom(frame.url())) note('iframe', `frame not in room: ${frame.url()}`);
    await frame.getByRole('link', { name: 'New search' }).first().click({ timeout: 15000 }).catch(e => note('iframe', `New search: ${e.message.slice(0, 80)}`));
    await page.waitForTimeout(5000);
    const after = page.frames().find(f => f !== page.mainFrame());
    const txt = after ? (await after.evaluate(() => document.body.innerText).catch(() => '')) : '';
    if (!after || !inRoom(after.url())) note('iframe', `New search left the frame: ${after?.url()}`);
    if (!/catalogue/i.test(txt)) note('iframe', 'frame shows no catalogue after New search');
    console.log(`iframe -> ${after?.url().replace(origin, '')}`);
  }
  await page.screenshot({ path: path.join(outDir, `${label}-iframe.png`) });
  await frameCtx.close();
}

// A wide fold-out shows whole, on a desk and in the hand.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
for (const [device, c] of [['desktop', ctx], ['phone', phone]]) {
  const { page, status } = await open(c, `${prefix}${WIDE_LEAF}`, `wide-leaf-${device}`);
  await page.waitForTimeout(2500);
  const f = await leafFit(page);
  console.log(`wide-leaf ${device} ${status} ${JSON.stringify(f)}`);
  checkFit(`wide-leaf-${device}`, f);
  await page.screenshot({ path: path.join(outDir, `${label}-wide-leaf-${device}.png`) });
  await page.close();
}
await phone.close();

// Page turns.
for (const b of books) {
  const land = await open(ctx, `${prefix}/book/${b.slug}`, b.slug);
  if (land.status >= 400) note(b.slug, `book page HTTP ${land.status}`);
  checkLinks(b.slug, await links(land.page));
  await land.page.close();
  const { page, bad, errs, status } = await open(ctx, `${prefix}/book/${b.slug}/page/${b.page}`, b.slug);
  const seen = [await settledReader(page, b.section)];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(2500);
    seen.push(await settledReader(page, b.section));
  }
  checkLinks(`${b.slug} reader`, await links(page));
  const moved = new Set(seen.map(s => s.pageId)).size;
  const scans = new Set(seen.map(s => s.scan)).size;
  // Only pages that hold a translation can show a stuck English pane.
  const translated = seen.filter(s => b.withEnglish.has(s.pageId));
  const english = new Set(translated.map(s => s.en)).size;
  console.log(`${b.slug.slice(0, 44).padEnd(44)} ${status} | turns ${moved}/4 scans ${scans}/4 english ${english}/${translated.length} imgok ${seen.filter(s => s.loaded).length}/4`);
  if (status >= 400) note(b.slug, `reader HTTP ${status}`);
  if (seen.some(s => s.error)) note(b.slug, 'error page in reader');
  if (!seen.every(s => inRoom(origin + s.path))) note(b.slug, `a turn left the room: ${seen.map(s => s.path).find(p => !inRoom(origin + p))}`);
  if (moved < 4) note(b.slug, `page did not move on every turn (${moved}/4)`);
  if (scans < 4) note(b.slug, `scan did not change on every turn (${scans}/4)`);
  if (translated.length >= 2 && english < translated.length) note(b.slug, `English did not change on turns (${english}/${translated.length} pages with a translation)`);
  if (translated.some(s => !s.en)) note(b.slug, 'a page with a translation shows no English');
  if (seen.some(s => !s.loaded)) note(b.slug, `image not loaded on ${seen.filter(s => !s.loaded).length}/4`);
  if (bad.length) note(b.slug, `failed requests: ${[...new Set(bad)].slice(0, 3).join(' ; ')}`);
  if (errs.length) note(b.slug, `script error: ${errs[0]}`);
  await page.close();
}

await browser.close();
for (const k of known) console.log(`KNOWN (sign-in, an auth question with EFM, #7702): ${k}`);
console.log(`\n${label}: ${problems.length} problem(s), ${books.length} books, screenshots in ${outDir}`);
process.exit(problems.length ? 1 : 0);
