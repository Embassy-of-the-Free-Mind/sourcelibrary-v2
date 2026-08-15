#!/usr/bin/env node
/**
 * SHWEP curator pass — direct DB import for early printed editions of
 * Shakespeare, Jonson, Marlowe + Bidez CMAG vol. VI. Triggered by SHWEP
 * episodes 216 (Merianos on East Roman Alchemy Pt II) and 217.
 *
 * Handles two source types from the same config file:
 *  - source: "ia"        — standalone Internet Archive item
 *  - source: "ia_bundle" — one volume inside a multi-volume IA bundle
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/shwep-curator-pass-import.mjs [--dry-run] [--limit=N]
 *
 * Books are imported as drafts (status: 'draft', hidden: true, visible: false)
 * so they don't surface in production search/listing until reviewed.
 */

import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;
const DELAY = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '2000');

const CONFIG_FILE = path.join(__dirname, 'shwep-curator-pass.json');
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function normalizeTitle(t) {
  return t?.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || '';
}
function normalizeAuthor(a) {
  return a?.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || '';
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

// ─── IA standalone item: page count + URL builders ─────────────────────────
async function iaGetPageCount(iaIdentifier) {
  try {
    const res = await fetch(
      `https://iiif.archive.org/iiif/${iaIdentifier}/manifest.json`,
      { signal: AbortSignal.timeout(20000) }
    );
    if (res.ok) {
      const m = await res.json();
      if (m.items?.length) return { count: m.items.length, source: 'iiif_v3' };
      if (m.sequences?.[0]?.canvases?.length) return { count: m.sequences[0].canvases.length, source: 'iiif_v2' };
    }
  } catch {}

  try {
    const res = await fetch(`https://archive.org/metadata/${iaIdentifier}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const meta = await res.json();
    const imagecount = meta.metadata?.imagecount;
    if (imagecount) return { count: parseInt(imagecount, 10), source: 'imagecount', metadata: meta.metadata };
    const jp2Count = (meta.files || []).filter(f => f.name?.endsWith('.jp2') && !f.name.includes('thumb')).length;
    if (jp2Count > 1) return { count: jp2Count, source: 'jp2_files', metadata: meta.metadata };
  } catch {}

  return null;
}

function iaPageUrls(iaIdentifier) {
  return {
    getPageUrl: (n) => `https://archive.org/download/${iaIdentifier}/page/n${n}/full/full/0/default.jpg`,
    getThumbUrl: (n) => `https://archive.org/download/${iaIdentifier}/page/n${n}/full/pct:15/0/default.jpg`,
  };
}

// ─── IA bundle: page URLs into a specific JP2 zip inside a bundle item ─────
function bundlePageUrls(bundleId, baseFilename) {
  const zipFn = `${baseFilename}_jp2.zip`;
  const zipBase = `${baseFilename}_jp2`;
  const url = (zeroIndex, pct) => {
    const padded = String(zeroIndex).padStart(4, '0');
    const pageFile = `${baseFilename}_${padded}.jp2`;
    const p = `${encodeURIComponent(bundleId)}%2F${encodeURIComponent(zipFn)}%2F${encodeURIComponent(zipBase)}%2F${encodeURIComponent(pageFile)}`;
    const size = pct ? `pct:${pct}` : 'max';
    return `https://iiif.archive.org/image/iiif/3/${p}/full/${size}/0/default.jpg`;
  };
  return {
    getPageUrl: (n) => url(n),
    getThumbUrl: (n) => url(n, 15),
  };
}

function stripHtml(s) { return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }

// ─── Build book doc + page docs ────────────────────────────────────────────
function buildBookDoc({ entry, pageCount, pageCountSource, thumbnail, slug, iaMetadata }) {
  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const isBundle = entry.source === 'ia_bundle';
  const iaIdentifier = isBundle ? null : entry.ia_identifier;
  const sourceUrl = isBundle
    ? `https://archive.org/details/${entry.bundle_id}`
    : `https://archive.org/details/${iaIdentifier}`;
  const fingerprint = isBundle
    ? `ia-bundle:${entry.bundle_id}/${entry.base_filename}`
    : `ia:${iaIdentifier}`;

  const dublin_core = {
    dc_identifier: isBundle
      ? [`IA-BUNDLE:${entry.bundle_id}/${entry.base_filename}`]
      : [`IA:${iaIdentifier}`],
    dc_source: sourceUrl,
    ...(entry.publisher ? { dc_publisher: entry.publisher } : {}),
  };

  const catalog_metadata = isBundle
    ? {
        source: 'internet_archive_bundle',
        bundle_id: entry.bundle_id,
        base_filename: entry.base_filename,
        publisher: entry.publisher || null,
        place: entry.place_published || null,
        scraped_at: new Date().toISOString(),
      }
    : iaMetadata
      ? {
          source: 'internet_archive',
          identifier: iaIdentifier,
          publisher: iaMetadata.publisher && typeof iaMetadata.publisher === 'string' ? stripHtml(iaMetadata.publisher) : null,
          place: iaMetadata.publishplace || iaMetadata.place || null,
          imagecount: iaMetadata.imagecount ? parseInt(iaMetadata.imagecount, 10) : null,
          public_date: iaMetadata.publicdate || null,
          scraped_at: new Date().toISOString(),
        }
      : { source: 'internet_archive', identifier: iaIdentifier, scraped_at: new Date().toISOString() };

  for (const k of Object.keys(catalog_metadata)) {
    if (catalog_metadata[k] == null) delete catalog_metadata[k];
  }

  return {
    bookId,
    bookIdStr,
    fingerprint,
    bookDoc: makeBookDoc({
      _id: bookId,
      id: bookIdStr,
      slug,
      title: entry.title,
      display_title: entry.display_title || null,
      author: entry.author,
      language: entry.language || 'Unknown',
      ...(entry.original_language ? { original_language: entry.original_language } : {}),
      published: entry.year ? String(entry.year) : 'Unknown',
      categories: entry.categories || [],
      ia_identifier: iaIdentifier,
      thumbnail,
      pages_count: pageCount,
      pages_ocr: 0,
      pages_translated: 0,
      pages_archived: 0,
      dublin_core,
      catalog_metadata,
      ...(entry.publisher ? { publisher: entry.publisher } : {}),
      ...(entry.place_published ? { place_published: entry.place_published } : {}),
      image_source: {
        provider: 'internet_archive',
        provider_name: 'Internet Archive',
        source_url: sourceUrl,
        identifier: iaIdentifier || entry.bundle_id,
        license: 'publicdomain',
        access_date: new Date(),
      },
      page_count_source: pageCountSource,
      processing_priority: 80,
      processing_priority_breakdown: { import_default: 'fresh import — promote for archive priority' },
      status: 'draft',
      hidden: true,
      visible: false,
      source_fingerprint: fingerprint,
      normalized_title: normalizeTitle(entry.title),
      normalized_author: normalizeAuthor(entry.author),
      created_at: new Date(),
      updated_at: new Date(),
    }),
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const entries = config.entries;
  console.log(`Loaded ${entries.length} entries from ${path.basename(CONFIG_FILE)}`);
  if (DRY_RUN) console.log('=== DRY RUN — no DB writes ===');

  const client = DRY_RUN ? null : new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  const db = DRY_RUN ? null : (await client.connect(), client.db('bookstore'));

  const results = [];
  let imported = 0, skipped = 0, errors = 0;

  for (let i = 0; i < entries.length && imported < LIMIT; i++) {
    const entry = entries[i];
    const idLabel = entry.source === 'ia_bundle'
      ? `${entry.bundle_id}/${entry.base_filename}`
      : entry.ia_identifier;
    const prefix = `[${i + 1}/${entries.length}] ${entry.year || '?'} ${idLabel}`;

    // Resolve page count + URL builders + thumbnail
    let pageCount, pageCountSource, getPageUrl, getThumbUrl, iaMetadata = null;
    if (entry.source === 'ia_bundle') {
      pageCount = entry.page_count;
      if (!pageCount) { console.log(`${prefix} ERROR: ia_bundle entry missing page_count`); errors++; continue; }
      pageCountSource = 'manual_bundle';
      ({ getPageUrl, getThumbUrl } = bundlePageUrls(entry.bundle_id, entry.base_filename));
    } else {
      // ia standalone
      const result = await iaGetPageCount(entry.ia_identifier);
      if (!result) {
        console.log(`${prefix} ERROR: no page count`);
        errors++;
        await sleep(DELAY);
        continue;
      }
      pageCount = result.count;
      pageCountSource = result.source;
      iaMetadata = result.metadata;
      ({ getPageUrl, getThumbUrl } = iaPageUrls(entry.ia_identifier));
    }

    // Verify first page URL responds (HEAD)
    const firstUrl = getPageUrl(0);
    try {
      const head = await fetch(firstUrl, { method: 'HEAD', signal: AbortSignal.timeout(15000), redirect: 'follow' });
      if (!head.ok) {
        console.log(`${prefix} ERROR: page 0 HEAD ${head.status} ${firstUrl}`);
        errors++;
        await sleep(DELAY);
        continue;
      }
    } catch (e) {
      console.log(`${prefix} ERROR: page 0 HEAD failed: ${e.message}`);
      errors++;
      await sleep(DELAY);
      continue;
    }

    if (DRY_RUN) {
      console.log(`${prefix} DRY-RUN OK ${pageCount}p (${pageCountSource}) — "${entry.title.substring(0, 60)}"`);
      results.push({ id: idLabel, title: entry.title, pageCount, pageCountSource, dryRun: true });
      imported++;
      await sleep(DELAY);
      continue;
    }

    // Dedup
    const fingerprint = entry.source === 'ia_bundle'
      ? `ia-bundle:${entry.bundle_id}/${entry.base_filename}`
      : `ia:${entry.ia_identifier}`;
    const existing = await db.collection('books').findOne(
      {
        $or: [
          { source_fingerprint: fingerprint },
          ...(entry.source === 'ia' ? [{ ia_identifier: entry.ia_identifier }] : []),
        ],
      },
      { projection: { _id: 1, title: 1 } }
    );
    if (existing) {
      console.log(`${prefix} SKIP (dupe of ${existing._id})`);
      skipped++;
      results.push({ id: idLabel, title: entry.title, skipped: true, existingId: existing._id.toString() });
      continue;
    }

    try {
      const slug = await generateUniqueSlug(db, entry.title, entry.author);
      const { bookId, bookIdStr, bookDoc } = buildBookDoc({
        entry,
        pageCount,
        pageCountSource,
        thumbnail: getThumbUrl(0),
        slug,
        iaMetadata,
      });

      await db.collection('books').insertOne(bookDoc);

      const CHUNK = 500;
      for (let start = 0; start < pageCount; start += CHUNK) {
        const pageDocs = [];
        for (let p = start; p < Math.min(start + CHUNK, pageCount); p++) {
          const pageId = new ObjectId();
          pageDocs.push(makePageDoc({
            _id: pageId,
            id: pageId.toHexString(),
            book_id: bookIdStr,
            page_number: p + 1,
            photo: getPageUrl(p),
            thumbnail: getThumbUrl(p),
            photo_original: getPageUrl(p),
            created_at: new Date(),
            updated_at: new Date(),
          }));
        }
        await db.collection('pages').insertMany(pageDocs, { ordered: false });
      }

      imported++;
      console.log(`${prefix} OK ${pageCount}p → ${bookIdStr} (${slug})`);
      results.push({ id: idLabel, title: entry.title, bookId: bookIdStr, slug, pageCount });
    } catch (err) {
      console.log(`${prefix} ERROR: ${err.message}`);
      errors++;
    }

    await sleep(DELAY);
  }

  if (client) await client.close();

  console.log(`\n=== DONE: ${imported} imported, ${skipped} skipped (dupe), ${errors} errors ===`);

  const outPath = path.join(__dirname, `shwep-curator-pass-results-${DRY_RUN ? 'dryrun-' : ''}${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ imported, skipped, errors, results }, null, 2));
  console.log(`Results written to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
