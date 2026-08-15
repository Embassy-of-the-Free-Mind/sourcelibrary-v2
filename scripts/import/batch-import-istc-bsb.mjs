#!/usr/bin/env node
/**
 * Batch import in-scope ISTC incunabula with BSB digital copies.
 * Direct MongoDB import (no API auth needed). Replicates /api/import/iiif logic.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import/batch-import-istc-bsb.mjs
 *
 * Options:
 *   --dry-run        Preview without importing
 *   --limit=N        Max records to import
 *   --delay=N        Delay between imports in ms (default: 1500)
 *   --start-from=ID  Resume from a specific ISTC source_id
 */

import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;
const DELAY = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '1500');
const START_FROM = args.find(a => a.startsWith('--start-from='))?.split('=')[1] || null;

// ── Helpers ─────────────────────────────────────────────────────────

function extractBsbId(url) {
  if (!url) return null;
  const match = url.match(/(bsb\d{5,})/);
  return match ? match[1] : null;
}

function buildManifestUrl(bsbId) {
  return `https://api.digitale-sammlungen.de/iiif/presentation/v2/${bsbId}/manifest`;
}

function slugify(text, maxLen = 60) {
  if (!text) return 'untitled';
  return text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
  while (await db.collection('books').findOne({ slug: candidate })) {
    candidate = `${slug}-${counter}`;
    counter++;
  }
  return candidate;
}

const LANG_MAP = {
  Latin: 'Latin', English: 'English', German: 'German', Dutch: 'Dutch',
  French: 'French', Italian: 'Italian', Spanish: 'Spanish', Greek: 'Greek',
  Hebrew: 'Hebrew', 'Ancient Greek': 'Greek', Portuguese: 'Portuguese',
  Catalan: 'Catalan', Czech: 'Czech', frm: 'French',
};

function mapLanguage(lang) { return LANG_MAP[lang] || lang || 'Latin'; }

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
        console.log(`  Rate limited, waiting 10s...`);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      if (i === retries - 1) return null;
    } catch (e) {
      if (i === retries - 1) { console.log(`  Fetch error: ${e.message}`); return null; }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  return null;
}

// ── IIIF v2 page extraction ─────────────────────────────────────────

function extractPages(manifest) {
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

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('ISTC-BSB BATCH IMPORT (direct MongoDB)');
  console.log('═══════════════════════════════════════════════');
  console.log(`Dry run: ${DRY_RUN}, Limit: ${LIMIT === Infinity ? 'none' : LIMIT}, Delay: ${DELAY}ms\n`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find candidates
  const query = {
    source: 'istc',
    in_scope: true,
    has_digital: true,
    status: { $ne: 'imported' }, // Skip already imported
    $or: [
      { viewer_url: { $regex: /digitale-sammlungen|nbn:de:bvb/ } },
      { 'digital_copies.url': { $regex: /digitale-sammlungen|nbn:de:bvb/ } },
    ],
  };
  if (START_FROM) query.source_id = { $gte: START_FROM };

  const candidates = await db.collection('import_candidates')
    .find(query).sort({ source_id: 1 }).toArray();

  console.log(`Found ${candidates.length} BSB incunabula to import\n`);

  let imported = 0, skipped = 0, errors = 0, dupes = 0, manifestFails = 0;

  for (const record of candidates) {
    if (imported >= LIMIT) break;

    // Extract BSB ID
    const allUrls = [record.viewer_url, ...(record.digital_copies || []).map(dc => dc.url)].filter(Boolean);
    let bsbId = null;
    for (const url of allUrls) { bsbId = extractBsbId(url); if (bsbId) break; }
    if (!bsbId) { skipped++; continue; }

    const manifestUrl = buildManifestUrl(bsbId);
    const title = record.title || 'Unknown';
    const author = record.author || 'Unknown';
    const language = mapLanguage(record.language);
    const year = record.date_earliest ? String(record.date_earliest) : null;

    if (DRY_RUN) {
      if (imported < 20) console.log(`  [${imported + 1}] ${record.source_id} — ${author.substring(0, 25)}: ${title.substring(0, 55)}`);
      imported++;
      continue;
    }

    // Check for existing book with same manifest
    const existing = await db.collection('books').findOne({ 'image_source.iiif_manifest': manifestUrl });
    if (existing) {
      dupes++;
      await db.collection('import_candidates').updateOne(
        { _id: record._id },
        { $set: { status: 'duplicate', duplicate_of: existing.id || existing._id.toString() } }
      );
      if (dupes <= 5) console.log(`  DUPE ${record.source_id} — already exists`);
      continue;
    }

    // Fetch manifest
    const manifest = await fetchWithRetry(manifestUrl);
    if (!manifest) {
      manifestFails++;
      if (manifestFails <= 10) console.log(`  FAIL ${record.source_id} — manifest fetch failed: ${manifestUrl}`);
      continue;
    }

    const pages = extractPages(manifest);
    if (pages.length === 0) {
      errors++;
      if (errors <= 5) console.log(`  ERR ${record.source_id} — no pages in manifest`);
      continue;
    }

    // Create book
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const slug = await ensureUniqueSlug(db, generateSlug(title, author));

    const bookDoc = makeBookDoc({
      _id: bookId,
      id: bookIdStr,
      slug,
      title,
      author,
      language,
      published: year || 'Unknown',
      categories: [],
      thumbnail: pages[0]?.thumbnail || '',
      pages_count: pages.length,
      pages_ocr: 0,
      pages_translated: 0,
      image_source: {
        provider: 'bsb',
        provider_name: 'Bayerische Staatsbibliothek',
        source_url: `https://www.digitale-sammlungen.de/en/view/${bsbId}`,
        iiif_manifest: manifestUrl,
        license: 'CC-BY-NC-4.0',
        license_url: 'https://creativecommons.org/licenses/by-nc/4.0/',
        contributing_library: 'Bayerische Staatsbibliothek, Munich',
        shelfmark: bsbId,
        access_date: new Date(),
      },
      catalog_ids: {
        istc: record.source_id,
        gw: record.catalog_ids?.gw || null,
        bsb: bsbId,
      },
      status: 'draft',
      hidden: true,
      visible: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await db.collection('books').insertOne(bookDoc);

    // Create pages
    const pageDocs = pages.map((p, i) => {
      const pageId = new ObjectId();
      return makePageDoc({
        _id: pageId,
        id: pageId.toHexString(),
        book_id: bookIdStr,
        page_number: i + 1,
        photo: p.photo,
        thumbnail: p.thumbnail,
        photo_original: p.photo,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    // Insert pages in batches of 500
    for (let i = 0; i < pageDocs.length; i += 500) {
      await db.collection('pages').insertMany(pageDocs.slice(i, i + 500));
    }

    // Mark candidate as imported
    await db.collection('import_candidates').updateOne(
      { _id: record._id },
      { $set: { status: 'imported', imported_at: new Date(), book_id: bookIdStr } }
    );

    imported++;
    if (imported <= 20 || imported % 50 === 0) {
      console.log(`  [${imported}] ${record.source_id} — ${title.substring(0, 55)} (${pages.length} pages)`);
    }

    // Polite delay for BSB manifest server
    if (DELAY > 0) await new Promise(r => setTimeout(r, DELAY));
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('IMPORT SUMMARY');
  console.log('═══════════════════════════════════════════════');
  console.log(`Imported: ${imported}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`Duplicates: ${dupes}`);
  console.log(`Manifest fails: ${manifestFails}`);
  console.log(`Skipped (no BSB ID): ${skipped}`);
  console.log(`Errors: ${errors}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
