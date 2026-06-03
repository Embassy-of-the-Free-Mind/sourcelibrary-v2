#!/usr/bin/env node
/**
 * Leiden University Libraries — Digital Collections discovery crawler.
 *
 * Leiden runs an **Islandora 7** (Drupal + Fedora + Solr) platform, fronted by
 * **F5 Shape / TSPD bot protection**. Plain curl/fetch — even from a residential
 * IP — gets a JS challenge page (HTTP 200, no data). So we drive a real browser
 * (Playwright) which executes the challenge, then page the Solr search and read
 * IIIF manifests through the warmed browser context. (Same tactic as the KU
 * Leuven harvester in scripts/research/.)
 *
 * Channel (reverse-engineered 2026-06-03, all public, no credentials):
 *   - Search:   /islandora/search?type=dismax&f[0]=<facet>&page=N   (20 hits/page, HTML)
 *               Use /islandora/search — the bare /search route is challenged harder.
 *   - Collection facet:  RELS_EXT_isMemberOfCollection_uri_ms:"info:fedora/collection:<slug>"
 *   - Result links:      /view/item/<NNNN>   → item id = NNNN
 *   - Manifest:          https://digitalcollections.universiteitleiden.nl/iiif_manifest/item:<NNNN>/manifest
 *                        (IIIF Presentation v2; images on https://iiif.universiteitleiden.nl/iiif/2/)
 *   - Rights:            manifest.attribution (HTML) — "public domain" / "CC-BY" = importable;
 *                        "within the library premises" = restricted, skip.
 *
 * Indonesian / Southeast-Asian collection slugs (counts ≈ full collection):
 *   balinese_narrative_drawings  Balinese Narrative Drawings (van der Tuuk) — ART, ~434, all PD
 *   ubl_manuscripts              GLOBAL manuscripts collection (mostly European VLQ codices).
 *                                For Indonesian mss, narrow with --extra-facet country=Indonesia
 *                                → 139 PD multi-page codices (Diponegoro, Pasai Sufi 1629, etc.).
 *   kitlv_maps / KIT_maps / ubl_maps   Maps & atlases (mostly PD)
 *   kitlv_photos / kern / photoalbums  Photography (huge — curate before bulk)
 *   indonesianprinted / aceh_books     Printed books (mostly post-1900 → restricted)
 *   sinomalay                    (Sino-)Malay popular fiction — NO public IIIF manifests
 *                                ({"error":"No manifest available"}); not harvestable here.
 *
 * Narrowing a global collection: add a second Solr facet, e.g.
 *   --extra-facet="mods_originInfo_place_placeTerm_text_authority_marccountry_ms:Indonesia"
 *   --extra-facet="mods_subject_geographic_ms:Indonesia"
 * (Useful facet fields: ...marccountry_ms, mods_subject_geographic_ms, language facets.)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/iiif-discovery/sources/leiden.mjs --collection=balinese_narrative_drawings
 *   node scripts/iiif-discovery/sources/leiden.mjs --collection=ubl_manuscripts --max-records=200
 *   node scripts/iiif-discovery/sources/leiden.mjs --collection=balinese_narrative_drawings --dry-run
 *
 * Options:
 *   --collection=<slug>   Fedora collection slug (required)
 *   --max-records=N       Stop after N items enumerated (default: 100000)
 *   --include-restricted  Keep items whose rights aren't clearly open (default: skip)
 *   --dry-run             Enumerate + read manifests, print, but don't write to DB
 *   --headed              Run browser non-headless (debugging)
 */

import { chromium } from 'playwright';
import { getScriptClient } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidate } from '../lib/candidate-store.mjs';
import { parseDateRange } from '../lib/iiif-metadata.mjs';

const SOURCE = 'leiden';
const HOST = 'https://digitalcollections.universiteitleiden.nl';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PAGE_SIZE = 20; // Islandora fixed page size
const sleep = ms => new Promise(r => setTimeout(r, ms));

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('='); return [k, v ?? true];
  })
);
const COLLECTION = args.collection;
const MAX_RECORDS = parseInt(args['max-records']) || 100000;
const DRY_RUN = 'dry-run' in args;
const INCLUDE_RESTRICTED = 'include-restricted' in args;
const HEADED = 'headed' in args;
// Lightweight mode: record id + manifest_url only (no per-item manifest fetch).
// Metadata + rights + pages are filled later by harvest-manifests.mjs. This is
// the decoupled pipeline: enumerate → harvest-manifests → import-from-cache.
const ENUMERATE_ONLY = 'enumerate-only' in args;

if (!COLLECTION) {
  console.error('ERROR: --collection=<slug> is required (e.g. balinese_narrative_drawings)');
  process.exit(1);
}

// Fedora collection facet, with the backslash-escaping Islandora's Solr query parser expects.
function collectionFacet(slug) {
  const v = `info\\:fedora\\/collection\\:${slug}`;
  return `RELS_EXT_isMemberOfCollection_uri_ms:%22${encodeURIComponent(v).replace(/%5C/g, '%5C')}%22`;
}

// Optional second facet to narrow a global collection, e.g.
//   --extra-facet="mods_originInfo_place_placeTerm_text_authority_marccountry_ms:Indonesia"
//   --extra-facet="mods_language_..._ms:Javanese"
// Pass as field:value (value is plain text; we URL-encode it).
function extraFacetParam(spec) {
  if (!spec) return null;
  const i = spec.indexOf(':');
  const field = spec.slice(0, i), value = spec.slice(i + 1);
  return `${field}:%22${encodeURIComponent(value)}%22`;
}

const firstStr = v => Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
function langClean(v) {
  // Leiden stores some values as {"@value":"Dutch","@language":"eng"} JSON strings
  if (typeof v === 'string' && v.startsWith('{')) { try { return JSON.parse(v)['@value'] || v; } catch { return v; } }
  return v;
}

/** Classify rights from the manifest attribution/license text. */
function classifyRights(text = '') {
  const t = text.toLowerCase();
  if (/within the library premises|on campus|not available off|toegang.*bibliotheek/.test(t)) return { open: false, label: 'restricted' };
  if (/public\s*domain|publicdomain/.test(t)) return { open: true, label: 'public-domain' };
  if (/creativecommons\.org\/licenses\/by|cc[\s-]?by/.test(t)) return { open: true, label: 'cc-by' };
  if (/full access/.test(t)) return { open: true, label: 'full-access' };
  return { open: false, label: 'unknown' };
}

// F5 Shape serves a JS challenge shell (HTTP 200) when it throttles. Detect it so we can back off.
const CHALLENGE_RE = /bobcmn|support id is|failureConfig/i;
async function bodyText(page) { return page.evaluate(() => document.body?.innerText || document.documentElement?.outerHTML?.slice(0, 400) || ''); }
async function looksChallenged(page) { return page.evaluate(() => typeof window.bobcmn !== 'undefined'); }

/**
 * Navigate to a page that should yield real content. `ready(page)` returns truthy
 * once the expected content is present. On a challenge/empty shell, back off
 * exponentially and retry — F5 lifts the throttle after a pause.
 */
async function gotoReady(page, url, ready, tries = 6) {
  for (let t = 0; t < tries; t++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); }
    catch { await sleep(3000 * (t + 1)); continue; }
    await sleep(600);
    if (!(await looksChallenged(page))) { const r = await ready(page); if (r) return r; }
    await sleep(4000 * (t + 1)); // exponential-ish backoff: 4s, 8s, 12s, 16s, 20s
  }
  return null;
}

const scrapeIds = page => page.$$eval('a[href*="/view/item/"]', as =>
  [...new Set(as.map(a => { const m = a.getAttribute('href').match(/\/view\/item\/(\d+)/); return m ? m[1] : null; }).filter(Boolean))]);

/**
 * Page the Solr search for one collection. Resilient to F5 throttling: a page
 * that stays challenged after backoff is recorded and RETRIED in a second pass,
 * never truncating the whole collection. Returns ordered list of item ids.
 */
async function enumerateCollection(page) {
  const extra = extraFacetParam(args['extra-facet']);
  const base = `${HOST}/islandora/search?type=dismax&islandora_solr_search_navigation=0&f%5B0%5D=${collectionFacet(COLLECTION)}${extra ? `&f%5B1%5D=${extra}` : ''}`;
  const ids = []; const seen = new Set();
  const pageUrl = p => base + `&page=${p}`;
  const readyIds = async pg => { const f = await scrapeIds(pg); return f.length ? f : null; };
  const addIds = found => { for (const id of found) if (!seen.has(id)) { seen.add(id); ids.push(id); } };

  // Page 0 establishes the reported total → known page count.
  const first = await gotoReady(page, pageUrl(0), readyIds, 8);
  const reported = await page.evaluate(() => { const m = document.body.innerText.match(/of\s+([\d,]+)/i); return m ? m[1] : null; }).catch(() => null);
  const total = Math.min(reported ? parseInt(String(reported).replace(/,/g, '')) : MAX_RECORDS, MAX_RECORDS);
  console.log(`  [enum] collection reports ${reported} items → ${Math.ceil(total / PAGE_SIZE)} pages`);
  if (first) addIds(first);

  const failed = [];
  const nPages = Math.ceil(total / PAGE_SIZE);
  for (let p = 1; p < nPages && ids.length < MAX_RECORDS; p++) {
    const found = await gotoReady(page, pageUrl(p), readyIds, 6);
    if (!found) { failed.push(p); console.log(`  [enum] page ${p}: throttled, deferring`); }
    else { const before = ids.length; addIds(found); if (p % 5 === 0) console.log(`  [enum] page ${p}: ${ids.length} ids (+${ids.length - before})`); }
    await sleep(1000);
  }
  // Second pass over throttled pages, slower.
  if (failed.length) {
    console.log(`  [enum] retrying ${failed.length} throttled pages…`);
    for (const p of failed) {
      const found = await gotoReady(page, pageUrl(p), readyIds, 8);
      if (found) addIds(found); else console.log(`  [enum] page ${p}: still throttled — skipped`);
      await sleep(2000);
    }
  }
  console.log(`  [enum] collected ${ids.length}/${total} ids`);
  return { ids: ids.slice(0, MAX_RECORDS), reported };
}

/**
 * Read a IIIF manifest by NAVIGATING to it (top-level loads pass F5; same-origin
 * XHR fetch gets challenged after a short burst). The JSON arrives as the page body.
 */
async function readManifest(page, id) {
  const url = `${HOST}/iiif_manifest/item:${id}/manifest`;
  const txt = await gotoReady(page, url, async pg => {
    const t = await bodyText(pg);
    return (t.trim().startsWith('{') && !CHALLENGE_RE.test(t)) ? t : null;
  }, 5);
  if (!txt) return { error: 'challenged' };
  let j; try { j = JSON.parse(txt); } catch { return { error: 'not-json' }; }
  const meta = {};
  (j.metadata || []).forEach(m => {
    const k = typeof m.label === 'string' ? m.label : (m.label?.[0]?.['@value'] || JSON.stringify(m.label));
    const v = typeof m.value === 'string' ? m.value : (m.value?.[0]?.['@value'] || (Array.isArray(m.value) ? m.value.map(x => x['@value'] || x).join('; ') : JSON.stringify(m.value)));
    if (k && !(k in meta)) meta[k] = v;
  });
  return {
    label: typeof j.label === 'string' ? j.label : (j.label?.[0]?.['@value'] || ''),
    attribution: j.attribution || '', license: j.license || '',
    canvases: j.sequences?.[0]?.canvases?.length ?? null, meta,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await (await browser.newContext({ userAgent: UA })).newPage();

  console.log(`[leiden] enumerating collection: ${COLLECTION}`);
  const { ids } = await enumerateCollection(page);
  console.log(`[leiden] enumerated ${ids.length} item ids\n`);

  let client = null, db = null;
  // The shared import_candidates collection already carries a NON-unique
  // `manifest_url_lookup` index, which blocks ensureIndexes() from adding the
  // unique one — so insertCandidate's 11000-dup guard never fires and re-runs
  // would duplicate rows. Guard idempotency ourselves with a preloaded URL set.
  const haveUrls = new Set();
  if (!DRY_RUN) {
    ({ client, db } = await getScriptClient({ noTimeout: true }));
    try { await ensureIndexes(db); } catch (e) { console.log(`[leiden] index warning: ${e.message.slice(0, 80)}`); }
    (await db.collection('import_candidates').distinct('manifest_url', { source: SOURCE })).forEach(u => haveUrls.add(u));
    console.log(`[leiden] ${haveUrls.size} existing leiden candidates already in ledger (will skip)\n`);
  }

  let inserted = 0, skippedDup = 0, skippedRights = 0, errors = 0, idx = 0;
  for (const id of ids) {
    idx++;
    const manifest_url = `${HOST}/iiif_manifest/item:${id}/manifest`;
    // Idempotency: skip already-harvested URLs before the expensive manifest nav.
    if (haveUrls.has(manifest_url)) { skippedDup++; continue; }

    // Decoupled pipeline: record id+url only; harvest-manifests.mjs fills the rest.
    if (ENUMERATE_ONLY) {
      if (DRY_RUN) { if (idx <= 12) console.log(`  item:${id}`); inserted++; continue; }
      const res = await insertCandidate(db, {
        manifest_url, source: SOURCE, origin_library: 'Leiden University Libraries',
        provider_name: 'Leiden University Libraries', title: '(pending)', author: 'Unknown',
        categories: [COLLECTION], source_url: `http://hdl.handle.net/1887.1/item:${id}`, source_id: `item:${id}`,
      });
      if (res.inserted) { inserted++; haveUrls.add(manifest_url); if (inserted <= 3 || inserted % 100 === 0) console.log(`  enumerated [${inserted}] item:${id}`); }
      else skippedDup++;
      continue;
    }

    const man = await readManifest(page, id);
    if (man.error) { errors++; if (errors <= 8) console.log(`  [err ${idx}/${ids.length}] item:${id} → ${man.error}`); await sleep(1500); continue; }

    const rights = classifyRights(man.attribution || man.license);
    if (!rights.open && !INCLUDE_RESTRICTED) {
      skippedRights++;
      if (skippedRights <= 3) console.log(`  [skip:rights=${rights.label}] item:${id} ${man.label.slice(0, 50)}`);
      await sleep(900); continue;
    }

    const m = man.meta;
    const dateText = m['Published'] || m['Date issued'] || m['Date'] || null;
    const dr = dateText ? parseDateRange(dateText) : {};
    const candidate = {
      manifest_url: `${HOST}/iiif_manifest/item:${id}/manifest`,
      source: SOURCE,
      origin_library: 'Leiden University Libraries',
      provider_name: 'Leiden University Libraries',
      title: (man.label || m['Title'] || 'Unknown').slice(0, 500),
      author: m['Author/creator'] || m['Author'] || m['Creator'] || 'Unknown',
      language: langClean(m['Language']) || 'Unknown',
      date_text: dateText,
      date_earliest: dr.earliest || null,
      date_latest: dr.latest || null,
      page_count: man.canvases,
      categories: [COLLECTION],
      source_url: m['Persistent URL'] || `http://hdl.handle.net/1887.1/item:${id}`,
      source_id: `item:${id}`,
      metadata: {
        collection: COLLECTION,
        rights: rights.label,
        shelfmark: m['Shelfmark'] || null,
        country: langClean(m['Country']) || null,
        subject_geographic: m['Subject (geographic)'] || null,
        subject_topical: m['Subject (topical)'] || null,
        extent: m['Extent'] || null,
        reference: m['Reference'] || null,
      },
    };

    if (DRY_RUN) {
      if (idx <= 12) console.log(`  ${candidate.title.slice(0, 55)} | ${candidate.author.slice(0, 24)} | ${dateText || '?'} | ${man.canvases}c | ${rights.label}`);
      inserted++; await sleep(900); continue;
    }

    try {
      const res = await insertCandidate(db, candidate);
      if (res.inserted) { inserted++; if (inserted <= 3 || inserted % 50 === 0) console.log(`  NEW [${inserted}/${ids.length}] ${candidate.title.slice(0, 55)} (${dateText || '?'}, ${rights.label})`); }
      else skippedDup++;
    } catch (e) { errors++; console.log(`  [db-err] item:${id} → ${e.message.slice(0, 80)}`); }
    await sleep(900);
  }

  console.log(`\n[leiden] ${COLLECTION} done: ${inserted} ${DRY_RUN ? 'would-insert' : 'inserted'}, ${skippedDup} dup, ${skippedRights} skipped-rights, ${errors} errors`);
  if (client) await client.close();
  await browser.close();
})();
