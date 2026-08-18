#!/usr/bin/env node
/**
 * Import Leiden IIIF candidates as ARTWORKS into the books collection.
 *
 * Why a dedicated importer (not the generic import-batch.mjs / /api/import/iiif):
 *   - These are single-object ARTWORKS (1 canvas), not multi-page books. The
 *     generic path assumes books (min-pages gate, creates a `pages` doc per
 *     canvas, content_type:'book'). We want content_type:'artwork'.
 *   - Leiden's MANIFEST host (digitalcollections.universiteitleiden.nl) is behind
 *     F5 bot protection, so /api/import/iiif's server-side fetch is blocked. But
 *     the IMAGE host (iiif.universiteitleiden.nl) is OPEN and already in the CSP
 *     img-src allowlist — so we hot-link images (Met/Rijks pattern), no R2 needed.
 *   - The IIIF image id is deterministic from the item id, so no browser is
 *     required at import time: all metadata is already in `import_candidates`.
 *
 * Image URL shape (verified): the IIIF identifier is `hdl:1887.1/item:<ID>`,
 * which becomes `hdl:1887.1%252Fitem:<ID>` in the path (the `/` is %2F, then the
 * `%` is %25 → %252F):
 *   https://iiif.universiteitleiden.nl/iiif/2/hdl:1887.1%252Fitem:<ID>/full/<size>/0/default.jpg
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/iiif-discovery/import-leiden-artworks.mjs --collection=balinese_narrative_drawings --dry-run
 *   node scripts/iiif-discovery/import-leiden-artworks.mjs --collection=balinese_narrative_drawings --limit=5
 *   node scripts/iiif-discovery/import-leiden-artworks.mjs --collection=balinese_narrative_drawings   # all, hidden
 *   node scripts/iiif-discovery/import-leiden-artworks.mjs --collection=balinese_narrative_drawings --publish
 *
 * Options:
 *   --collection=<slug>     Leiden Fedora slug filter on candidates (categories[])
 *   --sl-collection=<slug>  Source Library collection slug to tag (default derived)
 *   --resource-type=<t>     artwork resource_type (default: drawing)
 *   --limit=N               max to import this run
 *   --publish               import as live+visible (default: hidden for review)
 *   --dry-run               show what would be imported, no writes
 */

import { ObjectId } from 'mongodb';
import { getScriptClient } from '../lib/mongo.mjs';
import { makeBookDoc } from '../lib/book-docs.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);
const LEIDEN_COLLECTION = args.collection || null;
const RESOURCE_TYPE = args['resource-type'] || 'drawing';
const LIMIT = parseInt(args.limit) || 100000;
const PUBLISH = 'publish' in args;
const DRY_RUN = 'dry-run' in args;
const IMG_HOST = 'https://iiif.universiteitleiden.nl/iiif/2';

// Map a Leiden Fedora collection slug → Source Library collection slug.
const SL_COLLECTION_MAP = {
  balinese_narrative_drawings: 'balinese-narrative-drawings',
};
const SL_COLLECTION = args['sl-collection'] || (LEIDEN_COLLECTION ? SL_COLLECTION_MAP[LEIDEN_COLLECTION] : null);

const slugify = t => t.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const normalizeTitle = t => (t || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
const normalizeAuthor = a => (a || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
async function generateSlug(db, title) {
  const base = slugify(title) || 'leiden-drawing';
  let slug = base, i = 1;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) slug = `${base}-${i++}`;
  return slug;
}
const imgBase = id => `${IMG_HOST}/hdl:1887.1%252Fitem:${id}`;
const licenseFor = r => r === 'public-domain' ? 'publicdomain' : (r === 'cc-by' ? 'CC-BY-4.0' : 'unknown');
function yearFrom(text) { const m = (text || '').match(/\b(1[0-9]{3}|20[0-2][0-9])\b/); return m ? parseInt(m[1]) : null; }

const { client, db } = await getScriptClient({ noTimeout: true });
const filter = { source: 'leiden', status: 'discovered' };
if (LEIDEN_COLLECTION) filter.categories = LEIDEN_COLLECTION;
const cands = await db.collection('import_candidates').find(filter).limit(LIMIT).toArray();
console.log(`[import] ${cands.length} candidates (collection=${LEIDEN_COLLECTION || 'all'}) → SL collection: ${SL_COLLECTION || '(none)'}, ${PUBLISH ? 'PUBLISH live+visible' : 'hidden draft'}`);

// Preload existing Leiden books once (source_fingerprint + iiif_manifest) for fast in-memory dedup
// — avoids a per-candidate collection scan on the 46K-doc books collection.
const existingFp = new Map(); // fp/manifest → book id
for (const b of await db.collection('books').find({ 'image_source.provider': 'leiden' }, { projection: { id: 1, source_fingerprint: 1, 'image_source.iiif_manifest': 1 } }).toArray()) {
  if (b.source_fingerprint) existingFp.set(b.source_fingerprint, b.id);
  if (b.image_source?.iiif_manifest) existingFp.set(b.image_source.iiif_manifest, b.id);
}
console.log(`[import] ${existingFp.size} existing Leiden keys loaded for dedup\n`);

let imported = 0, skipped = 0, failed = 0;
for (const c of cands) {
  const id = (c.source_id || '').replace('item:', '');
  if (!id) { failed++; console.log(`  [skip] ${c.manifest_url} — no item id`); continue; }

  const fp = `leiden:item:${id}`;
  const existingId = existingFp.get(fp) || existingFp.get(c.manifest_url);
  if (existingId) {
    skipped++;
    if (!DRY_RUN) await db.collection('import_candidates').updateOne({ _id: c._id }, { $set: { status: 'imported', book_id: existingId, imported_at: new Date() } });
    continue;
  }

  const title = c.title || `Leiden drawing ${id}`;
  const author = c.author && c.author !== 'Unknown' ? c.author : 'Unknown artist';
  const base = imgBase(id);
  const fullUrl = `${base}/full/full/0/default.jpg`;
  const displayUrl = `${base}/full/1200,/0/default.jpg`;
  const thumbUrl = `${base}/full/!400,400/0/default.jpg`;
  const year = yearFrom(c.date_text);

  if (DRY_RUN) {
    if (imported < 12) console.log(`  ${title.slice(0, 55)} | ${author.slice(0, 22)} | ${c.date_text || '?'} | ${RESOURCE_TYPE} | ${c.metadata?.shelfmark || ''}`);
    imported++; continue;
  }

  const slug = await generateSlug(db, title);
  const bookId = new ObjectId();
  const now = new Date();
  const normTitle = normalizeTitle(title), normAuthor = normalizeAuthor(author);
  const doc = makeBookDoc({
    _id: bookId, id: bookId.toHexString(), slug,
    title, display_title: title, author,
    language: c.language && c.language !== 'Unknown' ? c.language : 'Unknown',
    published: c.date_text || 'Unknown', ...(year ? { year } : {}),
    thumbnail: thumbUrl, image_display: displayUrl, image_source_url: fullUrl, commons_full_url: fullUrl,
    pages_count: 1, pages_ocr: 0, pages_translated: 0,
    content_type: 'artwork', resource_type: RESOURCE_TYPE,
    status: PUBLISH ? 'live' : 'draft', hidden: !PUBLISH, visible: PUBLISH,
    // Keep out of the OCR/translation cron: 'leiden' isn't in the orchestrator's
    // ART_PROVIDERS skip-list, so without this artworks get auto-enrolled.
    pipeline_auto: { status: 'complete', note: 'artwork facsimile (no OCR)', updated_at: now },
    categories: ['visual-art'],
    ...(SL_COLLECTION ? { collections: [SL_COLLECTION] } : {}),
    image_source: {
      provider: 'leiden', provider_name: 'Leiden University Libraries',
      source_url: c.source_url || `http://hdl.handle.net/1887.1/item:${id}`,
      iiif_manifest: c.manifest_url,
      license: licenseFor(c.metadata?.rights),
      attribution: 'Leiden University Libraries',
      contributing_library: 'Leiden University Libraries',
      access_date: now,
    },
    dublin_core: {
      dc_identifier: [`leiden:item:${id}`],
      dc_source: c.source_url || `http://hdl.handle.net/1887.1/item:${id}`,
    },
    ...(c.metadata?.shelfmark ? { shelfmark: c.metadata.shelfmark } : {}),
    ...(c.metadata?.subject_geographic ? { subject_geographic: c.metadata.subject_geographic } : {}),
    ...(c.metadata?.reference ? { provenance_reference: c.metadata.reference } : {}),
    source_fingerprint: fp, normalized_title: normTitle, normalized_author: normAuthor,
    created_at: now, updated_at: now,
  });
  try {
    await db.collection('books').insertOne(doc);
    await db.collection('import_candidates').updateOne({ _id: c._id }, { $set: { status: 'imported', book_id: doc.id, imported_at: now } });
    existingFp.set(fp, doc.id);
    imported++;
    if (imported <= 3 || imported % 50 === 0) console.log(`  IMPORTED [${imported}] ${title.slice(0, 50)} → /book/${slug}`);
  } catch (e) { failed++; console.log(`  [fail] item:${id} → ${e.message.slice(0, 80)}`); }
}

console.log(`\n[import] done: ${imported} ${DRY_RUN ? 'would-import' : 'imported'}, ${skipped} already-present, ${failed} failed`);
if (!DRY_RUN && !PUBLISH && imported > 0) console.log(`[import] imported HIDDEN — review, then re-run with --publish (or flip visible) to show in gallery/collection.`);
await client.close();
