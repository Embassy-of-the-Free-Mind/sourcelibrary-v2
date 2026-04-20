#!/usr/bin/env node
/**
 * Backfill ~1,105 early-wave artworks missing commons_full_url and dimensions.
 * These imports have image_source.identifier but no commons_title, no full URL,
 * no dimensions, and sometimes swapped thumbnail/thumbnail_blob fields.
 *
 * Strategy:
 *   1. Look up the identifier on Commons API to get full-res URL + dimensions
 *   2. Fix swapped thumbnail/thumbnail_blob fields
 *   3. Fill in commons_title, commons_url, commons_full_url, commons_width/height
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-artwork-fullres.mjs [--limit 100] [--dry-run] [--concurrency 4]
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0') || 999999;
const CONCURRENCY = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--concurrency') || '0') || 4;

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function cleanHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Look up a file on Commons by identifier.
 * Tries: File:{identifier}, then searches by filename fragment.
 */
async function commonsLookup(identifier) {
  // Clean up identifier — remove provider prefixes
  let filename = identifier
    .replace(/^File:/, '')
    .replace(/\.(jpg|jpeg|png|gif|tif|tiff)$/i, '');

  // Try direct title lookup
  for (const tryTitle of [`File:${identifier}`, `File:${filename}.jpg`, `File:${filename}.png`]) {
    const params = new URLSearchParams({
      action: 'query',
      titles: tryTitle,
      prop: 'imageinfo',
      iiprop: 'url|size|extmetadata',
      format: 'json',
    });

    try {
      const res = await fetch(`${COMMONS_API}?${params}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;

      const data = await res.json();
      const pages = data.query?.pages || {};
      const page = Object.values(pages)[0];

      if (page && page.missing === undefined && page.imageinfo?.[0]) {
        const info = page.imageinfo[0];
        const ext = info.extmetadata || {};
        return {
          fullUrl: info.url,
          width: info.width,
          height: info.height,
          pageUrl: info.descriptionurl,
          title: page.title,
          artist: cleanHtml(ext.Artist?.value) || '',
          license: ext.LicenseShortName?.value || '',
          credit: cleanHtml(ext.Credit?.value) || '',
        };
      }
    } catch { /* continue to next attempt */ }
  }

  return null;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Find artworks missing full-res URL
  const items = await books.find({
    'image_source.provider': 'wikimedia_commons',
    resource_type: { $exists: true },
    $or: [
      { commons_full_url: { $exists: false } },
      { commons_full_url: '' },
      { commons_full_url: null },
    ],
  }, {
    projection: {
      _id: 1, slug: 1, title: 1, author: 1,
      thumbnail: 1, thumbnail_blob: 1,
      commons_title: 1, 'image_source.identifier': 1, 'image_source.source_url': 1,
    },
  }).limit(LIMIT).toArray();

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}Backfilling ${items.length} artworks (concurrency: ${CONCURRENCY})\n`);

  let success = 0, notFound = 0, errors = 0, swapFixed = 0;
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      const art = items[i];
      const label = `[${i + 1}/${items.length}] ${art.author?.substring(0, 20)} — ${art.title?.substring(0, 40)}`;

      // Extract Commons filename from source_url, commons_title, or identifier
      let identifier = art.commons_title || art.image_source?.identifier || '';

      // If no identifier, try extracting from source_url
      // e.g. "https://commons.wikimedia.org/wiki/File%3ADe%20alchemist%2C%20objectnr%20A%2011807.tif"
      if (!identifier && art.image_source?.source_url) {
        const match = art.image_source.source_url.match(/File[:%]3A(.+?)(?:\?|$)/i);
        if (match) {
          identifier = 'File:' + decodeURIComponent(match[1].replace(/%20/g, ' '));
        }
      }

      if (!identifier) {
        console.log(`  ? ${label} — no identifier`);
        notFound++;
        continue;
      }

      try {
        await sleep(200 / CONCURRENCY); // Spread rate limit across workers
        const meta = await commonsLookup(identifier);

        if (!meta) {
          console.log(`  ? ${label} — not found`);
          notFound++;
          continue;
        }

        const update = {
          commons_full_url: meta.fullUrl,
          commons_width: meta.width,
          commons_height: meta.height,
          commons_url: meta.pageUrl,
          commons_title: meta.title,
          updated_at: new Date(),
        };

        // Fix swapped thumbnail/thumbnail_blob
        // If thumbnail_blob ends with -thumb.jpg, it's the thumb in the wrong field
        if (art.thumbnail_blob?.endsWith('-thumb.jpg') && art.thumbnail && !art.thumbnail.endsWith('-thumb.jpg')) {
          const correctThumb = art.thumbnail_blob; // this IS the thumb
          const correctDisplay = art.thumbnail;     // this IS the display
          update.thumbnail = correctThumb;
          update.thumbnail_blob = correctDisplay;
          swapFixed++;
        }

        if (DRY_RUN) {
          console.log(`  ✓ ${label} — ${meta.width}x${meta.height}${swapFixed ? ' [swap]' : ''}`);
        } else {
          await books.updateOne({ _id: art._id }, { $set: update });
          console.log(`  ✓ ${label} — ${meta.width}x${meta.height}`);
        }
        success++;

      } catch (err) {
        console.log(`  ✗ ${label} — ${err.message?.substring(0, 60)}`);
        errors++;
        if (err.message?.includes('429')) await sleep(10000);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Updated: ${success}`);
  console.log(`Not found on Commons: ${notFound}`);
  console.log(`Errors: ${errors}`);
  console.log(`Swap fixed: ${swapFixed}`);

  await client.close();
}

main().catch(console.error);
