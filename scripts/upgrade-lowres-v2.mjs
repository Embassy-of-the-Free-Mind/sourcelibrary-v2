#!/usr/bin/env node
/**
 * Upgrade low-res artworks v2 — smarter strategies:
 *
 * 1. Extract inventory numbers from Commons filenames → direct museum lookup
 * 2. Search Commons structured data for the same depicted item at higher res
 * 3. Search Commons for filename variants (same base name, different resolution)
 * 4. For genuine detail crops, permanently mark as "detail_crop" (not upgradeable)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/upgrade-lowres-v2.mjs
 *   Options:
 *     --dry-run     Show what would be done
 *     --limit N     Process at most N
 *     --artist X    Only process artworks by this artist
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const MIN_DIM = 800;
const DISPLAY_WIDTH = 3840;
const THUMB_WIDTH = 600;
const DELAY_MS = 200;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Strategy 1: Extract inventory numbers from Commons filenames ───────────

function extractInventoryNumber(commonsTitle) {
  const fn = (commonsTitle || '').replace('File:', '');

  // RCE / Rijksdienst pattern: NK1234, SK-A-1234, RP-P-1234
  const rce = fn.match(/(?:NK|SK-[A-Z]|RP-[A-Z]|BK)-[\d-]+/i);
  if (rce) return { type: 'rijksmuseum', id: rce[0] };

  // British Museum: AN\d+
  const bm = fn.match(/AN(\d{6,})/);
  if (bm) return { type: 'british_museum', id: bm[1] };

  // Met accession: \d+\.\d+\.\d+
  const met = fn.match(/(\d{2,4}\.\d+\.\d+)/);
  if (met) return { type: 'met', id: met[1] };

  return null;
}

/** Look up Rijksmuseum by object number */
async function lookupRijksObject(objectNumber) {
  const key = process.env.RIJKS_API_KEY;
  if (!key) return null;
  // Try direct object lookup
  const url = `https://www.rijksmuseum.nl/api/en/collection/${objectNumber}?key=${key}&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    const obj = data.artObject;
    if (!obj?.webImage?.url) return null;
    const w = obj.webImage.width;
    const h = obj.webImage.height;
    if (Math.max(w, h) < MIN_DIM) return null;
    return {
      source: 'rijksmuseum',
      imageUrl: obj.webImage.url.replace(/=s\d+$/, '=s3840'),
      width: w,
      height: h,
      objectUrl: `https://www.rijksmuseum.nl/en/collection/${obj.objectNumber}`,
      objectNumber: obj.objectNumber,
      title: obj.title,
      artist: obj.principalOrFirstMaker,
      dateCreated: obj.dating?.sortingDate?.toString() || '',
      medium: obj.physicalMedium || '',
      dimensions: (obj.dimensions || []).map(d => `${d.type}: ${d.value} ${d.unit}`).join(', '),
      license: 'CC0-1.0',
      description: obj.plaqueDescriptionEnglish || obj.description || '',
      classification: obj.objectTypes?.join(', ') || '',
    };
  } catch { return null; }
}

/** Search Rijksmuseum by inventory number pattern */
async function searchRijksByInventory(invNumber) {
  const key = process.env.RIJKS_API_KEY;
  if (!key) return null;
  const url = `https://www.rijksmuseum.nl/api/en/collection?key=${key}&q=${encodeURIComponent(invNumber)}&ps=3&imgonly=true&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    for (const obj of data.artObjects || []) {
      if (!obj.webImage?.url) continue;
      if (Math.max(obj.webImage.width, obj.webImage.height) < MIN_DIM) continue;
      return {
        source: 'rijksmuseum',
        imageUrl: obj.webImage.url.replace(/=s\d+$/, '=s3840'),
        width: obj.webImage.width,
        height: obj.webImage.height,
        objectUrl: `https://www.rijksmuseum.nl/en/collection/${obj.objectNumber}`,
        objectNumber: obj.objectNumber,
        title: obj.title,
        artist: obj.principalOrFirstMaker,
        license: 'CC0-1.0',
      };
    }
  } catch { /* ignore */ }
  return null;
}

// ─── Strategy 2: Search Commons for better versions ─────────────────────────

/** Search Commons for images depicting the same subject at higher resolution */
async function searchCommonsForBetter(commonsTitle, currentMaxDim) {
  const filename = (commonsTitle || '').replace('File:', '').replace(/\.[^.]+$/, '');

  // Try searching for the base filename (artists often have multiple uploads)
  // Strip common suffixes like dimensions, "detail", "cropped"
  let searchTerm = filename
    .replace(/_/g, ' ')
    .replace(/\(\d+\)/, '')
    .replace(/\b\d{3,4}x\d{3,4}\b/, '')
    .replace(/\bcropped\d*\b/i, '')
    .replace(/\bdetail\b/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  if (searchTerm.length < 5) return null;

  const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchTerm)}&srnamespace=6&srlimit=10&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.query?.search || [];

    // Get image info for results
    const candidates = results
      .map(r => r.title)
      .filter(t => t !== commonsTitle); // Skip self

    if (!candidates.length) return null;

    // Batch query for image dimensions
    for (let i = 0; i < candidates.length; i += 10) {
      const batch = candidates.slice(i, i + 10);
      const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(batch.join('|'))}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=3840&format=json`;
      const infoRes = await fetch(infoUrl, { headers: { 'User-Agent': UA } });
      if (!infoRes.ok) continue;
      const infoData = await infoRes.json();

      for (const page of Object.values(infoData.query?.pages || {})) {
        const info = page.imageinfo?.[0];
        if (!info || !info.mime?.startsWith('image/')) continue;
        const maxDim = Math.max(info.width, info.height);
        if (maxDim >= MIN_DIM && maxDim > currentMaxDim * 1.5) {
          // Check filename similarity to avoid completely unrelated results
          const resultName = page.title.replace('File:', '').replace(/\.[^.]+$/, '').replace(/_/g, ' ').toLowerCase();
          const queryName = searchTerm.toLowerCase();
          const sharedWords = queryName.split(' ').filter(w => w.length > 3 && resultName.includes(w));
          if (sharedWords.length < 2) continue;

          const ext = info.extmetadata || {};
          return {
            source: 'commons',
            filename: page.title.replace('File:', ''),
            url: info.url,
            thumbUrl: info.thumburl,
            width: info.width,
            height: info.height,
            title: cleanHtml(ext.ObjectName?.value) || '',
            artist: cleanHtml(ext.Artist?.value) || '',
            description: cleanHtml(ext.ImageDescription?.value) || '',
            medium: cleanHtml(ext.Medium?.value) || '',
            credit: cleanHtml(ext.Credit?.value) || '',
            license: ext.LicenseShortName?.value || '',
            dateCreated: cleanHtml(ext.DateTimeOriginal?.value) || '',
          };
        }
      }
      await sleep(100);
    }
  } catch { /* ignore */ }
  return null;
}

function cleanHtml(html) {
  if (!html) return '';
  let text = html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
  if (text.includes('QS:')) {
    text = text.replace(/\s*(title|label)\s+QS:[^\s"]*("[^"]*")?/g, '').trim();
    if (text.includes('QS:')) text = text.split(/\s*QS:/)[0].trim();
  }
  return text;
}

// ─── Strategy 3: Detect detail crops → mark permanently ─────────────────────

function isDetailCrop(title, commonsTitle, width, height) {
  const combined = `${title} ${commonsTitle}`.toLowerCase();
  // Explicit crop/detail indicators
  if (/\b(detail|crop|cropped|fragment|ausschnitt|particolare|detalle|ritaglio)\b/.test(combined)) return true;
  // Very small and square-ish (likely cropped from larger work)
  if (Math.max(width, height) < 400 && Math.abs(width - height) < 100) return true;
  // Numbered parts like "cropped1", "cropped2"
  if (/cropped\d/.test(combined)) return true;
  return false;
}

// ─── R2 Upload ──────────────────────────────────────────────────────────────

async function uploadToR2(s3, imageUrl, key) {
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  const metadata = await sharp(buffer).metadata();

  if (Math.max(metadata.width, metadata.height) < MIN_DIM) return null;

  const displayBuffer = await sharp(buffer)
    .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  const displayMeta = await sharp(displayBuffer).metadata();

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: displayBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  const thumbKey = key.replace(/\.jpg$/, '-thumb.jpg');
  const thumbBuffer = await sharp(buffer)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: thumbKey,
    Body: thumbBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return {
    display: `https://images.sourcelibrary.org/${key}`,
    thumb: `https://images.sourcelibrary.org/${thumbKey}`,
    width: displayMeta.width,
    height: displayMeta.height,
    originalWidth: metadata.width,
    originalHeight: metadata.height,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;
  const artistIdx = args.indexOf('--artist');
  const artistFilter = artistIdx >= 0 ? args[artistIdx + 1] : null;

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Limit: ${limit === Infinity ? 'none' : limit}`);
  if (artistFilter) console.log(`Artist filter: ${artistFilter}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  let s3 = null;
  if (!dryRun) {
    s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  const query = { hidden_reason: 'low_resolution' };
  if (artistFilter) query.author = new RegExp(artistFilter, 'i');

  const remaining = await db.collection('books').find(query, {
    projection: { slug: 1, title: 1, author: 1, commons_title: 1, commons_full_url: 1, commons_width: 1, commons_height: 1 }
  }).toArray();

  console.log(`Found ${remaining.length} low-res artworks\n`);

  let upgraded = 0, markedCrop = 0, noUpgrade = 0, errors = 0;

  for (const book of remaining) {
    if (upgraded >= limit) break;
    const oldMax = Math.max(book.commons_width || 0, book.commons_height || 0);
    const shortTitle = (book.title || '').slice(0, 55);
    process.stdout.write(`${shortTitle.padEnd(56)} ${oldMax}px `);

    try {
      // Check if this is a detail crop → mark permanently
      if (isDetailCrop(book.title, book.commons_title, book.commons_width, book.commons_height)) {
        if (!dryRun) {
          await db.collection('books').updateOne(
            { _id: book._id },
            { $set: { hidden_reason: 'detail_crop', updated_at: new Date() } }
          );
        }
        console.log('→ CROP (marked)');
        markedCrop++;
        continue;
      }

      let bestImage = null;

      // Strategy 1: Inventory number extraction
      const inv = extractInventoryNumber(book.commons_title);
      if (inv && inv.type === 'rijksmuseum') {
        // Try direct lookup first, then search
        bestImage = await lookupRijksObject(inv.id);
        if (!bestImage) bestImage = await searchRijksByInventory(inv.id);
        if (bestImage) {
          console.log(`→ RIJKS (inv: ${inv.id}) ${bestImage.width}x${bestImage.height}`);
        }
        await sleep(DELAY_MS);
      }

      // Strategy 2: Search Commons for better version
      if (!bestImage) {
        bestImage = await searchCommonsForBetter(book.commons_title, oldMax);
        if (bestImage) {
          console.log(`→ COMMONS ${bestImage.width}x${bestImage.height} (${bestImage.filename?.slice(0, 40)})`);
        }
        await sleep(DELAY_MS);
      }

      if (!bestImage) {
        console.log('→ -');
        noUpgrade++;
        continue;
      }

      if (dryRun) {
        upgraded++;
        continue;
      }

      // Upload to R2
      const imageUrl = bestImage.source === 'commons'
        ? bestImage.url || bestImage.thumbUrl
        : bestImage.imageUrl;

      const r2Key = `artwork/${book.slug.replace(/^art-/, '')}.jpg`;
      const result = await uploadToR2(s3, imageUrl, r2Key);

      if (!result) {
        console.log('  (upload failed or still too small)');
        noUpgrade++;
        continue;
      }

      const update = {
        thumbnail_blob: result.display,
        thumbnail: result.thumb,
        full_width: result.originalWidth,
        full_height: result.originalHeight,
        hidden: false,
        hidden_reason: null,
        updated_at: new Date(),
        upgrade_source: bestImage.source,
        upgrade_date: new Date(),
      };

      if (bestImage.source === 'commons') {
        update.commons_title = `File:${bestImage.filename}`;
        update.commons_full_url = bestImage.url;
        update.commons_width = bestImage.width;
        update.commons_height = bestImage.height;
        if (bestImage.title) update.display_title = bestImage.title;
        if (bestImage.artist) update.author = bestImage.artist;
        if (bestImage.medium) update.medium = bestImage.medium;
        if (bestImage.credit) update.commons_credit = bestImage.credit;
      } else {
        update.museum_source = bestImage.source;
        if (bestImage.objectUrl) update.museum_url = bestImage.objectUrl;
        if (bestImage.objectNumber) update.museum_object_number = bestImage.objectNumber;
        if (bestImage.title) update.display_title = bestImage.title;
        if (bestImage.artist) update.author = bestImage.artist;
        if (bestImage.medium) update.medium = bestImage.medium;
        if (bestImage.dimensions) update.dimensions_display = bestImage.dimensions;
        if (bestImage.dateCreated) update.published = bestImage.dateCreated;
        if (bestImage.description) update.description = bestImage.description;
        if (bestImage.classification) update.classification = bestImage.classification;
        update['image_source.license'] = bestImage.license || 'CC0-1.0';
      }

      await db.collection('books').updateOne({ _id: book._id }, { $set: update });
      upgraded++;

    } catch (err) {
      console.log(`→ ERROR: ${err.message}`);
      errors++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n━━━ DONE ━━━`);
  console.log(`Upgraded: ${upgraded}`);
  console.log(`Marked as crop: ${markedCrop}`);
  console.log(`No upgrade: ${noUpgrade}`);
  console.log(`Errors: ${errors}`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
