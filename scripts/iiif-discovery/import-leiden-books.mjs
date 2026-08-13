#!/usr/bin/env node
/**
 * Import Leiden IIIF candidates as multi-page BOOKS (manuscripts) into Mongo.
 *
 * Counterpart to import-leiden-artworks.mjs (1-canvas). Manuscripts are codices,
 * so each becomes one `books` doc + N `pages` docs (Harvard-direct pattern).
 *
 * Why a browser is needed HERE (unlike the artwork importer): per-page image
 * URLs are NOT deterministic from the item id — each canvas has its own IIIF id —
 * so we must read the manifest. The manifest host is F5-protected, so we navigate
 * with Playwright (challenge-aware backoff). The IMAGE host is open, so the
 * page `photo` URLs render fine for readers.
 *
 * Facsimile-only on purpose: these are handwritten Javanese/Malay/Arabic/Sundanese
 * manuscripts and our Javanese OCR is not yet trustworthy, so we set
 * pipeline_auto.status:'complete' to keep them OUT of the OCR/translation cron
 * (provider 'leiden' is NOT in the orchestrator's ART_PROVIDERS skip-list, so
 * without this they'd be auto-enrolled). Matches the Javanese Kraton stance:
 * facsimile now, trustworthy full-text later.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/iiif-discovery/import-leiden-books.mjs --collection=ubl_manuscripts --dry-run
 *   node scripts/iiif-discovery/import-leiden-books.mjs --collection=ubl_manuscripts --limit=3
 *   node scripts/iiif-discovery/import-leiden-books.mjs --collection=ubl_manuscripts            # all, hidden
 *   node scripts/iiif-discovery/import-leiden-books.mjs --collection=ubl_manuscripts --publish
 *
 * Options:
 *   --collection=<slug>     Leiden Fedora slug filter on candidates (default ubl_manuscripts)
 *   --sl-collection=<slug>  Source Library collection slug (default indonesian-manuscripts)
 *   --resource-type=<t>     default: manuscript
 *   --limit=N               max books this run
 *   --publish               import live+visible (default: hidden for review)
 *   --dry-run               show what would be imported, no writes
 */

import { ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { getScriptClient } from '../lib/mongo.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);
const LEIDEN_COLLECTION = args.collection || 'ubl_manuscripts';
const SL_COLLECTION = args['sl-collection'] || 'indonesian-manuscripts';
const RESOURCE_TYPE = args['resource-type'] || 'manuscript';
const LIMIT = parseInt(args.limit) || 100000;
const PUBLISH = 'publish' in args;
const DRY_RUN = 'dry-run' in args;
const HOST = 'https://digitalcollections.universiteitleiden.nl';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CHALLENGE_RE = /bobcmn|support id is|failureConfig/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const slugify = (t, max = 70) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max).replace(/-$/, '');
const normalizeTitle = t => (t || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
const normalizeAuthor = a => (a || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
const licenseFor = r => r === 'public-domain' ? 'publicdomain' : (r === 'cc-by' ? 'CC-BY-4.0' : 'unknown');
const yearFrom = text => { const m = (text || '').match(/\b(1[0-9]{3}|20[0-2][0-9])\b/); return m ? parseInt(m[1]) : null; };

const { client, db } = await getScriptClient({ noTimeout: true });
async function uniqueSlug(base) { let slug = base || 'leiden-manuscript', i = 2; while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) slug = `${base}-${i++}`; return slug; }

/** Navigate to the manifest, backing off on F5 challenge; return parsed JSON or null. */
async function fetchManifest(page, id) {
  const url = `${HOST}/iiif_manifest/item:${id}/manifest`;
  for (let t = 0; t < 6; t++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); }
    catch { await sleep(3000 * (t + 1)); continue; }
    await sleep(500);
    const txt = await page.evaluate(() => document.body?.innerText || '');
    if (txt.trim().startsWith('{') && !CHALLENGE_RE.test(txt)) { try { return JSON.parse(txt); } catch { return null; } }
    await sleep(4000 * (t + 1));
  }
  return null;
}

/** IIIF v2 canvases → ordered [{ photo, thumbnail }]. */
function pagesFromManifest(m) {
  const canvases = m.sequences?.[0]?.canvases || [];
  return canvases.map(c => {
    const res = c.images?.[0]?.resource;
    const svc = res?.service?.['@id'];
    const photo = (svc ? `${svc}/full/full/0/default.jpg` : res?.['@id']) || null;
    const thumbnail = svc ? `${svc}/full/!400,400/0/default.jpg` : photo;
    return photo ? { photo, thumbnail } : null;
  }).filter(Boolean);
}

const cands = await db.collection('import_candidates').find({ source: 'leiden', status: 'discovered', categories: LEIDEN_COLLECTION }).limit(LIMIT).toArray();
console.log(`[import-books] ${cands.length} candidates (${LEIDEN_COLLECTION}) → ${SL_COLLECTION}, ${PUBLISH ? 'PUBLISH live+visible' : 'hidden draft'}\n`);

// In-memory dedup against existing leiden books
const existingFp = new Map();
for (const b of await db.collection('books').find({ 'image_source.provider': 'leiden' }, { projection: { id: 1, source_fingerprint: 1, 'image_source.iiif_manifest': 1 } }).toArray()) {
  if (b.source_fingerprint) existingFp.set(b.source_fingerprint, b.id);
  if (b.image_source?.iiif_manifest) existingFp.set(b.image_source.iiif_manifest, b.id);
}

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ userAgent: UA })).newPage();

let imported = 0, skipped = 0, failed = 0, totalPages = 0, idx = 0;
for (const c of cands) {
  idx++;
  const id = (c.source_id || '').replace('item:', '');
  const fp = `leiden:item:${id}`;
  if (existingFp.has(fp) || existingFp.has(c.manifest_url)) { skipped++; if (!DRY_RUN) await db.collection('import_candidates').updateOne({ _id: c._id }, { $set: { status: 'imported', book_id: existingFp.get(fp) || existingFp.get(c.manifest_url), imported_at: new Date() } }); continue; }

  const manifest = await fetchManifest(page, id);
  if (!manifest) { failed++; console.log(`  [fail ${idx}/${cands.length}] item:${id} — manifest unavailable/challenged`); await sleep(1200); continue; }
  const pages = pagesFromManifest(manifest);
  if (!pages.length) { failed++; console.log(`  [fail ${idx}/${cands.length}] item:${id} — no page images`); continue; }

  const title = c.title || `Leiden manuscript ${id}`;
  const author = c.author && c.author !== 'Unknown' ? c.author : 'Unknown';
  const year = yearFrom(c.date_text);

  if (DRY_RUN) {
    if (imported < 15) console.log(`  ${title.slice(0, 50)} | ${author.slice(0, 20)} | ${c.date_text || '?'} | ${pages.length}pp | ${c.metadata?.shelfmark || ''}`);
    imported++; totalPages += pages.length; await sleep(700); continue;
  }

  const slug = await uniqueSlug(slugify(title));
  const bookId = new ObjectId();
  const now = new Date();
  const bookDoc = {
    _id: bookId, id: bookId.toHexString(), slug,
    title, display_title: title, author,
    language: c.language && c.language !== 'Unknown' ? c.language : 'Unknown',
    published: c.date_text || 'Unknown', ...(year ? { year } : {}),
    thumbnail: pages[0].thumbnail || '',
    pages_count: pages.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
    content_type: 'book', resource_type: RESOURCE_TYPE,
    status: PUBLISH ? 'live' : 'draft', hidden: !PUBLISH, visible: PUBLISH,
    categories: [], collections: [SL_COLLECTION],
    // facsimile-only: keep out of the OCR/translation cron (Javanese OCR untrusted)
    pipeline_auto: { status: 'complete', note: 'facsimile-only (handwritten; trustworthy OCR pending)', updated_at: now },
    image_source: {
      provider: 'leiden', provider_name: 'Leiden University Libraries',
      source_url: c.source_url || `http://hdl.handle.net/1887.1/item:${id}`,
      iiif_manifest: c.manifest_url,
      license: licenseFor(c.metadata?.rights),
      attribution: 'Leiden University Libraries', contributing_library: 'Leiden University Libraries',
      access_date: now,
    },
    dublin_core: { dc_identifier: [`leiden:item:${id}`], dc_source: c.source_url || `http://hdl.handle.net/1887.1/item:${id}` },
    ...(c.metadata?.shelfmark ? { shelfmark: c.metadata.shelfmark } : {}),
    ...(c.metadata?.subject_geographic ? { subject_geographic: c.metadata.subject_geographic } : {}),
    source_fingerprint: fp, normalized_title: normalizeTitle(title), normalized_author: normalizeAuthor(author),
    created_at: now, updated_at: now,
  };
  try {
    await db.collection('books').insertOne(bookDoc);
    const CHUNK = 500;
    for (let s = 0; s < pages.length; s += CHUNK) {
      const docs = pages.slice(s, s + CHUNK).map((p, k) => { const pid = new ObjectId(); return { _id: pid, id: pid.toHexString(), book_id: bookDoc.id, page_number: s + k + 1, photo: p.photo, photo_original: p.photo, thumbnail: p.thumbnail, created_at: now, updated_at: now }; });
      await db.collection('pages').insertMany(docs, { ordered: false });
    }
    await db.collection('import_candidates').updateOne({ _id: c._id }, { $set: { status: 'imported', book_id: bookDoc.id, imported_at: now } });
    existingFp.set(fp, bookDoc.id);
    imported++; totalPages += pages.length;
    if (imported <= 3 || imported % 25 === 0) console.log(`  IMPORTED [${imported}] ${title.slice(0, 45)} (${pages.length}pp) → /book/${slug}`);
  } catch (e) { failed++; console.log(`  [fail] item:${id} → ${e.message.slice(0, 90)}`); }
  await sleep(900);
}

console.log(`\n[import-books] done: ${imported} ${DRY_RUN ? 'would-import' : 'imported'} (${totalPages} pages), ${skipped} already-present, ${failed} failed`);
if (!DRY_RUN && !PUBLISH && imported > 0) console.log(`[import-books] imported HIDDEN — review, then --publish (or flip visible) + sync-books-catalog.`);
await browser.close();
await client.close();
