#!/usr/bin/env node
/**
 * Give the `collection-royal-court-poetry` gallery collection real imagery.
 *
 * The collection's 165 books are ETCSL Sumerian text-corpus transcriptions
 * (royal hymns, laments, Gudea cylinders) — plain text, no scans, so nothing
 * to extract. This sources ~12 thematically-matched objects from the Met's
 * Ancient West Asian Art department (open access, CC0): Gudea statuary,
 * royal steles, banquet/court cylinder seals, cuneiform royal inscriptions.
 *
 * Images are rehosted to R2 (full + 600px thumb), inserted as `gallery_images`
 * rows (id `met-{objectID}` — same convention as the other museum-sourced
 * collections like mandaeanism), then the collection gets cover + image_ids
 * and is un-hidden.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/met-royal-court-poetry-gallery.mjs --dry-run
 *   node scripts/import/met-royal-court-poetry-gallery.mjs
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_ITEMS = 12;
const MET_API = 'https://collectionapi.metmuseum.org/public/collection/v1';
const DEPT_ANCIENT_WEST_ASIAN = 3;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';
const DELAY_MS = 300;
const COLLECTION_SLUG = 'collection-royal-court-poetry';
const R2_DIR = `gallery/${COLLECTION_SLUG}`;

// Thematic queries, in priority order — Sumerian royal/court material first.
const QUERIES = [
  'Gudea',
  'Ur III',
  'Sumerian',
  'foundation figure',
  'cylinder seal banquet',
  'stele',
  'cuneiform royal',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new MongoClient(process.env.MONGODB_URI);
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function met(path) {
  const res = await fetch(`${MET_API}${path}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Met ${path} → ${res.status}`);
  return res.json();
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const gi = db.collection('gallery_images');
  const gc = db.collection('gallery_collections');

  // ---- gather candidate object IDs (priority-ordered, deduped)
  const seen = new Set();
  const ordered = [];
  for (const q of QUERIES) {
    try {
      const r = await met(`/search?q=${encodeURIComponent(q)}&departmentId=${DEPT_ANCIENT_WEST_ASIAN}&hasImages=true`);
      for (const id of (r.objectIDs || []).slice(0, 25)) {
        if (!seen.has(id)) { seen.add(id); ordered.push({ id, q }); }
      }
    } catch (e) { console.log(`search "${q}" failed: ${e.message}`); }
    await sleep(DELAY_MS);
  }
  console.log(`${ordered.length} candidate objects across ${QUERIES.length} queries`);

  // ---- fetch objects, keep CC0 + imaged, prefer highlights, cap MAX_ITEMS
  const picks = [];
  for (const { id, q } of ordered) {
    if (picks.length >= MAX_ITEMS) break;
    try {
      const o = await met(`/objects/${id}`);
      if (!o.isPublicDomain || !o.primaryImage) continue;
      if (o.department && !/west asian|near east/i.test(o.department)) continue;
      picks.push({
        objectID: o.objectID,
        title: o.title || 'Untitled',
        date: o.objectDate || '',
        medium: o.medium || '',
        url: o.primaryImage,
        highlight: !!o.isHighlight,
        query: q,
        credit: o.creditLine || '',
        objectURL: o.objectURL || '',
      });
    } catch { /* skip */ }
    await sleep(DELAY_MS);
  }
  // Highlights first, then priority order (stable sort keeps query priority).
  picks.sort((a, b) => Number(b.highlight) - Number(a.highlight));

  console.log(`\nCurated ${picks.length} objects:`);
  picks.forEach((p) => console.log(`  ${p.highlight ? '★' : ' '} met-${p.objectID}  ${p.title.slice(0, 60)} (${p.date}) [${p.query}]`));
  if (DRY_RUN) { await client.close(); return; }

  // ---- rehost + insert gallery_images
  const imageIds = [];
  for (const p of picks) {
    const gid = `met-${p.objectID}`;
    const existing = await gi.findOne({ id: gid }, { projection: { _id: 1 } });
    if (existing) { imageIds.push(gid); console.log(`= ${gid} already in gallery_images`); continue; }
    try {
      const res = await fetch(p.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (!res.ok) { console.log(`✗ ${gid} image fetch ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) { console.log(`✗ ${gid} empty buffer`); continue; }
      const full = await sharp(buf).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      const thumb = await sharp(buf).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      const fullKey = `${R2_DIR}/${gid}.jpg`;
      const thumbKey = `${R2_DIR}/${gid}-thumb.jpg`;
      for (const [key, body] of [[fullKey, full], [thumbKey, thumb]]) {
        await s3.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: body,
          ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
        }));
      }
      const meta = await sharp(buf).metadata();
      await gi.insertOne({
        id: gid,
        page_id: gid,
        extracted_url: `https://images.sourcelibrary.org/${fullKey}`,
        thumbnail_url: `https://images.sourcelibrary.org/${thumbKey}`,
        image_url: `https://images.sourcelibrary.org/${fullKey}`,
        description: [p.title, p.date, p.medium].filter(Boolean).join('. ') + '. The Metropolitan Museum of Art (CC0).',
        type: 'artifact',
        gallery_quality: p.highlight ? 0.9 : 0.85,
        book_title: 'The Metropolitan Museum of Art',
        source: 'met',
        source_object_url: p.objectURL,
        width: meta.width, height: meta.height,
        created_at: new Date(),
      });
      imageIds.push(gid);
      console.log(`✓ ${gid} rehosted (${meta.width}x${meta.height}) — ${p.title.slice(0, 50)}`);
    } catch (e) { console.log(`✗ ${gid}: ${e.message?.slice(0, 80)}`); }
    await sleep(DELAY_MS);
  }

  if (!imageIds.length) { console.log('No images imported — leaving collection hidden.'); await client.close(); return; }

  await gc.updateOne(
    { slug: COLLECTION_SLUG },
    { $set: { image_ids: imageIds, cover_image_id: imageIds[0], updated_at: new Date() }, $unset: { hidden: '' } }
  );
  console.log(`\n✓ ${COLLECTION_SLUG}: ${imageIds.length} images, cover=${imageIds[0]} — UNHIDDEN`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
