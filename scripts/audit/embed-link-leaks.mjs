#!/usr/bin/env node
/**
 * embed-link-leaks — does any link on a partner's embedded page leave the embed?
 *
 * PRIOR ART: scripts/audit/r2-key-book-scope.mjs and the other audits check data, not rendered
 * links; src/lib/EmbedContext.tsx useEmbedHref() prefixes CLIENT links but cannot reach links a
 * server component builds; .claude/docs/invariants/tenant-lockdown.md records the subdomain leak
 * (#5038) found by reading pages, with no standing check. none of them fetch /embed/<tenant>/…
 *
 * WHY. /embed/<tenant>/book/<slug> is what a partner's site loads in its iframe. A server-built
 * href like /book/<slug>/page/<id> or /gallery drops the /embed/<tenant> prefix, so a click
 * swaps the partner's reader for sourcelibrary.org's own, inside the partner's frame. The main
 * site looks fine, so nobody notices (EFM, 2026-10-29: the Illustrations strip and the
 * "N images" link on every EFM book with extracted illustrations).
 *
 * METHOD. Fetch the embedded landing page and one page-reader URL for a sample of the tenant's
 * visible books, plus the room's catalogue, catalogue records (a digitised one, one whose book is
 * hidden, one with neither) and its 404 page. Extract every root-relative href and every absolute
 * link to our own site, and report each one that is not under /embed/<tenant>/ and not an asset or
 * API path. Search results only exist after hydration, so a real browser runs real queries, waits
 * for the results, and reads the links then; it does the same for the typeahead on the landing page.
 * A search arm that shows no result is NOT RUN, never a pass. Exit 1 on a leak, 2 if a part could not run.
 *
 * READS ONLY (Mongo and Supabase for the sample, public HTTP for the pages).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/embed-link-leaks.mjs [--tenant bph] [--books 20] [--base https://sourcelibrary.org] [--slug <slug>] [--query alchemy,maier] [--chrome PATH] [--no-browser]
 *   node scripts/audit/embed-link-leaks.mjs --self-test    plants leaks on a local server; exit 0 means each one was caught
 */
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };

// Paths that are fine to leave the namespace: assets, APIs, icons, feeds.
const ALLOWED = [/^\/_next\//, /^\/api\//, /^\/icon/, /^\/apple-icon/, /^\/favicon/, /^\/opensearch\.xml$/, /^\/manifest/];
// Sign-in links leave the embed too, but they are owned by a separate fix (sign-in inside the
// partner frame, #7702): listed as KNOWN, not counted as a failure. Drop this once that lands.
const KNOWN = [/^\/auth\//];
const OUR_SITE = /^https?:\/\/(?:www\.)?sourcelibrary\.org(\/[^"]*)?$/;

function findChrome() {
  const given = opt('chrome', process.env.CHROME_PATH);
  if (given) return given;
  const root = path.join(homedir(), '.cache/ms-playwright');
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root).filter(n => n.startsWith('chromium_headless_shell')).sort().reverse()) {
    const exe = path.join(root, d, 'chrome-headless-shell-linux64/chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return null;
}

function newReport() { return { leaks: new Map(), known: new Map(), fetched: 0, notRun: [] }; }

function record(report, tenantSlug, from, href) {
  const ownSite = href.match(OUR_SITE);
  const local = ownSite ? (ownSite[1] || '/') : href;
  if (!local.startsWith('/') || local.startsWith('//')) return;
  if (local === `/embed/${tenantSlug}` || local.startsWith(`/embed/${tenantSlug}/`) || local.startsWith(`/embed/${tenantSlug}?`)) {
    if (!ownSite) return; // inside the room; an absolute one still leaves a subdomain or a preview
  } else if (ALLOWED.some(re => re.test(local))) return;
  const key = local.replace(/[0-9a-f]{24}/g, ':id').replace(/\?.*$/, '')
    .replace(/^\/book\/[^/]+/, '/book/:slug').replace(/^\/catalog\/[^/]+/, '/catalog/:key').replace(/\/page-number\/\d+/, '/page-number/:n');
  const bucket = KNOWN.some(re => re.test(local)) ? report.known : report.leaks;
  const e = bucket.get(key) ?? { count: 0, example: `${from} -> ${href}` };
  e.count++; bucket.set(key, e);
}

/** Server-rendered pages: every href in the HTML. */
async function auditHtml(report, { base, tenantSlug, path: pagePath, expect404 }) {
  const res = await fetch(base + pagePath, { headers: { 'user-agent': 'SourceLibrary-embed-link-audit' } });
  if (!res.ok && !(expect404 && res.status === 404)) { console.error(`${res.status} ${pagePath}`); report.notRun.push(`${res.status} ${pagePath}`); return; }
  report.fetched++;
  const html = await res.text();
  for (const m of html.matchAll(/href="(\/[^"]*)"/g)) record(report, tenantSlug, pagePath, m[1].replace(/&amp;/g, '&'));
  // Absolute links only from anchors: <link rel="canonical"> names the main site on purpose.
  for (const m of html.matchAll(/<a\b[^>]*\shref="(https?:[^"]*)"/g)) {
    if (OUR_SITE.test(m[1])) record(report, tenantSlug, pagePath, m[1].replace(/&amp;/g, '&'));
  }
}

const anchorsOf = (page) => page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));

/** Client-rendered results: the links exist only once the results have loaded. */
async function auditSearch(report, { base, tenantSlug, queries, chrome, timeout = 30000 }) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const prefix = `/embed/${tenantSlug}`;
  const RESULT = `a[href*="/book/"], a[href*="/catalog/"]`;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    for (const q of queries) {
      const pagePath = `${prefix}/search?q=${encodeURIComponent(q)}`;
      const page = await ctx.newPage();
      await page.goto(base + pagePath, { waitUntil: 'domcontentloaded', timeout: 90000 });
      const shown = await page.waitForSelector(RESULT, { timeout }).catch(() => null);
      if (!shown) { report.notRun.push(`search "${q}": no result in ${timeout / 1000} s`); await page.close(); continue; }
      // The lanes answer at different speeds: give the slower ones time to render too.
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      report.fetched++;
      for (const href of await anchorsOf(page)) record(report, tenantSlug, `search "${q}"`, href);
      await page.close();
    }
    const page = await ctx.newPage();
    await page.goto(`${base}${prefix}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const box = page.locator('input[type="text"], input[type="search"]').first();
    if (await box.waitFor({ timeout: 15000 }).then(() => true, () => false)) {
      await box.click();
      await box.pressSequentially(queries[0], { delay: 40 });
      const hit = await page.waitForSelector('[role="option"]', { timeout }).catch(() => null);
      if (hit) {
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        report.fetched++;
        for (const href of await anchorsOf(page)) record(report, tenantSlug, `typeahead "${queries[0]}"`, href);
      } else report.notRun.push(`typeahead "${queries[0]}": no option appeared`);
    } else report.notRun.push('typeahead: no search box on the landing page');
    await page.close();
  } finally {
    await browser.close();
  }
}

function printReport(report, label) {
  console.log(`${report.fetched} embedded pages checked at ${label}`);
  for (const [k, e] of report.known) console.log(`KNOWN (sign-in, fixed separately): ${e.count}  ${k}    e.g. ${e.example}`);
  for (const n of report.notRun) console.log(`NOT RUN: ${n}`);
  if (report.leaks.size) {
    console.log(`FAIL: ${report.leaks.size} link pattern(s) leave the room`);
    for (const [k, e] of [...report.leaks].sort((a, b) => b[1].count - a[1].count)) console.log(`  ${String(e.count).padStart(4)}  ${k}    e.g. ${e.example}`);
    return 1;
  }
  if (report.notRun.length) { console.log('NOT A PASS: part of the room was not exercised'); return 2; }
  console.log('PASS: no link leaves the embed');
  return 0;
}

/**
 * A guard that has never failed proves nothing. A local server plays the room: a record with a bare
 * /book link, search results that gain a bare /catalog link only after loading, a 404 with an
 * absolute link home. Each must be caught, and the clean twin of each must pass.
 */
async function selfTest() {
  const room = '/embed/fixture';
  const lateResults = (late) => `<!doctype html><main id=r></main><script>setTimeout(() => {
    document.getElementById('r').innerHTML = '<a href="${room}/book/ok">ok</a>${late}';
  }, 400)</script>`;
  const typeahead = (late) => `<!doctype html><input type=text><div id=d></div><script>
    document.querySelector('input').addEventListener('input', () => {
      document.getElementById('d').innerHTML = '<a role="option" href="${late}">hit</a>';
    })</script>`;
  const pages = {
    clean: {
      [`${room}/catalog/1`]: `<a href="${room}/catalog">New search</a><a href="/auth/signin">Sign in</a><link rel="canonical" href="https://sourcelibrary.org/x">`,
      [`${room}/nope`]: `<a href="${room}/catalog">Search</a>`,
      [`${room}/search`]: lateResults(''),
      [room]: typeahead(`${room}/book/ok`),
    },
    record: { [`${room}/catalog/1`]: `<a href="/book/planted">Read</a>` },
    notFound: { [`${room}/nope`]: `<a href="https://sourcelibrary.org/">Home</a>` },
    search: { [`${room}/search`]: lateResults('<a href="/catalog/planted">x</a>') },
    typeahead: { [room]: typeahead('/book/planted') },
  };
  const chrome = findChrome();
  if (!chrome) { console.error('self-test needs a browser: pass --chrome PATH'); return 2; }
  let failed = 0;
  for (const name of ['clean', 'record', 'notFound', 'search', 'typeahead']) {
    const served = { ...pages.clean, ...pages[name] };
    const server = createServer((req, res) => {
      const body = served[req.url.split('?')[0]];
      res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
      res.end(body ?? 'not found');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const report = newReport();
    await auditHtml(report, { base, tenantSlug: 'fixture', path: `${room}/catalog/1` });
    await auditHtml(report, { base, tenantSlug: 'fixture', path: `${room}/nope` });
    await auditSearch(report, { base, tenantSlug: 'fixture', queries: ['q'], chrome, timeout: 5000 });
    server.close();
    server.closeAllConnections();
    const caught = report.leaks.size > 0;
    const right = name === 'clean' ? !caught && report.notRun.length === 0 && report.known.size === 1 : caught;
    console.log(`${right ? 'ok  ' : 'FAIL'} ${name}: ${[...report.leaks.keys()].join(', ') || 'no leak'}${report.notRun.length ? ` (not run: ${report.notRun.join('; ')})` : ''}`);
    if (!right) failed++;
  }
  console.log(failed ? 'SELF-TEST FAILED' : 'SELF-TEST PASSED: every planted leak was caught, the clean room passed');
  return failed ? 1 : 0;
}

if (args.includes('--self-test')) process.exit(await selfTest());

const tenantSlug = opt('tenant', 'bph');
const nBooks = Number(opt('books', 20));
const base = opt('base', 'https://sourcelibrary.org').replace(/\/$/, '');
const onlySlug = opt('slug');
const queries = opt('query', 'alchemy,maier').split(',').map(q => q.trim()).filter(Boolean);

const { MongoClient } = await import('mongodb');
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const tenant = await db.collection('tenants').findOne({ slug: tenantSlug }, { projection: { id: 1, _id: 1 } });
const tenantId = tenant?.id ?? String(tenant?._id ?? '');
const books = onlySlug
  ? await db.collection('books').find({ slug: onlySlug }, { projection: { id: 1, slug: 1 } }).toArray()
  : await db.collection('books').aggregate([
      { $match: { tenantId, visible: true, pages_count: { $gt: 0 } } },
      { $sample: { size: nBooks } },
      { $project: { id: 1, slug: 1 } },
    ]).toArray();
if (!books.length) { console.error(`no books for tenant ${tenantSlug} (tenantId ${tenantId || 'not found'})`); process.exit(2); }

const report = newReport();
for (const b of books) {
  const page = await db.collection('pages').findOne({ book_id: b.id, page_number: { $gt: 0 } }, { projection: { id: 1 }, sort: { page_number: 1 } });
  await auditHtml(report, { base, tenantSlug, path: `/embed/${tenantSlug}/book/${b.slug}` });
  if (page?.id) await auditHtml(report, { base, tenantSlug, path: `/embed/${tenantSlug}/book/${b.slug}/page/${page.id}` });
}
await client.close();

// The room's own pages. Records exist only for a tenant with a catalogue of its own.
const roomPaths = [`/embed/${tenantSlug}/catalog`];
if (tenantSlug === 'bph') {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const pick = async (build) => (await build(sb.from('bph_works').select('ubn').not('ubn', 'is', null).is('deleted_at', null)).limit(5)).data ?? [];
  const records = [...await pick(q => q.not('sl_book_id', 'is', null)), ...await pick(q => q.is('sl_book_id', null).is('sl_external_book_id', null))];
  if (!records.length) report.notRun.push('catalogue records: Supabase returned none');
  // 19198 is the hidden-book record the walk also opens (#8047).
  for (const r of [...records, { ubn: '19198' }]) await auditHtml(report, { base, tenantSlug, path: `/embed/${tenantSlug}/catalog/${encodeURIComponent(r.ubn)}` });
}
for (const p of roomPaths) await auditHtml(report, { base, tenantSlug, path: p });
await auditHtml(report, { base, tenantSlug, path: `/embed/${tenantSlug}/no-such-page-link-audit`, expect404: true });

if (args.includes('--no-browser')) console.log('search arm skipped (--no-browser): results and the typeahead were NOT checked');
else {
  const chrome = findChrome();
  if (!chrome) report.notRun.push('search: no browser, pass --chrome PATH');
  else await auditSearch(report, { base, tenantSlug, queries, chrome });
}
process.exit(printReport(report, `${base} (${books.length} ${tenantSlug} books)`));
