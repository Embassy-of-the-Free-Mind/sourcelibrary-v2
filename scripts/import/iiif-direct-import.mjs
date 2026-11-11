#!/usr/bin/env node
/**
 * Generalized direct-to-MongoDB IIIF importer (provider-agnostic).
 *
 * WHY THIS EXISTS: the HTTP import route (/api/import/iiif, /api/import/ia) runs
 * in a Vercel serverless function and creates every page synchronously in one
 * request. On large volumes (Patrologia Graeca / Bonn corpus / MDZ folios are
 * 600-1000pp) that blows the function budget and saturates the serverless->Atlas
 * connection pool — it times out with MongoNetworkTimeoutError and, at
 * concurrency, can degrade the whole site. This importer writes book + pages
 * DIRECTLY to Mongo (maxPoolSize 3, pages in 500-row batches), so volume size is
 * irrelevant and it never touches the API layer.
 *
 * Derived from scripts/import/bsb-from-file.mjs (which was BSB-only); this one
 * takes provider/source metadata from the input file so it works for IA, MDZ,
 * Gallica, e-rara, or any IIIF v2/v3 manifest.
 *
 * INPUT: a JSON array of entries. Required: manifest_url, title. Optional:
 *   author, year, language, collections[], provider, provider_name, source_url,
 *   source_id, license, license_url, contributing_library, manifest_file,
 *   iiif_size (v2 full-image size keyword, default `full`; `max` for hosts that
 *   refuse `full`).
 *   `manifest_file` is a local copy of the manifest, read instead of fetching
 *   manifest_url — for a host whose manifest endpoint is unreachable from the
 *   box (e.g. an expired TLS certificate) while its image server is fine.
 *   manifest_url is still what is stored and deduped on.
 *
 * Usage (run on Hetzner — direct Mongo, no API auth needed):
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/iiif-direct-import.mjs --data=/root/pg-import.json
 *   node scripts/import/iiif-direct-import.mjs --data=/root/pg-import.json --dry-run
 * Options: --dry-run  --limit=N  --delay=<ms,default 1500>  --start-from=N  --concurrency=N(default 1)
 *          --sweep=<name>  record each import as a `sweep_log` row (the wave tag;
 *                          a row, never a new field — field-sprawl.md)
 *          --hold=<reason> --release-when=<issue:N|decision:..|test:..|date:..> [--hold-release=<text>]
 *                          insert the book already held (pipeline-hold.mjs), as
 *                          ia-manifest-direct.mjs does, so no lane picks it up
 *                          between the insert and a later holdBook()
 */

import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { holdBook, makeHoldMarker, parseReleaseWhen, HOLD_STATUS, HOLD_EVENT } from '../lib/pipeline-hold.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;
const DELAY = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '1500');
const START_FROM = parseInt(args.find(a => a.startsWith('--start-from='))?.split('=')[1] || '0');
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '1');
const DATA_FILE = args.find(a => a.startsWith('--data='))?.split('=')[1];
const LOG_FILE = args.find(a => a.startsWith('--log='))?.split('=')[1] || '/root/iiif-direct-import.log';
const SWEEP = args.find(a => a.startsWith('--sweep='))?.split('=')[1] || null;
const argVal = (name) => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const HOLD_REASON = argVal('hold');
const HOLD = HOLD_REASON ? {
  reason: HOLD_REASON,
  release: argVal('hold-release') || `Held at import by iiif-direct-import.mjs (--hold=${HOLD_REASON}); release with --to queued so OCR runs from scratch.`,
  release_when: parseReleaseWhen(argVal('release-when')),
  source: 'script:iiif-direct-import',
} : null;
if (HOLD?.release_when?.kind === 'issue') HOLD.issue = Number(HOLD.release_when.ref) || null;
// Refuse before the first insert: a hold that throws after insertBookIfNew leaves the book imported and unheld (#7860).
if (HOLD) { try { makeHoldMarker(HOLD); } catch (e) { console.error(`${e.message}\n  pass --release-when=issue:<N> | decision:<words> | test:<check> | date:YYYY-MM-DD`); process.exit(2); } }

if (!DATA_FILE || !fs.existsSync(DATA_FILE)) { console.error(`--data=<file> required and must exist (got: ${DATA_FILE})`); process.exit(1); }
const entries = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

function slugify(text, maxLen = 60) {
  if (!text) return 'untitled';
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, maxLen).replace(/-$/, '');
}
function generateSlug(title, author) {
  const slugTitle = slugify(title, 60);
  const lastName = (author || '').split(',')[0].trim();
  const slugAuthor = slugify(lastName, 20);
  if (!slugAuthor || slugAuthor === 'unknown') return slugTitle;
  return `${slugTitle}-${slugAuthor}`;
}
async function ensureUniqueSlug(db, slug) {
  let candidate = slug, counter = 1;
  while (await db.collection('books').findOne({ slug: candidate }, { projection: { _id: 1 } })) {
    candidate = `${slug}-${counter}`; counter++;
  }
  return candidate;
}
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)', 'Accept': 'application/json, application/ld+json' },
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) return await res.json();
      if (res.status === 429) { await new Promise(r => setTimeout(r, 10000)); continue; }
      if (i === retries - 1) return null;
    } catch (e) {
      if (i === retries - 1) { log(`  fetch error: ${e.message}`); return null; }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  return null;
}
// IIIF v2 (sequences/canvases) + v3 (items). Returns [{photo, thumbnail}].
// `size` is the v2 size keyword for the full image. Most servers honour `full`;
// a few refuse it and serve only `max` (image.library.jhu.edu answers 403 to
// `/full/full/`, 200 to `/full/max/`). The archiver tile-stitches past any
// maxArea cap, so `max` still archives at native resolution.
function extractPages(manifest, size = 'full') {
  if (manifest?.items?.length) {
    return manifest.items.map(item => {
      const body = item.items?.[0]?.items?.[0]?.body;
      const service = Array.isArray(body?.service) ? body.service[0] : body?.service;
      const serviceId = service?.id || service?.['@id'];
      let imageUrl = body?.id || body?.['@id'] || '', thumbnail = imageUrl;
      if (serviceId) { imageUrl = `${serviceId}/full/max/0/default.jpg`; thumbnail = `${serviceId}/full/200,/0/default.jpg`; }
      return { photo: imageUrl, thumbnail };
    }).filter(p => p.photo);
  }
  const canvases = manifest?.sequences?.[0]?.canvases || [];
  return canvases.map(canvas => {
    const res = canvas.images?.[0]?.resource;
    let imageUrl = res?.['@id'] || '';
    const svc = res?.service?.['@id'];
    let thumbnail = imageUrl;
    if (svc) { imageUrl = `${svc}/full/${size}/0/default.jpg`; thumbnail = `${svc}/full/200,/0/default.jpg`; }
    return { photo: imageUrl, thumbnail };
  }).filter(p => p.photo);
}

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

let imported = 0, skipped = 0, errors = 0, totalPages = 0;

async function processEntry(db, entry, idx) {
  const prefix = `[${idx + 1}/${entries.length}] ${entry.source_id || entry.manifest_url}`;
  const manifestUrl = entry.manifest_url;
  if (!manifestUrl) { log(`${prefix} SKIP — no manifest_url`); skipped++; return; }

  // Dedupe by manifest URL
  const existing = await db.collection('books').findOne({ 'image_source.iiif_manifest': manifestUrl }, { projection: { _id: 1, slug: 1 } });
  if (existing) { skipped++; return; }

  if (DRY_RUN) { log(`${prefix} DRY-RUN "${(entry.title || '').substring(0, 55)}"`); imported++; return; }

  const manifest = entry.manifest_file
    ? JSON.parse(fs.readFileSync(entry.manifest_file, 'utf8'))
    : await fetchWithRetry(manifestUrl);
  if (!manifest) { log(`${prefix} ERROR — manifest fetch failed`); errors++; return; }
  const pages = extractPages(manifest, entry.iiif_size || 'full');
  if (!pages.length) { log(`${prefix} ERROR — no pages in manifest`); errors++; return; }

  try {
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const slug = await ensureUniqueSlug(db, generateSlug(entry.title, entry.author));
    const now = new Date();
    const acquired = await insertBookIfNew(db, {
      _id: bookId, id: bookIdStr, slug,
      title: entry.title || 'Unknown', author: entry.author || 'Unknown',
      language: entry.language || 'Unknown', published: entry.year ? String(entry.year) : 'Unknown',
      categories: [], collections: entry.collections || [],
      thumbnail: pages[0]?.thumbnail || '', pages_count: pages.length, pages_ocr: 0, pages_translated: 0,
      image_source: {
        provider: entry.provider || 'iiif',
        provider_name: entry.provider_name || 'IIIF',
        source_url: entry.source_url || manifestUrl,
        source_id: entry.source_id || null,
        iiif_manifest: manifestUrl,
        license: entry.license || null,
        license_url: entry.license_url || null,
        contributing_library: entry.contributing_library || entry.provider_name || null,
        access_date: new Date(),
      },
      status: 'draft', hidden: true, visible: false,
      ...(HOLD ? { pipeline_auto: { status: HOLD_STATUS, hold: makeHoldMarker({ ...HOLD, detail: null }, { from: null, now }), last_updated: now } } : {}),
      created_at: now, updated_at: now,
    }, { importer: 'script:iiif-direct-import', sourceIdentifier: entry.source_id || null, sourceUrl: manifestUrl });
    // The gate declined this candidate; the reason is a row in `dedup_skips`.
    if (!acquired.inserted) { log(`${prefix} SKIP — ${acquired.message}`); skipped++; return; }
    if (HOLD) {
      // The hold went in with the insert; record it the way holdBook() does, and confirm it is there.
      await db.collection('book_events').insertOne({ book_id: bookIdStr, type: HOLD_EVENT, at: now, source: HOLD.source,
        details: { reason: HOLD.reason, issue: HOLD.issue ?? null, from_status: null, release: HOLD.release, release_when: makeHoldMarker(HOLD).release_when, at_insert: true } });
      const back = await db.collection('books').findOne({ id: bookIdStr }, { projection: { 'pipeline_auto.hold.reason': 1 } });
      if (back?.pipeline_auto?.hold?.reason !== HOLD.reason) {
        const h = await holdBook(db, bookIdStr, HOLD);
        log(`${prefix} WARN — hold not found after insert; holdBook: ${h.outcome}`);
        if (h.outcome !== 'held') { log(`${prefix} ERROR — book inserted but NOT held; no pages written`); errors++; return; }
      }
    }
    for (let start = 0; start < pages.length; start += 500) {
      const chunk = pages.slice(start, start + 500).map((p, j) => {
        const pageId = new ObjectId();
        return makePageDoc({ _id: pageId, id: pageId.toHexString(), book_id: bookIdStr,
          page_number: start + j + 1, photo: p.photo, thumbnail: p.thumbnail, photo_original: p.photo,
          created_at: new Date(), updated_at: new Date() });
      });
      await db.collection('pages').insertMany(chunk, { ordered: false });
    }
    if (SWEEP) {
      await recordSweepAction(db, { sweep: SWEEP, book_id: bookIdStr, action: 'imported-hidden',
        detail: { importer: 'iiif-direct-import', source_id: entry.source_id || null, manifest_url: manifestUrl, pages: pages.length } });
    }
    totalPages += pages.length; imported++;
    log(`${prefix} OK ${pages.length}p — "${(entry.title || '').substring(0, 55)}" -> /book/${slug}`);
  } catch (err) { log(`${prefix} ERROR: ${err.message}`); errors++; }
}

async function main() {
  log(`iiif-direct-import: ${entries.length} entries | dry=${DRY_RUN} limit=${LIMIT === Infinity ? 'none' : LIMIT} conc=${CONCURRENCY} start=${START_FROM}`);
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');
  const list = entries.slice(START_FROM).map((e, i) => [e, START_FROM + i]);
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    if (imported >= LIMIT) { log(`reached --limit=${LIMIT}`); break; }
    await Promise.all(list.slice(i, i + CONCURRENCY).map(([e, idx]) => processEntry(db, e, idx).catch(err => { log(`entry error: ${err.message}`); errors++; })));
    await new Promise(r => setTimeout(r, DELAY));
  }
  await client.close();
  log(`DONE — imported ${imported}, skipped(dupe) ${skipped}, errors ${errors}, pages ${totalPages}`);
}
main().catch(e => { console.error(e); process.exit(1); });
