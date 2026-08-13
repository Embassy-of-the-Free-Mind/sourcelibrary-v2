#!/usr/bin/env node
/**
 * BSB Aldine importer — reads a JSON file of BSB IIIF entries and imports
 * each as a book + pages directly to MongoDB (no API layer needed).
 *
 * Derived from batch-import-istc-bsb.mjs. Key difference: manifest_url and
 * metadata come from the input file (no ISTC lookup needed).
 *
 * Usage (on Hetzner):
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/bsb-from-file.mjs --data=/root/bncf-aldine-bsb-alts.json
 *
 * Options:
 *   --data=<file>    Required. Path to JSON input file.
 *   --dry-run        Preview without writing to DB.
 *   --limit=N        Stop after N successful imports.
 *   --delay=N        ms between imports (default: 3000).
 *   --start-from=N   Skip the first N entries (0-based index).
 */

import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;
const DELAY = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '3000');
const START_FROM = parseInt(args.find(a => a.startsWith('--start-from='))?.split('=')[1] || '0');
const DATA_FILE = args.find(a => a.startsWith('--data='))?.split('=')[1];
const LOG_FILE = '/root/bsb-aldine-import.log';

if (!DATA_FILE) {
  console.error('Error: --data=<file> is required');
  process.exit(1);
}
if (!fs.existsSync(DATA_FILE)) {
  console.error(`Data file not found: ${DATA_FILE}`);
  process.exit(1);
}

const entries = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

// ── Helpers (copied verbatim from batch-import-istc-bsb.mjs) ─────────

function extractBsbId(url) {
  if (!url) return null;
  const match = url.match(/(bsb\d{5,})/);
  return match ? match[1] : null;
}

function slugify(text, maxLen = 60) {
  if (!text) return 'untitled';
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, maxLen)
    .replace(/-$/, '');
}

function generateSlug(title, author) {
  const slugTitle = slugify(title, 60);
  const lastName = (author || '').split(',')[0].trim();
  const slugAuthor = slugify(lastName, 20);
  if (!slugAuthor || slugAuthor === 'unknown') return slugTitle;
  return `${slugTitle}-${slugAuthor}`;
}

async function ensureUniqueSlug(db, slug) {
  let candidate = slug;
  let counter = 1;
  while (await db.collection('books').findOne({ slug: candidate }, { projection: { _id: 1 } })) {
    candidate = `${slug}-${counter}`;
    counter++;
  }
  return candidate;
}

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
          'Accept': 'application/json, application/ld+json',
        },
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return await res.json();
      if (res.status === 429) {
        log(`  Rate limited, waiting 10s...`);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      if (i === retries - 1) return null;
    } catch (e) {
      if (i === retries - 1) { log(`  Fetch error: ${e.message}`); return null; }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  return null;
}

// Handles both IIIF v2 (sequences/canvases) and v3 (items) manifests.
function extractPages(manifest) {
  // IIIF v3
  if (manifest?.items?.length) {
    return manifest.items.map(item => {
      const annotationPage = item.items?.[0];
      const annotation = annotationPage?.items?.[0];
      const body = annotation?.body;
      const service = Array.isArray(body?.service) ? body.service[0] : body?.service;
      const serviceId = service?.id || service?.['@id'];
      let imageUrl = body?.id || body?.['@id'] || '';
      let thumbnail = imageUrl;
      if (serviceId) {
        imageUrl = `${serviceId}/full/max/0/default.jpg`;
        thumbnail = `${serviceId}/full/200,/0/default.jpg`;
      }
      return { photo: imageUrl, thumbnail };
    });
  }

  // IIIF v2
  const canvases = manifest?.sequences?.[0]?.canvases || [];
  return canvases.map(canvas => {
    const imageResource = canvas.images?.[0]?.resource;
    let imageUrl = imageResource?.['@id'] || '';
    const imageService = imageResource?.service?.['@id'];
    if (imageService) {
      imageUrl = `${imageService}/full/full/0/default.jpg`;
    }
    let thumbnail = imageUrl;
    if (imageService) {
      thumbnail = `${imageService}/full/200,/0/default.jpg`;
    }
    return { photo: imageUrl, thumbnail };
  });
}

// ── Logging ──────────────────────────────────────────────────────────

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  log('');
  log('═══════════════════════════════════════════════');
  log('BSB-FROM-FILE IMPORT (direct MongoDB)');
  log('═══════════════════════════════════════════════');
  log(`Data: ${DATA_FILE}`);
  log(`Dry run: ${DRY_RUN} | Limit: ${LIMIT === Infinity ? 'none' : LIMIT} | Delay: ${DELAY}ms | Start: ${START_FROM}`);
  log(`Loaded ${entries.length} entries`);
  log('');

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');

  let imported = 0, skipped = 0, errors = 0, totalPages = 0;
  const startTime = Date.now();

  const toProcess = entries.slice(START_FROM);

  for (let i = 0; i < toProcess.length; i++) {
    if (imported >= LIMIT) {
      log(`Reached --limit=${LIMIT}, stopping`);
      break;
    }

    const entry = toProcess[i];
    const globalIdx = START_FROM + i + 1;
    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
    const prefix = `[${globalIdx}/${entries.length}] ${entry.bncf_source_id || entry.manifest_url}`;

    const manifestUrl = entry.manifest_url;
    if (!manifestUrl) {
      log(`${prefix} SKIP — no manifest_url`);
      skipped++;
      continue;
    }

    const bsbId = extractBsbId(manifestUrl);
    if (!bsbId) {
      log(`${prefix} SKIP — could not extract BSB ID from ${manifestUrl}`);
      skipped++;
      continue;
    }

    const title = entry.title || 'Unknown';
    const author = entry.author || 'Unknown';
    const year = entry.year ? String(entry.year) : null;
    const language = entry.original_language || 'Latin';
    const collections = entry.collections || [];
    const bncfSourceId = entry.bncf_source_id || null;

    // Dedupe: check if a book with this manifest already exists
    const existing = await db.collection('books').findOne(
      { 'image_source.iiif_manifest': manifestUrl },
      { projection: { _id: 1, slug: 1 } }
    );
    if (existing) {
      log(`${prefix} SKIP (dupe) — already exists as ${existing.slug || existing._id}`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      log(`${prefix} DRY-RUN: would import "${title.substring(0, 60)}" (${bsbId})`);
      imported++;
      continue;
    }

    // Fetch manifest
    const manifest = await fetchWithRetry(manifestUrl);
    if (!manifest) {
      log(`${prefix} ERROR — manifest fetch failed: ${manifestUrl}`);
      errors++;
      await new Promise(r => setTimeout(r, DELAY));
      continue;
    }

    const pages = extractPages(manifest);
    if (pages.length === 0) {
      log(`${prefix} ERROR — no pages in manifest`);
      errors++;
      await new Promise(r => setTimeout(r, DELAY));
      continue;
    }

    try {
      const bookId = new ObjectId();
      const bookIdStr = bookId.toHexString();
      const slug = await ensureUniqueSlug(db, generateSlug(title, author));

      const bookDoc = {
        _id: bookId,
        id: bookIdStr,
        slug,
        title,
        author,
        language,
        published: year || 'Unknown',
        categories: [],
        collections,
        thumbnail: pages[0]?.thumbnail || '',
        pages_count: pages.length,
        pages_ocr: 0,
        pages_translated: 0,
        image_source: {
          provider: 'bsb',
          provider_name: 'Bayerische Staatsbibliothek',
          source_url: `https://www.digitale-sammlungen.de/en/view/${bsbId}`,
          source_id: bsbId,
          iiif_manifest: manifestUrl,
          license: 'CC-BY-NC-4.0',
          license_url: 'https://creativecommons.org/licenses/by-nc/4.0/',
          contributing_library: 'Bayerische Staatsbibliothek, Munich',
          shelfmark: bsbId,
          ...(bncfSourceId ? { bncf_source_id: bncfSourceId } : {}),
          access_date: new Date(),
        },
        catalog_ids: {
          bsb: bsbId,
          ...(bncfSourceId ? { bncf: bncfSourceId } : {}),
        },
        status: 'draft',
        hidden: true,
        visible: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      await db.collection('books').insertOne(bookDoc);

      // Insert pages in batches of 500
      for (let start = 0; start < pages.length; start += 500) {
        const chunk = pages.slice(start, start + 500).map((p, j) => {
          const pageId = new ObjectId();
          return {
            _id: pageId,
            id: pageId.toHexString(),
            book_id: bookIdStr,
            page_number: start + j + 1,
            photo: p.photo,
            thumbnail: p.thumbnail,
            photo_original: p.photo,
            created_at: new Date(),
            updated_at: new Date(),
          };
        });
        await db.collection('pages').insertMany(chunk, { ordered: false });
      }

      totalPages += pages.length;
      imported++;
      log(`${prefix} OK ${pages.length}p [${elapsed}m] — "${title.substring(0, 60)}" → /book/${slug}`);
    } catch (err) {
      log(`${prefix} ERROR: ${err.message}`);
      errors++;
    }

    await new Promise(r => setTimeout(r, DELAY));
  }

  await client.close();

  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  log('');
  log('═══════════════════════════════════════════════');
  log('IMPORT SUMMARY');
  log('═══════════════════════════════════════════════');
  log(`Imported: ${imported}${DRY_RUN ? ' (dry run)' : ''}`);
  log(`Skipped (dupes/invalid): ${skipped}`);
  log(`Errors: ${errors}`);
  log(`Total pages: ${totalPages}`);
  log(`Elapsed: ${elapsed}m`);
}

main().catch(e => { console.error(e); process.exit(1); });
