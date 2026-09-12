#!/usr/bin/env node
/**
 * KU Leuven digitized-collection gap census.
 *
 * Answers: "What has KU Leuven Libraries digitized that we DON'T have?"
 *
 * Channel (reverse-engineered 2026-06-01 — all public, no credentials):
 *   - Catalog:   Primo VE  /primaws/rest/pub/pnxs   (scope=MyInstitution = KU Leuven holdings)
 *   - Token:     sessionStorage 'primoExploreJwt', minted on page load (Playwright grabs it)
 *   - Facets:    /primaws/rest/pub/facets  → facet_digital_collection = the digitized-collection map
 *   - Online IE: /primaws/rest/pub/edelivery → resolver.libis.be/IE{n}/representation
 *   - Manifest:  https://lib.is/IE{n}/manifest   (IIIF v3, importable by /api/import/iiif as-is)
 *   - (a bespoke IIIF subset also lives on sharedcanvas.be — manuscripts/exhibits)
 *
 * Two digitization platforms confirmed: Rosetta/Teneo (bulk, lib.is IIIF) + sharedcanvas.be (bespoke).
 *
 * Diff: normalized title+author against our Mongo `bookstore.books` (same logic as src/lib/dedup.ts).
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   node scripts/research/kuleuven-gap-harvest.mjs            # full run
 *   node scripts/research/kuleuven-gap-harvest.mjs --limit 200 --no-manifest   # quick probe
 *
 * Outputs (scripts/research/output/):
 *   kuleuven-digitized-collections.json   the collection map (name + count)
 *   kuleuven-digitized.json               every digitized record we enumerated
 *   kuleuven-gap.json                     the subset we do NOT already have (import candidates)
 */

import { chromium } from 'playwright';
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Dedup-key normalizers: ONE implementation, shared with src/lib/dedup.ts (#4444).
import { normalizeTitle, normalizeAuthor } from '../lib/dedup-normalize.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, 'output');
mkdirSync(OUT, { recursive: true });

const VID = '32KUL_KUL:KULeuven';
const INST = '32KUL_KUL';
const HOST = 'https://kuleuven.limo.libis.be';
const args = process.argv.slice(2);
const argNum = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? parseInt(args[i + 1]) : def; };
// Primo VE caps deep paging at ~1000 results/query, so we partition the catalog by
// publication year. Default window = the early-print era that matches our mission.
const FROM = argNum('--from', 1450);
const TO = argNum('--to', 1700);

const firstStr = (v) => Array.isArray(v) ? (v[0] ?? '') : (v ?? '');

// =====================================================================
// 1. Mint token + run all Primo API calls inside the page (same-origin)
// =====================================================================
async function harvestPrimo() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ userAgent: 'Mozilla/5.0 SourceLibrary-research' })).newPage();

  // capture the real param templates the app uses for each endpoint
  const tmpl = {};
  page.on('request', (r) => {
    for (const ep of ['pnxs', 'facets', 'edelivery']) {
      if (r.url().includes(`/pub/${ep}`) && !tmpl[ep]) {
        tmpl[ep] = Object.fromEntries(new URL(r.url()).searchParams.entries());
      }
    }
  });

  // a query with digitized hits triggers pnxs + facets + edelivery so we capture all 3 templates
  await page.goto(`${HOST}/discovery/search?query=any,contains,getijdenboek&tab=all&vid=${VID}&mode=basic&offset=0`,
    { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.error('goto:', e.message));
  await page.waitForFunction(() => sessionStorage.getItem('primoExploreJwt'), { timeout: 30000 });
  await page.waitForTimeout(5000); // let pnxs/facets/edelivery fire so we capture their templates
  console.log('  token minted; endpoint templates:', Object.keys(tmpl).join(', '));

  // In-page scanner for ONE publication year: pages the (MyInstitution · online · year)
  // slice up to Primo's ~1000 deep-paging cap, POSTs edelivery per page, returns the
  // records that carry a KU Leuven Rosetta IE (= actually digitized here, with a manifest).
  const scanYear = (year) => page.evaluate(async ({ VID, INST, tmpl, year }) => {
    const jwt = sessionStorage.getItem('primoExploreJwt');
    const auth = { headers: { Authorization: 'Bearer ' + jwt } };
    const firstStr = (v) => Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
    const clean = (s) => firstStr(s).split('$$')[0].trim(); // strip Primo "Name$$QName"
    const E = 'https://kuleuven.limo.libis.be/primaws/rest/pub/';
    const qInclude = `facet_tlevel,include,online_resources|,|facet_searchcreationdate,include,[${year} TO ${year}]`;
    const qparams = (offset, limit) => new URLSearchParams({
      ...(tmpl.pnxs || {}), vid: VID, inst: INST, lang: 'en', scope: 'MyInstitution',
      mode: 'advanced', sort: 'rank', q: 'any,contains,e', qExclude: '', qInclude,
      offset: String(offset), limit: String(limit), pcAvailability: 'true', skipDelivery: 'Y',
    });
    const PAGE = 50, CAP = 1000;
    const out = []; let total = null;
    for (let offset = 0; offset < CAP; offset += PAGE) {
      const params = qparams(offset, PAGE);
      const r = await fetch(E + 'pnxs?' + params.toString(), auth);
      const d = r.ok ? await r.json() : { __err: r.status };
      if (d.__err) break;
      total = d.info?.total ?? total;
      const batch = d.docs || [];
      const ids = batch.map(x => x.pnx?.control?.recordid?.[0] || x['@id']).filter(Boolean);
      const er = await fetch(E + 'edelivery?' + params.toString(), {
        method: 'POST', headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
        body: JSON.stringify(ids.map(id => ({ recId: id, sharedDigitalCandidates: null }))),
      });
      const ed = er.ok ? await er.json() : {};
      for (const doc of batch) {
        const rid = doc.pnx?.control?.recordid?.[0] || doc['@id'];
        const m = JSON.stringify(ed?.[rid] || '').match(/resolver\.libis\.be\/(IE\d+)/);
        if (!m) continue;
        const ie = m[1], disp = doc.pnx?.display || {};
        out.push({
          recordid: rid, ie_pid: ie,
          title: clean(disp.title), creator: clean(disp.creator) || clean(disp.contributor),
          date: firstStr(disp.creationdate) || firstStr(disp.date), type: firstStr(disp.type),
          manifest: `https://lib.is/${ie}/manifest`, resolver: `https://resolver.libis.be/${ie}/representation`,
        });
      }
      if (batch.length < PAGE) break;
    }
    return { total, docs: out };
  }, { VID, INST, tmpl, year });

  const docs = [];
  const truncated = [];
  for (let year = FROM; year <= TO; year++) {
    const { total, docs: yd } = await scanYear(year);
    docs.push(...yd);
    if (total > 1000) truncated.push({ year, total }); // no silent caps: flag for sub-partitioning
    if (yd.length || (total && total > 0)) console.log(`  ${year}: ${total ?? 0} online · ${yd.length} digitized   (running: ${docs.length})`);
  }
  await browser.close();
  return { docs, truncated, collections: [{ name: `MyInstitution · online · ${FROM}-${TO}`, count: docs.length }] };
}

// =====================================================================
// 2. Diff against our Mongo catalog
// =====================================================================
async function diff(docs) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  // preload our catalog's normalized keys (fast in-memory diff)
  const ours = await db.collection('books')
    .find({}, { projection: { title: 1, author: 1, normalized_title: 1, normalized_author: 1 } }).toArray();
  await client.close();

  const titleSet = new Set();          // normalized title -> have it
  const titleAuthorSet = new Set();    // normalized "title|author" -> have it
  for (const b of ours) {
    const nt = b.normalized_title || normalizeTitle(b.title || '');
    const na = b.normalized_author || normalizeAuthor(b.author || '');
    if (nt) { titleSet.add(nt); titleAuthorSet.add(nt + '|' + na); }
  }

  for (const d of docs) {
    const nt = normalizeTitle(d.title || '');
    const na = normalizeAuthor(d.creator || '');
    d._nt = nt;
    if (titleAuthorSet.has(nt + '|' + na)) d.match = 'title_author';
    else if (nt && titleSet.has(nt)) d.match = 'title_only';
    else d.match = 'none';
  }
  return { ourCount: ours.length };
}

// =====================================================================
(async () => {
  console.log(`▶ Harvesting KU Leuven digitized items, ${FROM}–${TO} (year-partitioned, Primo cap ~1000/yr)…`);
  const { docs, truncated } = await harvestPrimo();
  console.log(`  digitized items found: ${docs.length}`);

  console.log('▶ Diffing against bookstore.books…');
  const { ourCount } = await diff(docs);

  const gap = docs.filter(d => d.match === 'none');
  const titleOnly = docs.filter(d => d.match === 'title_only');
  const have = docs.filter(d => d.match === 'title_author');

  writeFileSync(join(OUT, 'kuleuven-digitized.json'), JSON.stringify(docs, null, 1));
  writeFileSync(join(OUT, 'kuleuven-gap.json'), JSON.stringify(gap, null, 1));

  console.log(`\n========== KU LEUVEN GAP CENSUS (${FROM}–${TO}) ==========`);
  console.log(`Our catalog (books):            ${ourCount.toLocaleString()}`);
  console.log(`KU Leuven digitized (window):   ${docs.length.toLocaleString()}`);
  console.log(`  ├─ already have (title+author): ${have.length}`);
  console.log(`  ├─ probable have (title only):  ${titleOnly.length}`);
  console.log(`  └─ GAP — we don't have:         ${gap.length}`);
  if (truncated.length) {
    console.log(`\n⚠ ${truncated.length} year(s) exceeded the 1000 cap (under-counted — sub-partition these):`);
    console.log('  ' + truncated.map(t => `${t.year}(${t.total})`).join(', '));
  }
  console.log(`\nWrote → ${OUT}/{kuleuven-digitized,kuleuven-gap}.json`);
  console.log('Gap items carry a ready-to-import `manifest` (https://lib.is/IE…/manifest).');
})();
