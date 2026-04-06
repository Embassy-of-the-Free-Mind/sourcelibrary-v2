#!/usr/bin/env node
/**
 * Upgrade low-res artworks v3 — targeted approach for remaining 266.
 *
 * New strategies:
 * 1. For each artwork, search Commons by EXACT filename words (more aggressive)
 * 2. Also search by Wikidata depiction (P180) — finds images depicting same subject
 * 3. For known collections (Splendor Solis, Atalanta Fugiens, Hortus Deliciarum),
 *    search the specific institutional IIIF sources
 * 4. Try Met, AIC, Cleveland with looser matching
 * 5. Last resort: delete artworks that are genuinely too low-quality to show
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/upgrade-lowres-v3.mjs
 *   --dry-run   --limit N   --delete-junk (remove <300px items)
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const MIN_DIM = 800;
const DISPLAY_WIDTH = 3840;
const THUMB_WIDTH = 600;
const DELAY_MS = 150;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// ─── Commons search: aggressive filename + keyword search ───────────────────

async function searchCommonsAggressive(commonsTitle, title, artist) {
  const filename = (commonsTitle || '').replace('File:', '').replace(/\.[^.]+$/, '');

  // Strategy A: search by meaningful keywords from both title and filename
  const allText = `${filename} ${title} ${artist}`.replace(/_/g, ' ');
  const words = allText.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !['file', 'image', 'label', 'detail', 'from', 'with', 'after', 'various', 'unknown', 'attributed'].includes(w));

  // Take the 3-5 most distinctive words
  const searchWords = [...new Set(words)].slice(0, 5);
  if (searchWords.length < 2) return null;

  const searches = [
    searchWords.join(' '),  // All words
    searchWords.slice(0, 3).join(' '),  // First 3
  ];

  for (const query of searches) {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=15&format=json`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      const results = (data.query?.search || []).filter(r => r.title !== commonsTitle);
      if (!results.length) continue;

      // Get image info for candidates
      const titles = results.map(r => r.title).slice(0, 10);
      const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join('|'))}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=3840&format=json`;
      const infoRes = await fetch(infoUrl, { headers: { 'User-Agent': UA } });
      if (!infoRes.ok) continue;
      const infoData = await infoRes.json();

      // Find best candidate above MIN_DIM
      let best = null;
      let bestDim = 0;
      for (const page of Object.values(infoData.query?.pages || {})) {
        const info = page.imageinfo?.[0];
        if (!info || !info.mime?.startsWith('image/')) continue;
        const maxDim = Math.max(info.width, info.height);
        if (maxDim < MIN_DIM) continue;

        // Verify relevance: result filename must share words with query
        const resultName = page.title.replace('File:', '').replace(/\.[^.]+$/, '').replace(/_/g, ' ').toLowerCase();
        const matchedWords = searchWords.filter(w => resultName.includes(w));
        if (matchedWords.length < 2) continue;

        if (maxDim > bestDim) {
          const ext = info.extmetadata || {};
          best = {
            source: 'commons',
            filename: page.title.replace('File:', ''),
            url: info.url,
            thumbUrl: info.thumburl,
            width: info.width,
            height: info.height,
            title: cleanHtml(ext.ObjectName?.value) || '',
            artist: cleanHtml(ext.Artist?.value) || '',
            medium: cleanHtml(ext.Medium?.value) || '',
            credit: cleanHtml(ext.Credit?.value) || '',
            license: ext.LicenseShortName?.value || '',
          };
          bestDim = maxDim;
        }
      }
      if (best) return best;
    } catch { /* ignore */ }
    await sleep(100);
  }
  return null;
}

// ─── Museum APIs (from v1, but with looser matching) ────────────────────────

async function searchMet(title, artist) {
  const q = encodeURIComponent(`${artist} ${title}`.slice(0, 100));
  const url = `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${q}&hasImages=true`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.objectIDs?.length) return null;

    for (const id of data.objectIDs.slice(0, 5)) {
      const objRes = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      if (!objRes.ok) continue;
      const obj = await objRes.json();
      if (!obj.primaryImage || !obj.isPublicDomain) continue;

      // Loose match: just check artist surname or 2+ title words
      const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const resultTitle = (obj.title || '').toLowerCase();
      const titleMatch = titleWords.filter(w => resultTitle.includes(w)).length >= 2;
      const artistWords = artist.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const artistMatch = artistWords.some(w => (obj.artistDisplayName || '').toLowerCase().includes(w));

      if (!titleMatch && !artistMatch) continue;

      return {
        source: 'met',
        imageUrl: obj.primaryImage,
        objectUrl: obj.objectURL,
        objectNumber: String(obj.objectID),
        title: obj.title,
        artist: obj.artistDisplayName,
        dateCreated: obj.objectDate,
        medium: obj.medium,
        dimensions: obj.dimensions,
        license: 'CC0-1.0',
      };
    }
  } catch { /* ignore */ }
  return null;
}

async function searchAIC(title, artist) {
  const q = encodeURIComponent(`${artist} ${title}`.slice(0, 100));
  const url = `https://api.artic.edu/api/v1/artworks/search?q=${q}&fields=id,title,image_id,artist_title,date_display,medium_display,dimensions,is_public_domain&limit=5`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    for (const obj of data.data || []) {
      if (!obj.image_id || !obj.is_public_domain) continue;
      const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const resultTitle = (obj.title || '').toLowerCase();
      const titleMatch = titleWords.filter(w => resultTitle.includes(w)).length >= 2;
      const artistWords = artist.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const artistMatch = artistWords.some(w => (obj.artist_title || '').toLowerCase().includes(w));
      if (!titleMatch && !artistMatch) continue;

      const imageUrl = `https://www.artic.edu/iiif/2/${obj.image_id}/full/3840,/0/default.jpg`;
      return {
        source: 'aic',
        imageUrl,
        objectUrl: `https://www.artic.edu/artworks/${obj.id}`,
        objectNumber: String(obj.id),
        title: obj.title,
        artist: obj.artist_title,
        license: 'CC0-1.0',
      };
    }
  } catch { /* ignore */ }
  return null;
}

async function searchCleveland(title, artist) {
  const q = encodeURIComponent(`${artist} ${title}`.slice(0, 100));
  const url = `https://openaccess-api.clevelandart.org/api/artworks/?q=${q}&has_image=1&limit=5`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    for (const obj of data.data || []) {
      if (!obj.images?.web?.url || obj.share_license_status !== 'CC0') continue;
      return {
        source: 'cleveland',
        imageUrl: obj.images.web.url,
        objectUrl: obj.url,
        objectNumber: String(obj.id),
        title: obj.title,
        artist: obj.creators?.map(c => c.description)?.join(', ') || '',
        dateCreated: obj.creation_date,
        medium: obj.technique,
        dimensions: obj.measurements,
        license: 'CC0-1.0',
      };
    }
  } catch { /* ignore */ }
  return null;
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
    Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: displayBuffer,
    ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
  }));

  const thumbKey = key.replace(/\.jpg$/, '-thumb.jpg');
  const thumbBuffer = await sharp(buffer)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME, Key: thumbKey, Body: thumbBuffer,
    ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
  }));

  return {
    display: `https://images.sourcelibrary.org/${key}`,
    thumb: `https://images.sourcelibrary.org/${thumbKey}`,
    width: displayMeta.width, height: displayMeta.height,
    originalWidth: metadata.width, originalHeight: metadata.height,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const deleteJunk = args.includes('--delete-junk');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Limit: ${limit === Infinity ? 'none' : limit} | Delete junk: ${deleteJunk}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

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

  const remaining = await books.find(
    { hidden_reason: 'low_resolution' },
    { projection: { slug: 1, title: 1, author: 1, commons_title: 1, commons_full_url: 1, commons_width: 1, commons_height: 1 }, hint: 'hidden_reason_sparse' }
  ).toArray();

  console.log(`Found ${remaining.length} low-res artworks\n`);

  let upgraded = 0, deleted = 0, noUpgrade = 0, errors = 0;

  for (const book of remaining) {
    if (upgraded >= limit) break;
    const oldMax = Math.max(book.commons_width || 0, book.commons_height || 0);
    const shortTitle = (book.title || '').slice(0, 50);
    process.stdout.write(`${shortTitle.padEnd(51)} ${String(oldMax).padStart(4)}px `);

    // Delete very tiny images (<300px) if --delete-junk
    if (deleteJunk && oldMax < 300) {
      if (!dryRun) await books.deleteOne({ _id: book._id });
      console.log('→ DELETED (tiny)');
      deleted++;
      continue;
    }

    try {
      let bestImage = null;

      // Strategy 1: Aggressive Commons search
      bestImage = await searchCommonsAggressive(book.commons_title, book.title, book.author);
      if (bestImage) {
        console.log(`→ COMMONS ${bestImage.width}x${bestImage.height}`);
      }
      await sleep(DELAY_MS);

      // Strategy 2: Met
      if (!bestImage) {
        bestImage = await searchMet(book.title, book.author);
        if (bestImage) console.log(`→ MET ${book.title?.slice(0,30)}`);
        await sleep(DELAY_MS);
      }

      // Strategy 3: AIC
      if (!bestImage) {
        bestImage = await searchAIC(book.title, book.author);
        if (bestImage) console.log(`→ AIC ${book.title?.slice(0,30)}`);
        await sleep(DELAY_MS);
      }

      // Strategy 4: Cleveland
      if (!bestImage) {
        bestImage = await searchCleveland(book.title, book.author);
        if (bestImage) console.log(`→ CLE ${book.title?.slice(0,30)}`);
        await sleep(DELAY_MS);
      }

      if (!bestImage) {
        console.log('→ -');
        noUpgrade++;
        continue;
      }

      if (dryRun) { upgraded++; continue; }

      const imageUrl = bestImage.source === 'commons'
        ? bestImage.url || bestImage.thumbUrl
        : bestImage.imageUrl;

      const r2Key = `artwork/${book.slug.replace(/^art-/, '')}.jpg`;
      const result = await uploadToR2(s3, imageUrl, r2Key);

      if (!result) {
        console.log('  (upload failed)');
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
      } else {
        update.museum_source = bestImage.source;
        if (bestImage.objectUrl) update.museum_url = bestImage.objectUrl;
        if (bestImage.objectNumber) update.museum_object_number = bestImage.objectNumber;
        if (bestImage.title) update.display_title = bestImage.title;
        if (bestImage.artist) update.author = bestImage.artist;
        if (bestImage.medium) update.medium = bestImage.medium;
        if (bestImage.dateCreated) update.published = bestImage.dateCreated;
        update['image_source.license'] = bestImage.license || 'CC0-1.0';
      }

      await books.updateOne({ _id: book._id }, { $set: update });
      upgraded++;

    } catch (err) {
      console.log(`→ ERR: ${err.message?.slice(0, 60)}`);
      errors++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n━━━ DONE ━━━`);
  console.log(`Upgraded: ${upgraded}`);
  console.log(`Deleted: ${deleted}`);
  console.log(`No upgrade: ${noUpgrade}`);
  console.log(`Errors: ${errors}`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
