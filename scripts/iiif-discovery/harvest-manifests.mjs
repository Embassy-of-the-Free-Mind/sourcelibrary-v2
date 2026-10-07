#!/usr/bin/env node
/**
 * Stage 2 of the pipeline: BULK-HARVEST every candidate's IIIF manifest ONCE.
 *
 *   enumerate (sources/*.mjs) → import_candidates
 *   → THIS: harvest-manifests.mjs   (fetch + cache each manifest's pages + rights)
 *   → import-from-cache.mjs         (offline DB→DB insert; no network)
 *
 * Why a distinct stage: it isolates ALL the slow / rate-limited / browser-driven
 * network work into one resumable pass, so import is a fast, offline, idempotent
 * DB operation. A throttled source (Leiden F5, Harvard 429) gets hit exactly once.
 *
 * It writes a `manifest_cache` subdoc onto each candidate:
 *   { harvested_at, canvas_count, rights, license, label, pages: [{photo,thumbnail}] }
 * and refreshes top-level page_count + metadata.rights.
 *
 * Source-aware fetch strategy (FETCHERS registry):
 *   - 'browser' — Playwright navigation (sources behind JS/bot walls, e.g. leiden)
 *   - 'plain'   — plain fetch (most open IIIF servers); also works residentially
 *                 for datacenter-429 sources (run from a residential IP).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/iiif-discovery/harvest-manifests.mjs --source=leiden --collection=ubl_maps
 *   node scripts/iiif-discovery/harvest-manifests.mjs --source=erara --limit=500
 *   node scripts/iiif-discovery/harvest-manifests.mjs --source=leiden --fetcher=browser --refetch
 *
 * Options:
 *   --source=<s>          only this source (default: all)
 *   --collection=<slug>   only candidates with this category tag
 *   --fetcher=plain|browser   override the per-source default
 *   --limit=N             cap candidates this run
 *   --refetch             re-harvest even if manifest_cache exists
 *   --drop-restricted     mark non-open candidates 'skipped' (default: keep, flagged)
 *   --oai-id-re=<regex>   only candidates whose oai_id matches (e.g. Vatican fonds by shelfmark)
 *   --max-year=N          only candidates with date_earliest <= N (undated rows are excluded)
 *   --delay-ms=N          pause between manifests (default 100; honour a host's robots crawl-delay)
 *   --contact-ua          send a contact-carrying user agent instead of the browser string
 */

import { chromium } from 'playwright';
import { getScriptClient } from '../lib/mongo.mjs';
import { manifestToPages, manifestRights, extractLabel, extractManifestMetadata } from './lib/iiif-metadata.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);
const SOURCE = args.source || null;
const COLLECTION = args.collection || null;
const LIMIT = parseInt(args.limit) || 100000;
const REFETCH = 'refetch' in args;
const DROP_RESTRICTED = 'drop-restricted' in args;
const OAI_ID_RE = args['oai-id-re'] ? new RegExp(args['oai-id-re']) : null;
const MAX_YEAR = parseInt(args['max-year']) || null;
const DELAY_MS = parseInt(args['delay-ms']) || null;
// A wave that runs for hours against one institution should say who it is (#4361's
// rule for IA). The browser string stays the default for the sources that need it.
const UA = 'contact-ua' in args
  ? 'SourceLibrary/1.0 (https://sourcelibrary.org; j.d.lomas@tudelft.nl)'
  : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CHALLENGE_RE = /bobcmn|support id is|failureConfig/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Per-source default fetch strategy. Override with --fetcher.
const FETCHERS = { leiden: 'browser' };
const fetcherFor = src => args.fetcher || FETCHERS[src] || 'plain';

// ---- plain fetcher (open servers / residential) ----
async function fetchPlain(url) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,application/ld+json,*/*' } });
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (t + 1)); continue; }
      if (!r.ok) return { error: r.status };
      const txt = await r.text();
      try { return { manifest: JSON.parse(txt) }; } catch { return { error: 'not-json' }; }
    } catch (e) { await sleep(2000 * (t + 1)); }
  }
  return { error: 'fetch-failed' };
}

// ---- browser fetcher (JS/bot-walled servers, e.g. Leiden F5) ----
async function fetchBrowser(page, url) {
  for (let t = 0; t < 6; t++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); }
    catch { await sleep(3000 * (t + 1)); continue; }
    await sleep(500);
    const txt = await page.evaluate(() => document.body?.innerText || '');
    if (txt.trim().startsWith('{') && !CHALLENGE_RE.test(txt)) { try { return { manifest: JSON.parse(txt) }; } catch { return { error: 'not-json' }; } }
    if (/no manifest available/i.test(txt)) return { error: 'no-manifest' };
    await sleep(4000 * (t + 1));
  }
  return { error: 'challenged' };
}

// Vatican dates are "Sec. XII in.", "sec. XV-XVI", or a year. parseDateRange's roman branch
// matches only after a bare "s." and reads "XII" as XI, so it is not reused here.
const ROMAN = { I: 1, V: 5, X: 10, L: 50 };
const romanToInt = r => [...r.toUpperCase()].reduce((acc, ch, i, a) => acc + (ROMAN[ch] < (ROMAN[a[i + 1]] || 0) ? -ROMAN[ch] : ROMAN[ch]), 0);
function vaticanDate(text) {
  if (!text) return { earliest: null, latest: null };
  const y = text.match(/\b(1[0-9]{3}|[5-9][0-9]{2})\b/g);
  if (y) { const n = y.map(Number); return { earliest: Math.min(...n), latest: Math.max(...n) }; }
  const c = text.match(/sec(?:olo|\.)?\s*([IVXL]+)\b(?:\s*[-–]\s*([IVXL]+)\b)?/i);
  if (!c) return { earliest: null, latest: null };
  const a = romanToInt(c[1]), b = c[2] ? romanToInt(c[2]) : a;
  return a > 0 && b >= a && b <= 21 ? { earliest: (a - 1) * 100 + 1, latest: b * 100 } : { earliest: null, latest: null };
}
const VATICAN_LANG = { latino: 'Latin', greco: 'Greek', ebraico: 'Hebrew', arabo: 'Arabic', siriaco: 'Syriac', copto: 'Coptic', armeno: 'Armenian', etiopico: "Ge'ez", "ge'ez": "Ge'ez", georgiano: 'Georgian', turco: 'Ottoman Turkish', persiano: 'Persian', italiano: 'Italian', francese: 'French', tedesco: 'German', spagnolo: 'Spanish', cinese: 'Chinese', samaritano: 'Samaritan', sanscrito: 'Sanskrit', tamil: 'Tamil', malayalam: 'Malayalam', 'slavo ecclesiastico': 'Church Slavonic', paleoslavo: 'Church Slavonic', karshuni: 'Garshuni', garshuni: 'Garshuni', aramaico: 'Aramaic', 'giudeo-arabo': 'Judeo-Arabic' };
// Most oriental fonds are single-language by construction; used only when the manifest names none.
// Mixed fonds (Vat.estr.or, Vat.ind, Borg.ind, Barb.or) are deliberately absent: Unknown beats a guess.
const VATICAN_FONDS_LANG = [
  [/^(Vat|Borg)\.sir\./, 'Syriac'], [/^(Vat|Borg|Pap\.Vat)\.copt\./, 'Coptic'], [/^(Vat|Borg)\.ar\./, 'Arabic'], [/^Sbath\./, 'Arabic'],
  [/^(Vat|Borg)\.arm\./, 'Armenian'], [/^(Vat|Borg|Cerulli)\.et\./, "Ge'ez"], [/^Vat\.iber\./, 'Georgian'],
  [/^(Vat|P\.I\.O)\.slav\./, 'Church Slavonic'], [/^(Vat|Borg)\.turc\./, 'Ottoman Turkish'], [/^(Vat|Borg|Cerulli)\.pers\./, 'Persian'],
  [/^(Vat|Urb|Borg)\.ebr\./, 'Hebrew'], [/^Neofiti\./, 'Hebrew'], [/^Vat\.sam\./, 'Samaritan'], [/^Borg\.cin\./, 'Chinese'], [/^Borg\.tonch\./, 'Vietnamese'],
];
function vaticanEnrich(c, m) {
  const md = m.metadata || [];
  const get = l => { const v = md.find(x => String(extractLabel(x.label) || '').toLowerCase() === l)?.value; return v == null ? null : (Array.isArray(v) ? v.map(x => extractLabel(x) || x).join('; ') : extractLabel(v) || String(v)); };
  const out = {};
  const shelf = get('shelfmark') || extractLabel(m.label) || c.title;
  // The shelfmark goes INTO the title, always. Each manuscript is unique, but two copies of one text
  // with no author and a century date share an edition_key (title|author|year), and the acquisition
  // gate would decline the second as a duplicate. Heidelberg titles already carry theirs ("Cod. Pal.
  // germ. 1: …"); this gives Vatican the same shape.
  const work = (get('title') || (c.title && c.title !== shelf ? c.title : '')).replace(/\s+/g, ' ').trim();
  if (shelf) out.title = work && !work.includes(shelf) ? `${work.slice(0, 400)} (${shelf})` : (work || shelf);
  if (shelf) out['metadata.shelfmark'] = shelf;
  const author = get('other name') || get('author');
  if (author && (!c.author || c.author === 'Unknown')) out.author = author.slice(0, 300);
  const lang = get('language') || VATICAN_FONDS_LANG.find(([re]) => re.test(shelf || ''))?.[1];
  if (lang && (!c.language || c.language === 'Unknown')) {
    const names = lang.split(/[;,]/).map(x => x.trim()).filter(Boolean);
    const mapped = names.map(n => VATICAN_LANG[n.toLowerCase()] || n);
    out.language = mapped[0];
    if (mapped.length > 1) out.languages = mapped;
  }
  const date = get('date');
  if (date && !c.date_text) { const d = vaticanDate(date); out.date_text = date; out.date_earliest = d.earliest; out.date_latest = d.latest; }
  return out;
}

const { client, db } = await getScriptClient({ noTimeout: true });
const col = db.collection('import_candidates');
const filter = { status: 'discovered' };
if (SOURCE) filter.source = SOURCE;
if (COLLECTION) filter.categories = COLLECTION;
if (!REFETCH) filter['manifest_cache.harvested_at'] = { $exists: false };
if (OAI_ID_RE) filter.oai_id = OAI_ID_RE;
if (MAX_YEAR) filter.date_earliest = { $lte: MAX_YEAR };

const cands = await col.find(filter).limit(LIMIT).toArray();
const fetcher = fetcherFor(SOURCE);
console.log(`[harvest-manifests] ${cands.length} candidates (source=${SOURCE || 'all'}, collection=${COLLECTION || 'all'}) via ${fetcher} fetcher\n`);

let browser = null, page = null;
if (fetcher === 'browser') { browser = await chromium.launch({ headless: true }); page = await (await browser.newContext({ userAgent: UA })).newPage(); }

let cached = 0, restricted = 0, errors = 0, idx = 0;
for (const c of cands) {
  idx++;
  const res = fetcher === 'browser' ? await fetchBrowser(page, c.manifest_url) : await fetchPlain(c.manifest_url);
  if (res.error) { errors++; if (errors <= 8) console.log(`  [err ${idx}/${cands.length}] ${c.source_id || c.manifest_url} → ${res.error}`); await sleep(DELAY_MS ?? (fetcher === 'browser' ? 1200 : 200)); continue; }

  const m = res.manifest;
  const pages = manifestToPages(m);
  const rights = manifestRights(m);
  const label = extractLabel(m.label) || c.title;

  // Enrich candidate metadata from the manifest when the adapter left it blank
  // (supports a lightweight enumerate-only adapter — manifest is the source of truth).
  const meta = extractManifestMetadata(m);
  const enrich = {};
  const blank = v => !v || v === 'Unknown' || v === '(pending)';
  if (blank(c.title) && meta.title) enrich.title = meta.title;
  if (blank(c.author) && meta.author) enrich.author = meta.author;
  if (blank(c.language) && meta.language) enrich.language = meta.language;
  if (!c.date_text && meta.date_text) { enrich.date_text = meta.date_text; enrich.date_earliest = meta.date_earliest; enrich.date_latest = meta.date_latest; }
  // Vatican rows are shelfmark-only: the candidate title IS the shelfmark, and so is the manifest
  // label, so the blank-title rule above never fires. The work title lives in metadata 'Title'.
  if (c.source === 'vatican') Object.assign(enrich, vaticanEnrich(c, m));

  if (!rights.open && DROP_RESTRICTED) {
    restricted++;
    await col.updateOne({ _id: c._id }, { $set: { status: 'skipped', skip_reason: `rights:${rights.label}`, 'manifest_cache.rights': rights.label, 'manifest_cache.harvested_at': new Date() } });
    await sleep(DELAY_MS ?? (fetcher === 'browser' ? 700 : 100)); continue;
  }

  await col.updateOne({ _id: c._id }, {
    $set: {
      ...enrich,
      page_count: pages.length,
      'metadata.rights': rights.label,
      manifest_cache: { harvested_at: new Date(), canvas_count: pages.length, rights: rights.label, license: rights.text.slice(0, 300), label: String(label).slice(0, 500), pages },
    },
  });
  cached++;
  if (!rights.open) restricted++;
  if (cached <= 3 || cached % 50 === 0) console.log(`  cached [${cached}] ${String(label).slice(0, 50)} — ${pages.length}pp, ${rights.label}`);
  await sleep(DELAY_MS ?? (fetcher === 'browser' ? 700 : 100));
}

console.log(`\n[harvest-manifests] done: ${cached} cached, ${restricted} restricted-rights, ${errors} errors`);
if (browser) await browser.close();
await client.close();
