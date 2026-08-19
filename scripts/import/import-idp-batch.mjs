#!/usr/bin/env node
/**
 * Batch import IDP Dunhuang items directly into Source Library.
 * Fetches IIIF manifests, downloads full-resolution images, uploads to R2.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import/import-idp-batch.mjs
 *
 * Options:
 *   --subject <name>   Filter: Buddhism, Manicheanism, or 'all' (default: all)
 *   --limit N          Max items to import
 *   --delay N          Delay between items in ms (default: 2000)
 *   --dry-run          Show what would be imported
 *   --skip-existing    Skip items already imported
 */

import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('R2 credentials not set'); process.exit(1);
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function uploadToR2(key, body, contentType = 'image/jpeg') {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: body, ContentType: contentType,
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipExisting = args.includes('--skip-existing');

function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
}

const subjectFilter = getArg('--subject', 'all');
const maxItems = getArg('--limit', null) ? parseInt(getArg('--limit'), 10) : Infinity;
const delayMs = parseInt(getArg('--delay', '2000'), 10);

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60000),
        headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' },
      });
      if (res.ok) return res;
      if (res.status === 429) { await new Promise(r => setTimeout(r, 10000)); continue; }
      if (i === retries - 1) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// Extract image URLs from IIIF v3 manifest canvases
function extractCanvasImages(manifest) {
  const canvases = manifest.items || [];
  return canvases.map((canvas, idx) => {
    // v3: items[].items[].body.id (or body.service[].id for IIIF Image API)
    const annotation = canvas.items?.[0]?.items?.[0];
    const body = annotation?.body;
    if (!body) return null;

    // Get image service URL for full resolution
    const service = body.service?.[0];
    const serviceUrl = service?.id || service?.['@id'];
    // Full image via IIIF Image API
    const imageUrl = serviceUrl
      ? `${serviceUrl}/full/max/0/default.jpg`
      : body.id; // Direct image URL fallback

    return {
      index: idx,
      imageUrl,
      label: extractLabel(canvas.label) || `${idx + 1}`,
      width: canvas.width,
      height: canvas.height,
    };
  }).filter(Boolean);
}

function extractLabel(label) {
  if (!label) return null;
  if (typeof label === 'string') return label;
  if (typeof label === 'object' && !Array.isArray(label)) {
    const vals = label['en'] || label['none'] || label['@none'] || Object.values(label)[0];
    if (Array.isArray(vals)) return vals[0];
  }
  return null;
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

// ── Main ──────────────────────────────────────────────────────────────

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const query = { source: 'idp_dunhuang', manifest_url: { $ne: null }, status: 'discovered' };
if (subjectFilter !== 'all') query.subjects = subjectFilter;

const candidates = await db.collection('import_candidates').find(query)
  .sort({ page_count: -1 })
  .limit(maxItems)
  .toArray();

console.log(`IDP Batch Import — Subject: ${subjectFilter}`);
console.log(`Found ${candidates.length} candidates`);
console.log(`Settings: delay=${delayMs}ms, dry-run=${dryRun}, skip-existing=${skipExisting}\n`);

let imported = 0, skipped = 0, errors = 0;

for (let i = 0; i < candidates.length; i++) {
  const c = candidates[i];
  const meta = c.idp_metadata || {};
  const pressmark = meta.pressmark || c.title || c.source_id;

  // Check existing
  if (skipExisting) {
    const existing = await db.collection('books').findOne({
      'image_source.identifier': c.source_id,
    });
    if (existing) { skipped++; continue; }
  }

  // Build metadata
  const language = c.language || 'Unknown';
  const subjects = c.subjects || [];
  const categories = ['Dunhuang'];
  if (subjects.includes('Buddhism')) categories.push('Buddhism');
  if (subjects.includes('Manicheanism')) categories.push('Manichaeism');
  if (subjects.includes('Zoroastrian')) categories.push('Zoroastrianism');
  if (subjects.includes('Daoism')) categories.push('Daoism');

  if (dryRun) {
    imported++;
    if (imported <= 10 || imported % 50 === 0) {
      console.log(`  [${i + 1}] ${pressmark} — ${c.page_count} canvases, ${language}`);
    }
    continue;
  }

  try {
    // 1. Fetch manifest
    const manifestRes = await fetchWithRetry(c.manifest_url);
    const manifest = await manifestRes.json();
    const images = extractCanvasImages(manifest);

    if (images.length === 0) {
      console.log(`  [${i + 1}] SKIP: ${pressmark} — no images in manifest`);
      errors++;
      continue;
    }

    // 2. Create book record
    const bookId = new ObjectId();
    const slug = slugify(`${pressmark}-idp-dunhuang`);

    const book = makeBookDoc({
      _id: bookId,
      id: bookId.toHexString(),
      title: pressmark,
      slug,
      author: null,
      language,
      published: meta.date_raw || null,
      description: [
        meta.item_type,
        meta.item_subtype ? `(${meta.item_subtype})` : null,
        meta.material ? `on ${meta.material}` : null,
        meta.find_site ? `from ${meta.find_site}` : null,
        meta.date_raw ? `— ${meta.date_raw}` : null,
      ].filter(Boolean).join(' ') || null,
      categories,
      status: 'draft',
      pages_count: images.length,
      pages_ocr: 0,
      pages_translated: 0,
      image_source: {
        provider: 'idp_dunhuang',
        identifier: c.source_id,
        source_url: c.viewer_url,
        manifest_url: c.manifest_url,
        access_date: new Date(),
      },
      catalog_metadata: {
        pressmark,
        script: meta.script || null,
        material: meta.material || null,
        item_type: meta.item_type || null,
        item_subtype: meta.item_subtype || null,
        find_site: meta.find_site || null,
        institution: meta.institution || null,
        dimensions: meta.dimensions || null,
        date_raw: meta.date_raw || null,
        subjects,
      },
      dublin_core: {
        dc_identifier: `IDP:${c.source_id}`,
        dc_rights: c.rights || 'See IDP for terms',
      },
      normalized_title: pressmark.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim(),
      normalized_author: '',
      hidden: true,
      pipeline_status: 'archive_complete',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // 3. Download images and upload to R2
    const pages = [];
    let thumbnailUrl = null;

    for (const img of images) {
      const pageNum = String(img.index).padStart(4, '0');
      const r2Key = `books/${bookId.toHexString()}/pages/${pageNum}.jpg`;

      try {
        const imgRes = await fetchWithRetry(img.imageUrl);
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const photoUrl = await uploadToR2(r2Key, imgBuffer);

        if (img.index === 0) thumbnailUrl = photoUrl;

        pages.push(makePageDoc({
          _id: new ObjectId(),
          id: new ObjectId().toHexString(),
          book_id: bookId.toHexString(),
          page_number: img.index + 1,
          photo: photoUrl,
          archived_photo: photoUrl,
          archive_metadata: {
            source_url: img.imageUrl,
            r2_key: r2Key,
            bytes: imgBuffer.length,
            width: img.width,
            height: img.height,
            canvas_label: img.label,
          },
          created_at: new Date(),
          updated_at: new Date(),
        }));
      } catch (imgErr) {
        console.log(`    Image ${img.index} failed: ${imgErr.message}`);
      }
    }

    if (pages.length === 0) {
      console.log(`  [${i + 1}] SKIP: ${pressmark} — all image downloads failed`);
      errors++;
      continue;
    }

    // Set thumbnail
    book.thumbnail = thumbnailUrl;
    book.pages_count = pages.length;

    // 4. Insert into MongoDB
    await db.collection('books').insertOne(book);
    if (pages.length > 0) {
      await db.collection('pages').insertMany(pages);
    }

    // 5. Update import_candidates
    await db.collection('import_candidates').updateOne(
      { _id: c._id },
      { $set: { status: 'imported', imported_at: new Date(), book_id: bookId.toHexString() } }
    );

    imported++;
    const totalBytes = pages.reduce((s, p) => s + (p.archive_metadata.bytes || 0), 0);
    if (imported <= 10 || imported % 50 === 0) {
      console.log(`  [${i + 1}/${candidates.length}] OK: ${pressmark} — ${pages.length} images → ${bookId.toHexString()} (${(totalBytes / 1048576).toFixed(1)} MB)`);
    }

  } catch (err) {
    errors++;
    console.log(`  [${i + 1}] ERR: ${pressmark} — ${err.message}`);
    await db.collection('import_candidates').updateOne(
      { _id: c._id },
      { $set: { status: 'import_failed', error: err.message?.substring(0, 200) } }
    );
  }

  await new Promise(r => setTimeout(r, delayMs));
}

console.log('\n════════════════════════════════════════');
console.log('IDP BATCH IMPORT — SUMMARY');
console.log('════════════════════════════════════════');
console.log(`Imported: ${imported}`);
console.log(`Skipped: ${skipped}`);
console.log(`Errors: ${errors}`);
console.log(`Dry run: ${dryRun}`);

await client.close();
