#!/usr/bin/env node
/**
 * Import artworks from Rijksmuseum via Linked Art Search + IIIF.
 * No API key required. All public domain items are CC0.
 *
 * Resolution chain: Search → Object → VisualItem → DigitalObject → IIIF access_point
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-rijks-artworks.mjs
 *
 *   Options:
 *     --dry-run         Show what would be imported
 *     --limit N         Max items to import
 *     --skip-images     Metadata only (no R2 upload)
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const SEARCH_BASE = 'https://data.rijksmuseum.nl/search/collection';
const RESOLVER = 'https://id.rijksmuseum.nl';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const R2_PREFIX = 'artwork';
const DISPLAY_MAX = 3840;
const THUMB_WIDTH = 600;
const DELAY_MS = 300;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Import targets ──────────────────────────────────────────────────────────

const IMPORT_TARGETS = [
  { creator: 'Dürer', type: 'prent', artistName: 'Albrecht Dürer', resourceType: 'print' },
  { creator: 'Rembrandt', type: 'prent', artistName: 'Rembrandt van Rijn', resourceType: 'print' },
  { creator: 'Lucas van Leyden', type: 'prent', artistName: 'Lucas van Leyden', resourceType: 'print' },
  { creator: 'Goltzius', type: 'prent', artistName: 'Hendrick Goltzius', resourceType: 'print' },
  { creator: 'Mantegna', type: 'prent', artistName: 'Andrea Mantegna', resourceType: 'print' },
  { creator: 'Schongauer', type: 'prent', artistName: 'Martin Schongauer', resourceType: 'print' },
  { creator: 'Cranach', type: 'prent', artistName: 'Lucas Cranach', resourceType: 'print' },
  { creator: 'Bruegel', type: 'prent', artistName: 'Pieter Bruegel', resourceType: 'print' },
];

// ─── Linked Data helpers ────────────────────────────────────────────────────

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/ld+json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return res.json();
      if (res.status === 429 || res.status === 503) {
        await sleep((attempt + 1) * 5000);
        continue;
      }
      return null;
    } catch {
      await sleep(2000);
    }
  }
  return null;
}

async function searchCollection(creator, type) {
  const params = new URLSearchParams({ creator, imageAvailable: 'true' });
  if (type) params.set('type', type);
  const url = `${SEARCH_BASE}?${params}`;

  const allItems = [];
  let pageUrl = url;

  while (pageUrl) {
    const data = await fetchJson(pageUrl);
    if (!data) break;

    const items = data.orderedItems || data.items || [];
    allItems.push(...items);

    // Check for next page
    pageUrl = data.next?.id || null;
    if (pageUrl) await sleep(DELAY_MS);
  }

  return allItems;
}

async function resolveObject(objectUrl) {
  const obj = await fetchJson(objectUrl);
  if (!obj) return null;

  // Extract title
  const names = Array.isArray(obj.identified_by) ? obj.identified_by : [];
  const titleNode = names.find(n => n.type === 'Name');
  const title = titleNode?.content || '';

  // Extract object number
  const idNode = names.find(n => n.type === 'Identifier' && n.content);
  const objectNumber = idNode?.content || objectUrl.split('/').pop();

  // Extract date
  const timespan = obj.produced_by?.timespan;
  const dateNames = Array.isArray(timespan?.identified_by) ? timespan.identified_by : [];
  const dateNode = dateNames.find(n => n.language?.[0]?.id?.includes('300388277')); // English
  const date = dateNode?.content || dateNames[0]?.content || '';

  // Extract dimensions from referred_to_by
  const refs = Array.isArray(obj.referred_to_by) ? obj.referred_to_by : [];
  const dimRef = refs.find(r => {
    const cls = Array.isArray(r.classified_as) ? r.classified_as : [];
    return cls.some(c => c.id?.includes('300435430')); // dimension statement
  });
  const dimensions = dimRef?.content || '';

  // Extract description
  const descRef = refs.find(r => {
    const cls = Array.isArray(r.classified_as) ? r.classified_as : [];
    return cls.some(c => c.id?.includes('300435452') || c.id?.includes('300404670'));
  });
  const description = descRef?.content || '';

  // Get visual item URL from shows
  const shows = Array.isArray(obj.shows) ? obj.shows : [obj.shows].filter(Boolean);
  const visualItemUrl = shows[0]?.id;

  // Get Rijksmuseum web URL
  const subjectOf = Array.isArray(obj.subject_of) ? obj.subject_of : [];
  const webPage = subjectOf.find(s => {
    const digi = s.digitally_carried_by;
    return digi && Array.isArray(digi) ? digi.some(d => d.access_point) : digi?.access_point;
  });
  let webUrl = '';
  if (webPage?.digitally_carried_by) {
    const carried = Array.isArray(webPage.digitally_carried_by) ? webPage.digitally_carried_by : [webPage.digitally_carried_by];
    const ap = carried[0]?.access_point;
    webUrl = Array.isArray(ap) ? ap[0]?.id : ap?.id || '';
  }

  return {
    id: objectUrl,
    objectNumber,
    title,
    date,
    dimensions,
    description,
    visualItemUrl,
    webUrl: webUrl || objectUrl,
  };
}

async function resolveIiifUrl(visualItemUrl) {
  if (!visualItemUrl) return null;

  const vi = await fetchJson(visualItemUrl);
  if (!vi) return null;

  // Get DigitalObject URL from digitally_shown_by
  const digi = Array.isArray(vi.digitally_shown_by) ? vi.digitally_shown_by : [vi.digitally_shown_by].filter(Boolean);
  const digitalUrl = digi[0]?.id;
  if (!digitalUrl) return null;

  await sleep(100);

  const dig = await fetchJson(digitalUrl);
  if (!dig) return null;

  // Get IIIF access point
  const ap = Array.isArray(dig.access_point) ? dig.access_point : [dig.access_point].filter(Boolean);
  const iiifUrl = ap[0]?.id;
  if (!iiifUrl) return null;

  // Get dimensions from IIIF info.json
  const iiifBase = iiifUrl.replace('/full/max/0/default.jpg', '');
  let width = 0, height = 0;
  try {
    const info = await fetchJson(`${iiifBase}/info.json`);
    if (info) { width = info.width || 0; height = info.height || 0; }
  } catch {}

  return { iiifUrl, width, height };
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function generateId() {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

async function uploadToR2(s3, imageUrl, key) {
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());

  const displayBuffer = await sharp(buffer)
    .resize({ width: DISPLAY_MAX, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: displayBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  const thumbBuffer = await sharp(buffer)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  const thumbKey = key.replace(/\.jpg$/, '-thumb.jpg');
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: thumbKey,
    Body: thumbBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  const meta = await sharp(displayBuffer).metadata();
  return {
    display: `https://images.sourcelibrary.org/${key}`,
    thumb: `https://images.sourcelibrary.org/${thumbKey}`,
    width: meta.width,
    height: meta.height,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipImages = args.includes('--skip-images');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Images: ${skipImages ? 'SKIP' : 'UPLOAD'} | Limit: ${limit === Infinity ? 'none' : limit}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  let s3 = null;
  if (!skipImages && !dryRun) {
    s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  let totalImported = 0, totalSkipped = 0, totalErrors = 0;

  for (const target of IMPORT_TARGETS) {
    if (totalImported >= limit) break;

    console.log(`\n━━━ ${target.artistName} (${target.type}) ━━━`);

    const items = await searchCollection(target.creator, target.type);
    console.log(`  Found ${items.length} items`);

    for (const item of items) {
      if (totalImported >= limit) break;

      const objectUrl = item.id;
      if (!objectUrl) continue;

      await sleep(DELAY_MS);

      // Step 1: Resolve object metadata
      const obj = await resolveObject(objectUrl);
      if (!obj || !obj.title) {
        totalSkipped++;
        continue;
      }

      const slug = slugify(`rijks-${target.artistName}-${obj.title}`);
      if (!slug || slug.length < 10) continue;

      // Check dupe
      const exists = await books.findOne(
        { $or: [{ slug }, { 'image_source.identifier': `rijks-${obj.objectNumber}` }] },
        { projection: { _id: 1 } }
      );
      if (exists) {
        totalSkipped++;
        continue;
      }

      // Step 2: Resolve IIIF image URL (object → visual item → digital object)
      await sleep(200);
      const iiif = await resolveIiifUrl(obj.visualItemUrl);
      if (!iiif?.iiifUrl) {
        totalSkipped++;
        continue;
      }

      const year = obj.date?.match(/\d{4}/)?.[0] || '';

      if (dryRun) {
        console.log(`  [DRY] ${slug} — ${obj.title.substring(0, 60)} — ${obj.date} — ${iiif.width}x${iiif.height}`);
        totalImported++;
        continue;
      }

      // Step 3: Download and upload to R2
      let displayUrl = iiif.iiifUrl;
      let thumbUrl = iiif.iiifUrl;
      let width = iiif.width, height = iiif.height;

      if (s3) {
        const r2Key = `${R2_PREFIX}/${slug}.jpg`;
        try {
          const urls = await uploadToR2(s3, iiif.iiifUrl, r2Key);
          if (urls) {
            displayUrl = urls.display;
            thumbUrl = urls.thumb;
            width = urls.width || iiif.width;
            height = urls.height || iiif.height;
          }
        } catch (err) {
          console.error(`  Failed: ${slug}: ${err.message}`);
          totalErrors++;
          continue;
        }
      }

      const doc = {
        id: generateId(),
        slug,
        tenant_id: 'default',
        title: obj.title,
        display_title: obj.title,
        author: target.artistName,
        language: 'Visual',
        published: year,
        resource_type: target.resourceType,
        medium: '',
        dimensions_display: obj.dimensions,
        thumbnail: thumbUrl,
        thumbnail_blob: displayUrl,
        pages_count: 1,
        pages_ocr: 0,
        pages_translated: 0,
        status: 'published',
        visible: true,
        categories: [`Visual Art — ${target.resourceType.charAt(0).toUpperCase() + target.resourceType.slice(1)}`],
        created_at: new Date(),
        updated_at: new Date(),
        commons_width: width,
        commons_height: height,
        commons_title: `Rijksmuseum: ${obj.title}`,
        commons_url: obj.webUrl,
        commons_full_url: iiif.iiifUrl,
        commons_license: 'CC0 1.0',
        commons_description: obj.description,
        commons_categories: [],
        image_source: {
          provider: 'rijksmuseum',
          provider_name: 'Rijksmuseum',
          source_url: obj.webUrl,
          identifier: `rijks-${obj.objectNumber}`,
          license: 'CC0 1.0',
          attribution: 'Rijksmuseum, Amsterdam',
          contributing_library: 'Rijksmuseum, Amsterdam',
          access_date: new Date().toISOString(),
        },
        harvested_at: new Date(),
      };

      await books.insertOne(doc);
      console.log(`  ✓ ${slug} — ${obj.title.substring(0, 50)} (${year}) ${width}x${height}`);
      totalImported++;
    }
  }

  console.log(`\n━━━ DONE ━━━`);
  console.log(`Imported: ${totalImported}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Errors: ${totalErrors}`);

  await client.close();
}

main().catch(console.error);
