#!/usr/bin/env node
/**
 * Import the University of Minnesota (Wangensteen Historical Library) Hashika-e
 * measles-prints collection as Source Library ARTWORK.
 *
 * Hashika-e (麻疹絵) are Edo-period Japanese woodblock public-health broadsides,
 * almost all printed in 1862 during Japan's great measles epidemic — they told
 * people what to eat, what to avoid, and which deities to petition. 49 items on
 * OCLC ContentDM (cdm16022, collection p16022coll127), full IIIF, public domain
 * by age. Each becomes a content_type:'artwork' / resource_type:'print' book:
 * single image, pages_count:0, no OCR, images rehosted to R2.
 *
 * Modeled on scripts/import/import-rijksmuseum-artworks.mjs.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/import-hashika-e-posters.mjs --dry        # parse only
 *   node scripts/import/import-hashika-e-posters.mjs              # import hidden
 *   node scripts/import/import-hashika-e-posters.mjs --publish    # import visible
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { makeBookDoc } from '../lib/book-docs.mjs';

const HOST = 'https://cdm16022.contentdm.oclc.org';
const ALIAS = 'p16022coll127';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const COLLECTION_SLUG = 'hashika-e-measles-prints';
const DRY = process.argv.includes('--dry');
const PUBLISH = process.argv.includes('--publish');

const mongo = new MongoClient(process.env.MONGODB_URI);
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function uploadR2(key, buf, ct = 'image/jpeg') {
  if (DRY) return `${R2_PUBLIC_URL}/${key}`;
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: ct, CacheControl: 'public, max-age=86400, s-maxage=86400' }));
  return `${R2_PUBLIC_URL}/${key}`;
}
async function getJson(url) { const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
async function getBuffer(url) {
  // Retry — ContentDM generates derivations from JP2 on the fly and occasionally stalls.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
      if (!r.ok) throw new Error(`img ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
function md(meta, label) { const f = (meta || []).find(x => x.label === label); return f ? String(f.value) : null; }
function slugify(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 70); }
function normTitle(t) { return (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(); }

async function listPointers() {
  const url = `${HOST}/digital/bl/dmwebservices/index.php?q=dmQuery/${ALIAS}/0/title/title/2000/0/0/0/0/0/json`;
  const d = await getJson(url);
  return (d.records || []).map(r => r.pointer);
}

async function ensureCollection(db) {
  const col = db.collection('collections');
  const existing = await col.findOne({ slug: COLLECTION_SLUG });
  if (existing) { console.log(`collection "${COLLECTION_SLUG}" already exists`); return; }
  if (DRY) { console.log(`[DRY] would create collection "${COLLECTION_SLUG}"`); return; }
  await col.insertOne({
    slug: COLLECTION_SLUG,
    name: 'Hashika-e: Japanese Measles Prints',
    collection_type: 'visual_art',
    subtitle: 'Woodblock public-health broadsides from the 1862 measles epidemic',
    description: 'Hashika-e (麻疹絵, "measles pictures") are Japanese woodblock prints produced during the great measles epidemic of 1862. Sold cheaply on the street, they functioned as public-health broadsides: ranking foods to eat and avoid in sumo-tournament format, depicting protective deities, and dramatizing the disease as a defeatable enemy. Held by the Owen H. Wangensteen Historical Library of Biology and Medicine at the University of Minnesota.',
    color: '#8a3a3a',
    order: 999,
    visible: PUBLISH,
    languages: ['Japanese'],
    created_at: new Date(),
    updated_at: new Date(),
  });
  console.log(`✓ created collection "${COLLECTION_SLUG}" (visible=${PUBLISH})`);
}

async function main() {
  await mongo.connect();
  const db = mongo.db('bookstore');
  const books = db.collection('books');
  console.log(`Hashika-e import${DRY ? ' (DRY)' : ''} | publish=${PUBLISH}`);
  await ensureCollection(db);

  const pointers = await listPointers();
  console.log(`${pointers.length} items in ${ALIAS}`);
  let imported = 0, skipped = 0, failed = 0;

  for (const ptr of pointers) {
    const manifestUrl = `${HOST}/iiif/2/${ALIAS}:${ptr}/manifest.json`;
    const fingerprint = `iiif:${manifestUrl}`;
    try {
      if (await books.findOne({ source_fingerprint: fingerprint })) { skipped++; continue; }
      const m = await getJson(manifestUrl);
      const title = (Array.isArray(m.label) ? m.label[0] : m.label) || `Hashika-e ${ptr}`;
      const meta = m.metadata || [];
      const date = md(meta, 'Date of Creation') || '1862';
      const yearMatch = (date.match(/\d{4}/) || [])[0];
      const description = md(meta, 'Description');
      const subjectsRaw = md(meta, 'Locally Assigned Subject Headings') || '';
      const subjects = subjectsRaw.split(';').map(s => s.trim().replace(/\.$/, '')).filter(Boolean);
      const dims = md(meta, 'Dimensions');
      const physFormat = md(meta, 'Item Physical Format');
      const sourceUrl = `${HOST}/digital/collection/${ALIAS}/id/${ptr}`;
      // Cap width — full/full forces a slow on-the-fly JP2→JPEG of the ~4500px original.
      // 2000px is ample for web display of a print and downloads far faster/smaller.
      const imageUrl = `${HOST}/iiif/2/${ALIAS}:${ptr}/full/2000,/0/default.jpg`;

      if (DRY) { console.log(`  [DRY] ${ptr}  "${title}"  (${date})  subj=${subjects.length}`); imported++; continue; }

      const buf = await getBuffer(imageUrl);
      const meta0 = await sharp(buf, { limitInputPixels: false }).metadata();
      const bookId = new ObjectId();
      const base = `artworks/${bookId.toHexString()}`;
      const [dBuf, tBuf] = await Promise.all([
        sharp(buf, { limitInputPixels: false }).resize(1200).jpeg({ quality: 82 }).toBuffer(),
        sharp(buf, { limitInputPixels: false }).resize(150).jpeg({ quality: 60 }).toBuffer(),
      ]);
      const [fullUrl, dispUrl, thumbUrl] = await Promise.all([
        uploadR2(`${base}-full.jpg`, buf), uploadR2(`${base}.jpg`, dBuf), uploadR2(`${base}-thumb.jpg`, tBuf),
      ]);
      let b = slugify(title) || `hashika-e-${ptr}`; let slug = `art-${b}`; let n = 1;
      while (await books.findOne({ slug })) { slug = `art-${b}-${++n}`; }

      await books.insertOne(makeBookDoc({
        _id: bookId, id: bookId.toHexString(), slug,
        title, display_title: title, author: 'Anonymous',
        language: 'Japanese', original_language: 'Japanese',
        published: date, year: yearMatch ? parseInt(yearMatch, 10) : 1862,
        resource_type: 'print', content_type: 'artwork',
        medium: physFormat || 'Woodcuts (prints)', dimensions_display: dims || null,
        current_location: 'Owen H. Wangensteen Historical Library of Biology and Medicine, University of Minnesota',
        description: description || null,
        image_full: fullUrl, image_display: dispUrl, image_thumb: thumbUrl,
        // Read path (ArtworkInfo) uses: thumbnail=display, thumbnail_blob=tiny thumb,
        // archived_full_url=full-res (drives the magnifier + display→full auto-enhance).
        thumbnail: dispUrl, thumbnail_blob: thumbUrl, archived_full_url: fullUrl,
        full_width: meta0.width || null, full_height: meta0.height || null,
        pages_count: 0, pages_ocr: 0, pages_translated: 0,
        pipeline_auto: { status: 'complete', source: 'import', reason: 'artwork_image_only' },
        status: PUBLISH ? 'published' : 'imported', hidden: !PUBLISH, visible: PUBLISH,
        categories: ['Visual Art — Object', 'History of Medicine'],
        faceted_tags: subjects,
        collections: [COLLECTION_SLUG, 'visual-art'],
        provider: 'University of Minnesota Libraries (Wangensteen Historical Library)',
        contributing_library: 'Owen H. Wangensteen Historical Library of Biology and Medicine, University of Minnesota',
        held_by: ['umedia'],
        normalized_title: normTitle(title), normalized_author: 'anonymous',
        image_source: {
          provider: 'umedia', provider_name: 'University of Minnesota (UMedia / Wangensteen Historical Library)',
          source_url: sourceUrl, iiif_manifest: manifestUrl, identifier: `${ALIAS}:${ptr}`,
          license: 'Public Domain', attribution: 'University of Minnesota Libraries, Owen H. Wangensteen Historical Library of Biology and Medicine',
          access_date: new Date(),
        },
        source_fingerprint: fingerprint,
        created_at: new Date(), updated_at: new Date(),
      }));
      imported++;
      console.log(`  ✓ ${slug} — "${title}" (${date}) ${meta0.width}x${meta0.height}`);
    } catch (e) { failed++; console.log(`  ✗ ${ptr}: ${e.message}`); }
  }
  await mongo.close();
  console.log(`\n=== Summary === imported=${imported} skipped=${skipped} failed=${failed}`);
}
main().catch(async e => { console.error('FATAL', e.stack || e.message); try { await mongo.close(); } catch {} process.exit(1); });
