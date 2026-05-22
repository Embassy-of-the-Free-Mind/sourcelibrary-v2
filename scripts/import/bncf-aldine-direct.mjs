#!/usr/bin/env node
/**
 * BNCF Aldine direct import — writes straight to MongoDB from Hetzner.
 * Bypasses /api/import/ia to avoid Vercel connection pool saturation (the
 * May 15 incident: ~20 concurrent Vercel functions doing insertMany on Atlas).
 *
 * Usage (on Hetzner):
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/bncf-aldine-direct.mjs
 *
 * Options:
 *   --dry-run        Preview without writing
 *   --delay=N        ms between imports (default: 3000)
 *   --start-from=N   Resume from item index N (0-based)
 *   --limit=N        Stop after N successful imports
 */

import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DELAY = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '3000');
const START_FROM = parseInt(args.find(a => a.startsWith('--start-from='))?.split('=')[1] || '0');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;

const DATA_FILE_ARG = args.find(a => a.startsWith('--data='))?.split('=')[1];
const DATA_FILE = DATA_FILE_ARG || new URL('../../bncf-aldine-remaining.json', import.meta.url).pathname;
const LOG_FILE = '/root/bncf-aldine-direct.log';

if (!fs.existsSync(DATA_FILE)) {
  console.error(`Data file not found: ${DATA_FILE}`);
  process.exit(1);
}

const entries = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
console.log(`Loaded ${entries.length} BNCF Aldine entries`);

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normalizeTitle(t) {
  return t?.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || '';
}

/**
 * Encode a filename component for an archive.org URL.
 *
 * IA stores Arabic/Hebrew/Persian filenames as NFD (decomposed Unicode) on
 * disk: e.g. أ is stored as ا + ٔ (alif + combining hamza-above), not as the
 * precomposed U+0623. CDN mirrors and the IIIF image server 404 on the NFC
 * form. NFD-normalizing first is a no-op for ASCII filenames, so it's safe
 * to apply universally.
 */
function nfdEnc(filename) {
  return encodeURIComponent(filename.normalize('NFD'));
}
function normalizeAuthor(a) {
  return a?.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || '';
}
function sourceFingerprint({ ia_identifier }) {
  return `ia:${ia_identifier}`;
}

function slugify(text, maxLen = 60) {
  if (!text) return 'untitled';
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim().replace(/^-|-$/g, '')
    .substring(0, maxLen);
}

async function generateUniqueSlug(db, title, author) {
  const base = slugify(`${title}-${author}`.substring(0, 80));
  let slug = base;
  let i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

async function getPageCount(iaIdentifier) {
  // 1. Try IIIF manifest
  try {
    const res = await fetch(
      `https://iiif.archive.org/iiif/${iaIdentifier}/manifest.json`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (res.ok) {
      const manifest = await res.json();
      if (manifest.items?.length) return { count: manifest.items.length, source: 'iiif_v3' };
      if (manifest.sequences?.[0]?.canvases?.length) return { count: manifest.sequences[0].canvases.length, source: 'iiif_v2' };
    }
  } catch {}

  // 2. Try IA metadata imagecount
  try {
    const res = await fetch(`https://archive.org/metadata/${iaIdentifier}`, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const meta = await res.json();
      const imagecount = meta.metadata?.imagecount;
      if (imagecount) return { count: parseInt(imagecount, 10), source: 'imagecount' };

      // 3. Count JP2 files
      const jp2Count = (meta.files || []).filter(f => f.name?.endsWith('.jp2') && !f.name.includes('thumb')).length;
      if (jp2Count > 1) return { count: jp2Count, source: 'jp2_files' };

      // 4. Count JPG files (BULAC and similar institutions upload sequential .jpg instead of .jp2)
      // Note: IA sometimes zips JP2s (zip not counted by step 3) but still serves them via IIIF image API.
      // JPG fallback is low-res (~72KB); prefer IIIF image server URLs when a jp2.zip is present.
      const jp2Zip = (meta.files || []).find(f => f.name?.endsWith('_jp2.zip'));
      const jpgFiles = (meta.files || [])
        .filter(f => f.name?.endsWith('.jpg') && !f.name.includes('thumb'))
        .map(f => f.name)
        .sort();
      if (jpgFiles.length > 1) return { count: jpgFiles.length, source: 'jpg_files', jpgFiles, jp2Zip: jp2Zip?.name || null };
    }
  } catch {}

  return null;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 3,  // keep Atlas connection pressure low
  });
  await client.connect();
  const db = client.db('bookstore');

  let imported = 0, skipped = 0, errors = 0, totalPages = 0;
  const startTime = Date.now();

  const toProcess = entries.slice(START_FROM);
  log(`Starting from index ${START_FROM}, ${toProcess.length} entries to attempt`);

  for (let i = 0; i < toProcess.length; i++) {
    if (imported >= LIMIT) {
      log(`Reached --limit=${LIMIT}, stopping`);
      break;
    }

    const entry = toProcess[i];
    const globalIdx = START_FROM + i + 1;
    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
    const prefix = `[${globalIdx}/${entries.length}] ${entry.year || '?'} ${entry.ia_identifier}`;

    // Check duplicate
    const existing = await db.collection('books').findOne(
      { $or: [{ ia_identifier: entry.ia_identifier }, { source_fingerprint: `ia:${entry.ia_identifier}` }] },
      { projection: { _id: 1 } }
    );
    if (existing) {
      log(`${prefix} SKIP (dupe)`);
      skipped++;
      continue;
    }

    // Get page count
    const pageResult = await getPageCount(entry.ia_identifier);
    if (!pageResult) {
      log(`${prefix} ERROR: No page count (no IIIF, no imagecount, no JP2)`);
      errors++;
      await sleep(DELAY);
      continue;
    }

    const { count: pageCount, source: pageCountSource, jpgFiles, jp2Zip } = pageResult;

    if (DRY_RUN) {
      log(`${prefix} DRY-RUN: would import ${pageCount}p — "${entry.title.substring(0, 60)}"`);
      imported++;
      continue;
    }

    try {
      const slug = await generateUniqueSlug(db, entry.title, entry.author);
      const bookId = new ObjectId();
      const bookIdStr = bookId.toHexString();

      // jpg_files + jp2Zip: institution uploaded zipped JP2s — use IIIF image server (full-res)
      // jpg_files only: use direct JPG download (lower-res, last resort)
      // default: use IA IIIF viewer page URLs
      let getPageUrl, getThumbUrl;
      if (jpgFiles && jp2Zip) {
        const zipBase = jp2Zip.replace('.zip', '');
        const iiifBase = `${nfdEnc(entry.ia_identifier)}%2F${nfdEnc(jp2Zip)}%2F${nfdEnc(zipBase)}`;
        const stem = jpgFiles[0].replace(/\d+\.jpg$/, '');
        getPageUrl = (n) => {
          const idx = String(n - 1).padStart(jpgFiles[0].match(/(\d+)\.jpg$/)[1].length, '0');
          return `https://iiif.archive.org/image/iiif/3/${iiifBase}%2F${nfdEnc(stem + idx + '.jp2')}/full/max/0/default.jpg`;
        };
        getThumbUrl = (n) => {
          const idx = String(n - 1).padStart(jpgFiles[0].match(/(\d+)\.jpg$/)[1].length, '0');
          return `https://iiif.archive.org/image/iiif/3/${iiifBase}%2F${nfdEnc(stem + idx + '.jp2')}/full/pct:15/0/default.jpg`;
        };
      } else if (jpgFiles) {
        getPageUrl = (n) => `https://archive.org/download/${nfdEnc(entry.ia_identifier)}/${nfdEnc(jpgFiles[n - 1])}`;
        getThumbUrl = (n) => `https://archive.org/download/${nfdEnc(entry.ia_identifier)}/${nfdEnc(jpgFiles[n - 1].replace('.jpg', '_thumb.jpg'))}`;
      } else {
        getPageUrl = (n) => `https://archive.org/download/${entry.ia_identifier}/page/n${n}/full/full/0/default.jpg`;
        getThumbUrl = (n) => `https://archive.org/download/${entry.ia_identifier}/page/n${n}/full/pct:15/0/default.jpg`;
      }

      const bookDoc = {
        _id: bookId,
        id: bookIdStr,
        slug,
        tenant_id: 'default',
        title: entry.title,
        display_title: null,
        author: entry.author,
        language: entry.original_language || 'Latin',
        published: entry.year ? String(entry.year) : 'Unknown',
        categories: [],
        ia_identifier: entry.ia_identifier,
        thumbnail: getThumbUrl(0),
        pages_count: pageCount,
        pages_ocr: 0,
        pages_translated: 0,
        pages_archived: 0,
        dublin_core: {
          dc_identifier: [`IA:${entry.ia_identifier}`],
          dc_source: `https://archive.org/details/${entry.ia_identifier}`,
        },
        image_source: {
          provider: 'internet_archive',
          provider_name: 'Internet Archive',
          source_url: `https://archive.org/details/${entry.ia_identifier}`,
          identifier: entry.ia_identifier,
          license: 'publicdomain',
          contributing_library: 'Biblioteca Nazionale Centrale di Firenze',
          access_date: new Date(),
        },
        page_count_source: pageCountSource,
        // High priority so archive-bulk/archive-ocr crons pick this book up
        // on their next pass instead of waiting behind the long-tail backlog.
        // Cleared/recomputed once the book reaches downstream pipeline phases.
        processing_priority: 80,
        processing_priority_breakdown: { import_default: 'fresh import — promote for archive priority' },
        status: 'draft',
        hidden: true,
        visible: false,
        source_fingerprint: sourceFingerprint({ ia_identifier: entry.ia_identifier }),
        normalized_title: normalizeTitle(entry.title),
        normalized_author: normalizeAuthor(entry.author),
        created_at: new Date(),
        updated_at: new Date(),
      };

      await db.collection('books').insertOne(bookDoc);

      // Insert pages in chunks of 500 to avoid large single operations
      const CHUNK = 500;
      for (let start = 0; start < pageCount; start += CHUNK) {
        const pageDocs = [];
        for (let p = start; p < Math.min(start + CHUNK, pageCount); p++) {
          const pageId = new ObjectId();
          pageDocs.push({
            _id: pageId,
            id: pageId.toHexString(),
            tenant_id: 'default',
            book_id: bookIdStr,
            page_number: p + 1,
            photo: getPageUrl(p),
            thumbnail: getThumbUrl(p),
            photo_original: getPageUrl(p),
            created_at: new Date(),
            updated_at: new Date(),
          });
        }
        await db.collection('pages').insertMany(pageDocs, { ordered: false });
      }

      totalPages += pageCount;
      imported++;
      log(`${prefix} OK ${pageCount}p [${elapsed}m elapsed, ${imported} imported] — "${entry.title.substring(0, 60)}"`);
    } catch (err) {
      log(`${prefix} ERROR: ${err.message}`);
      errors++;
    }

    await sleep(DELAY);
  }

  await client.close();

  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  log(`\n=== DONE in ${elapsed}m ===`);
  log(`Imported: ${imported} | Skipped: ${skipped} | Errors: ${errors} | Pages: ${totalPages}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
