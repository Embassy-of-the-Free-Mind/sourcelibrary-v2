#!/usr/bin/env node
/**
 * Stage 3 of the pipeline: OFFLINE import from cached manifests. No network.
 *
 *   enumerate → import_candidates → harvest-manifests (cache) → THIS
 *
 * Reads candidates whose manifest_cache is populated and inserts them into the
 * `books` collection — source-agnostic, using the candidate fields + cached
 * pages. Because everything is already in Mongo, this is fast, idempotent, and
 * fully resumable (re-run skips imported + in-memory dedups).
 *
 * Routing by shape:
 *   - 1 cached page  → content_type:'artwork' (single object; --artwork-type)
 *   - >1 cached page → content_type:'book' + per-page docs (--book-type)
 *
 * Images are HOT-LINKED from the cached IIIF URLs (the Met/Rijks/Leiden pattern).
 * Imports land HIDDEN by default (review → QA → flip visible). Sets
 * pipeline_auto.status:'complete' for artworks and for --facsimile books, so the
 * OCR cron leaves facsimile-only material alone.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/iiif-discovery/import-from-cache.mjs --source=leiden --collection=ubl_maps --sl-collection=indonesian-maps --book-type=map --facsimile --dry-run
 *   node scripts/iiif-discovery/import-from-cache.mjs --source=leiden --collection=ubl_maps --sl-collection=indonesian-maps --book-type=map --facsimile
 *   node scripts/iiif-discovery/import-from-cache.mjs --source=erara --limit=200            # generic books, will OCR
 *
 * Options:
 *   --source=<s>            candidate source (default: all)
 *   --collection=<slug>     candidate category filter (source-side slug)
 *   --sl-collection=<slug>  Source Library collection to tag
 *   --artwork-type=<t>      resource_type for 1-canvas items (default: print)
 *   --book-type=<t>         resource_type for multi-canvas items (optional)
 *   --facsimile             keep books out of OCR cron (pipeline_auto.complete)
 *   --provider-name=<name>  override display provider name
 *   --limit=N               max books this run
 *   --publish               import live+visible (default: hidden)
 *   --dry-run               no writes
 */

import { ObjectId } from 'mongodb';
import { getScriptClient } from '../lib/mongo.mjs';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);
const SOURCE = args.source || null;
const COLLECTION = args.collection || null;
const SL_COLLECTION = args['sl-collection'] || null;
const ARTWORK_TYPE = args['artwork-type'] || 'print';
const BOOK_TYPE = args['book-type'] || null;
const FACSIMILE = 'facsimile' in args;
const PROVIDER_NAME = args['provider-name'] || null;
const LIMIT = parseInt(args.limit) || 100000;
const PUBLISH = 'publish' in args;
const DRY_RUN = 'dry-run' in args;

const slugify = (t, max = 70) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max).replace(/-$/, '');
const normTitle = t => (t || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
const normAuthor = a => (a || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
const licenseFor = r => r === 'public-domain' ? 'publicdomain' : (r === 'cc-by' ? 'CC-BY-4.0' : (r || 'unknown'));
const yearFrom = text => { const m = (text || '').match(/\b(1[0-9]{3}|20[0-2][0-9])\b/); return m ? parseInt(m[1]) : null; };

const { client, db } = await getScriptClient({ noTimeout: true });
async function uniqueSlug(base) { let slug = base || 'item', i = 2; while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) slug = `${base}-${i++}`; return slug; }

const filter = { status: 'discovered', 'manifest_cache.harvested_at': { $exists: true } };
if (SOURCE) filter.source = SOURCE;
if (COLLECTION) filter.categories = COLLECTION;
const cands = await db.collection('import_candidates').find(filter).limit(LIMIT).toArray();
console.log(`[import-cache] ${cands.length} cached candidates (source=${SOURCE || 'all'}, collection=${COLLECTION || 'all'}) → ${SL_COLLECTION || '(no collection)'}, ${PUBLISH ? 'PUBLISH' : 'hidden'}${FACSIMILE ? ', facsimile' : ''}\n`);

// In-memory dedup against existing books from this source
const existingFp = new Map();
const dedupQuery = SOURCE ? { 'image_source.provider': SOURCE } : {};
for (const b of await db.collection('books').find(dedupQuery, { projection: { id: 1, source_fingerprint: 1, 'image_source.iiif_manifest': 1 } }).toArray()) {
  if (b.source_fingerprint) existingFp.set(b.source_fingerprint, b.id);
  if (b.image_source?.iiif_manifest) existingFp.set(b.image_source.iiif_manifest, b.id);
}

let artworks = 0, books = 0, pagesTotal = 0, skipped = 0, failed = 0, idx = 0;
for (const c of cands) {
  idx++;
  const mc = c.manifest_cache;
  const pages = mc?.pages || [];
  if (!pages.length) { failed++; if (failed <= 5) console.log(`  [fail] ${c.source_id} — no cached pages`); continue; }

  const fp = `${c.source}:${c.source_id || c.manifest_url}`;
  if (existingFp.has(fp) || existingFp.has(c.manifest_url)) {
    skipped++;
    if (!DRY_RUN) await db.collection('import_candidates').updateOne({ _id: c._id }, { $set: { status: 'imported', book_id: existingFp.get(fp) || existingFp.get(c.manifest_url), imported_at: new Date() } });
    continue;
  }

  const isArtwork = pages.length === 1;
  const title = (c.title || mc.label || `${c.source} item`).slice(0, 500);
  const author = c.author && c.author !== 'Unknown' ? c.author : 'Unknown';
  const year = yearFrom(c.date_text);

  if (DRY_RUN) {
    if (idx <= 15) console.log(`  ${isArtwork ? 'ART ' : 'BOOK'} | ${title.slice(0, 48)} | ${author.slice(0, 18)} | ${pages.length}pp | ${mc.rights}`);
    isArtwork ? artworks++ : books++; pagesTotal += pages.length; continue;
  }

  const now = new Date();
  const slug = await uniqueSlug(slugify(title));
  const bookId = new ObjectId();
  const facsimile = isArtwork || FACSIMILE;
  const doc = makeBookDoc({
    _id: bookId, id: bookId.toHexString(), slug,
    title, display_title: title, author,
    language: c.language && c.language !== 'Unknown' ? c.language : 'Unknown',
    published: c.date_text || 'Unknown', ...(year ? { year } : {}),
    thumbnail: pages[0].thumbnail || pages[0].photo || '',
    ...(isArtwork ? { image_display: pages[0].photo, image_source_url: pages[0].photo, commons_full_url: pages[0].photo } : {}),
    pageCount: pages.length, pages_count: pages.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
    content_type: isArtwork ? 'artwork' : 'book',
    resource_type: isArtwork ? ARTWORK_TYPE : (BOOK_TYPE || undefined),
    status: PUBLISH ? 'live' : 'draft', hidden: !PUBLISH, visible: PUBLISH,
    categories: isArtwork ? ['visual-art'] : [],
    ...(SL_COLLECTION ? { collections: [SL_COLLECTION] } : {}),
    ...(facsimile ? { pipeline_auto: { status: 'complete', note: isArtwork ? 'artwork facsimile (no OCR)' : 'facsimile-only (handwritten/untrusted OCR)', updated_at: now } } : {}),
    image_source: {
      provider: c.source, provider_name: PROVIDER_NAME || c.provider_name || c.origin_library || c.source,
      source_url: c.source_url || c.manifest_url, iiif_manifest: c.manifest_url,
      license: licenseFor(mc.rights),
      ...(c.origin_library ? { contributing_library: c.origin_library } : {}),
      access_date: now,
    },
    dublin_core: { dc_identifier: [fp], dc_source: c.source_url || c.manifest_url },
    ...(c.metadata?.shelfmark ? { shelfmark: c.metadata.shelfmark } : {}),
    ...(c.metadata?.subject_geographic ? { subject_geographic: c.metadata.subject_geographic } : {}),
    source_fingerprint: fp, normalized_title: normTitle(title), normalized_author: normAuthor(author),
    created_at: now, updated_at: now,
  });
  if (doc.resource_type === undefined) delete doc.resource_type;

  try {
    await db.collection('books').insertOne(doc);
    if (!isArtwork) {
      const CHUNK = 500;
      for (let s = 0; s < pages.length; s += CHUNK) {
        const pdocs = pages.slice(s, s + CHUNK).map((p, k) => { const pid = new ObjectId(); return makePageDoc({ _id: pid, id: pid.toHexString(), book_id: doc.id, page_number: s + k + 1, photo: p.photo, photo_original: p.photo, thumbnail: p.thumbnail, created_at: now, updated_at: now }); });
        await db.collection('pages').insertMany(pdocs, { ordered: false });
      }
    }
    await db.collection('import_candidates').updateOne({ _id: c._id }, { $set: { status: 'imported', book_id: doc.id, imported_at: now } });
    existingFp.set(fp, doc.id);
    isArtwork ? artworks++ : books++; pagesTotal += pages.length;
    if ((artworks + books) <= 3 || (artworks + books) % 50 === 0) console.log(`  ${isArtwork ? 'ART' : 'BOOK'} [${artworks + books}] ${title.slice(0, 45)} (${pages.length}pp) → /book/${slug}`);
  } catch (e) { failed++; console.log(`  [fail] ${c.source_id} → ${e.message.slice(0, 80)}`); }
}

console.log(`\n[import-cache] done: ${artworks} artworks + ${books} books (${pagesTotal} pages), ${skipped} already-present, ${failed} failed`);
if (!DRY_RUN && !PUBLISH && (artworks + books) > 0) console.log(`[import-cache] imported HIDDEN — review, then --publish (or flip visible) + sync-books-catalog.`);
await client.close();
