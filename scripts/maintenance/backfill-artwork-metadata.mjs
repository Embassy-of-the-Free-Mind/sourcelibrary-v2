#!/usr/bin/env node
/**
 * Backfill missing metadata on artworks imported from Wikimedia Commons.
 * Re-fetches imageinfo from the API to populate:
 *   - commons_full_url (original full-res image URL)
 *   - commons_width, commons_height, image_width, image_height
 *   - commons_description (if missing)
 *   - commons_categories (if missing)
 *   - commons_page_title (if missing)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-artwork-metadata.mjs [--dry-run] [--limit=100]
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 0;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) metadata-backfill';
const DELAY_MS = 300; // ~3 req/s, well under Wikimedia limits

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function stripHtml(s) { return (s || '').replace(/<[^>]*>/g, '').trim(); }

async function fetchFileMetadata(fileTitle) {
  const params = new URLSearchParams({
    action: 'query', titles: fileTitle, prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata', format: 'json',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const page = Object.values(data.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) return null;

  const ext = info.extmetadata || {};
  return {
    commons_full_url: info.url,
    commons_width: info.width,
    commons_height: info.height,
    image_width: info.width,
    image_height: info.height,
    commons_description: stripHtml(ext.ImageDescription?.value || ''),
    commons_categories: ext.Categories?.value || '',
    commons_page_title: page.title,
  };
}

// Derive the File: title from a Wikimedia thumbnail URL
function thumbnailToFileTitle(url) {
  // https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo_Bar.jpg
  // → File:Foo_Bar.jpg
  const match = url.match(/\/wikipedia\/commons\/[a-f0-9]\/[a-f0-9]{2}\/(.+?)$/);
  if (match) return `File:${decodeURIComponent(match[1])}`;

  // thumb URL: /wikipedia/commons/thumb/a/ab/Foo_Bar.jpg/800px-Foo_Bar.jpg
  const thumbMatch = url.match(/\/wikipedia\/commons\/thumb\/[a-f0-9]\/[a-f0-9]{2}\/(.+?)\/\d+px-/);
  if (thumbMatch) return `File:${decodeURIComponent(thumbMatch[1])}`;

  return null;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find artworks missing commons_full_url that have Wikimedia thumbnails
  const query = {
    content_type: 'artwork', visible: true,
    commons_full_url: { $exists: false },
    thumbnail: /upload\.wikimedia\.org/,
  };

  const total = await db.collection('books').countDocuments(query);
  const limit = LIMIT || total;

  console.log(`Artwork metadata backfill${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`${total} artworks missing metadata, processing ${Math.min(limit, total)}`);

  const cursor = db.collection('books').find(query, {
    projection: { title: 1, thumbnail: 1, commons_description: 1, commons_categories: 1 },
  }).limit(limit);

  let processed = 0, updated = 0, failed = 0;

  for await (const book of cursor) {
    processed++;

    const fileTitle = thumbnailToFileTitle(book.thumbnail);
    if (!fileTitle) {
      failed++;
      if (failed <= 5) console.log(`  SKIP: Can't parse file title from: ${book.thumbnail?.substring(0, 80)}`);
      continue;
    }

    try {
      const meta = await fetchFileMetadata(fileTitle);
      if (!meta) { failed++; continue; }

      // Only update fields that are missing
      const updates = {};
      if (!book.commons_full_url) updates.commons_full_url = meta.commons_full_url;
      if (meta.commons_width) { updates.commons_width = meta.commons_width; updates.image_width = meta.commons_width; }
      if (meta.commons_height) { updates.commons_height = meta.commons_height; updates.image_height = meta.commons_height; }
      if (!book.commons_description && meta.commons_description) updates.commons_description = meta.commons_description;
      if (!book.commons_categories && meta.commons_categories) updates.commons_categories = meta.commons_categories;
      if (meta.commons_page_title) updates.commons_page_title = meta.commons_page_title;

      if (Object.keys(updates).length > 0 && !DRY_RUN) {
        await db.collection('books').updateOne({ _id: book._id }, { $set: updates });
      }
      updated++;
    } catch (e) {
      failed++;
      if (failed <= 5) console.log(`  ERROR: ${book.title?.substring(0, 40)} — ${e.message?.substring(0, 50)}`);
    }

    if (processed % 500 === 0 || processed === Math.min(limit, total)) {
      console.log(`  ${processed}/${Math.min(limit, total)} — ${updated} updated, ${failed} failed`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${updated} updated, ${failed} failed.`);
  await client.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
