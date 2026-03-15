#!/usr/bin/env node
/**
 * Batch Import — import discovered candidates into the books collection.
 *
 * Reads from `import_candidates` (status: 'discovered'), dedup-checks
 * against existing books, fetches IIIF manifests, and imports via the
 * same path as /api/import/iiif.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/import-batch.mjs
 *
 * Options:
 *   --source=erara         Only import from a specific source
 *   --limit=500            Max candidates per run (default: 500)
 *   --delay=2000           Delay between imports in ms (default: 2000)
 *   --dry-run              Just show what would be imported
 *   --min-year=1400        Filter by earliest date
 *   --max-year=1800        Filter by latest date
 *   --min-pages=5          Skip books with fewer pages
 *   --language=Latin,Greek  Only import specific languages (comma-separated)
 */

import { MongoClient } from 'mongodb';

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const SOURCE = args.source || null;
const LIMIT = parseInt(args.limit) || 500;
const DELAY = parseInt(args.delay) || 2000;
const DRY_RUN = 'dry-run' in args;
const MIN_YEAR = parseInt(args['min-year']) || null;
const MAX_YEAR = parseInt(args['max-year']) || 1800;
const MIN_PAGES = parseInt(args['min-pages']) || 5;
const LANGUAGES = args.language ? args.language.split(',').map(l => l.trim()) : null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const API_URL = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';
const AUTH_TOKEN = process.env.CRON_SECRET;

if (!AUTH_TOKEN) {
  console.error('CRON_SECRET not set. Source .env.production.local first.');
  process.exit(1);
}

// ── MongoDB with auto-reconnect ──────────────────────────────────────────

let client = null;
let db = null;

async function getDb() {
  if (client && db) {
    try {
      // Quick ping to check connection
      await db.command({ ping: 1 });
      return db;
    } catch {
      console.log('[DB] Connection lost, reconnecting...');
      try { await client.close(); } catch {}
      client = null;
      db = null;
    }
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

  client = new MongoClient(uri, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 30000,
  });
  await client.connect();
  db = client.db('bookstore');
  console.log('[DB] Connected');
  return db;
}

async function safeUpdateCandidate(manifestUrl, status, extra = {}) {
  try {
    const d = await getDb();
    await d.collection('import_candidates').updateOne(
      { manifest_url: manifestUrl },
      { $set: { status, ...extra, ...(status === 'imported' ? { imported_at: new Date() } : {}) } }
    );
  } catch (err) {
    console.warn(`[DB] Status update failed (non-fatal): ${err.message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

console.log(`\nIIIF Batch Import`);
console.log(`  Source: ${SOURCE || 'all'}`);
console.log(`  Limit: ${LIMIT}`);
console.log(`  Date range: ${MIN_YEAR || 'any'} - ${MAX_YEAR || 'any'}`);
console.log(`  Languages: ${LANGUAGES ? LANGUAGES.join(', ') : 'all'}`);
console.log(`  Min pages: ${MIN_PAGES}`);
console.log(`  Dry run: ${DRY_RUN}`);
console.log('');

// Load candidates into memory upfront
const d = await getDb();
const filter = { status: 'discovered' };
if (SOURCE) filter.source = SOURCE;
if (LANGUAGES?.length) filter.language = { $in: LANGUAGES };
if (MAX_YEAR) {
  filter.$or = [
    { date_earliest: { $lte: MAX_YEAR } },
    { date_earliest: null },
  ];
}
if (MIN_YEAR) filter.date_earliest = { ...(filter.date_earliest || {}), $gte: MIN_YEAR };

const candidates = await d.collection('import_candidates')
  .find(filter)
  .sort({ date_earliest: 1 })
  .limit(LIMIT)
  .toArray();

console.log(`Found ${candidates.length} candidates to process.\n`);

// Load existing book title/author for local dedup (avoids API round-trips)
const existingBooks = await d.collection('books')
  .find({ hidden: { $ne: true }, normalized_title: { $exists: true } },
    { projection: { normalized_title: 1, normalized_author: 1, id: 1 } })
  .toArray();
const titleAuthorSet = new Set(existingBooks.map(b => `${b.normalized_title}|||${b.normalized_author}`));
console.log(`Loaded ${existingBooks.length} existing books for dedup.\n`);

let imported = 0, skipped = 0, failed = 0;

for (const candidate of candidates) {
  const { manifest_url, title, author, source, page_count } = candidate;

  // Skip books with too few pages (if known)
  if (page_count && page_count < MIN_PAGES) {
    await safeUpdateCandidate(manifest_url, 'skipped', { skip_reason: `Too few pages: ${page_count}` });
    skipped++;
    continue;
  }

  // Local dedup check (fast, no API call)
  const normTitle = normalizeForDedup(title);
  const normAuthor = normalizeForDedup(author);
  if (normTitle.length >= 5 && titleAuthorSet.has(`${normTitle}|||${normAuthor}`)) {
    await safeUpdateCandidate(manifest_url, 'skipped', { skip_reason: 'Title/author match (local dedup)' });
    skipped++;
    continue;
  }

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would import: ${title} (${author}) — ${source}`);
    imported++;
    continue;
  }

  // Mark as importing
  await safeUpdateCandidate(manifest_url, 'importing');

  try {
    // Fetch IIIF manifest
    const manifestRes = await fetch(manifest_url, {
      headers: {
        'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
        'Accept': 'application/json, application/ld+json',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!manifestRes.ok) {
      throw new Error(`Manifest fetch failed: ${manifestRes.status}`);
    }

    const manifest = await manifestRes.json();

    // Extract canvases
    const canvases = manifest.items || manifest.sequences?.[0]?.canvases || [];
    if (canvases.length < MIN_PAGES) {
      await safeUpdateCandidate(manifest_url, 'skipped', { skip_reason: `Too few canvases: ${canvases.length}` });
      skipped++;
      continue;
    }

    // Import via API
    const importRes = await fetch(`${API_URL}/api/import/iiif`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        manifest_url,
        manifest_data: manifest,
        title: candidate.title,
        display_title: candidate.display_title,
        author: candidate.author,
        language: candidate.language,
        published: candidate.date_text || 'Unknown',
        categories: candidate.categories,
        provider: candidate.provider_name,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const result = await importRes.json();

    if (importRes.ok && result.success) {
      await safeUpdateCandidate(manifest_url, 'imported', { book_id: result.bookId });
      // Add to local dedup set so we don't reimport in same run
      if (normTitle.length >= 5) titleAuthorSet.add(`${normTitle}|||${normAuthor}`);
      imported++;
      console.log(`[${imported}/${candidates.length}] ✓ ${title} — ${result.pagesCreated} pages`);
    } else if (importRes.status === 409) {
      await safeUpdateCandidate(manifest_url, 'skipped', { skip_reason: result.error, book_id: result.existingId });
      skipped++;
    } else {
      throw new Error(result.error || `Import failed: ${importRes.status}`);
    }

  } catch (err) {
    await safeUpdateCandidate(manifest_url, 'failed', { skip_reason: err.message });
    failed++;
    console.error(`[FAIL] ${title}: ${err.message}`);
  }

  // Rate limit
  await sleep(DELAY);

  // Progress summary every 100 books
  if ((imported + skipped + failed) % 100 === 0 && imported + skipped + failed > 0) {
    console.log(`--- Progress: ${imported} imported, ${skipped} skipped, ${failed} failed ---`);
  }
}

console.log(`\n=== Import Complete ===`);
console.log(`Imported: ${imported} | Skipped: ${skipped} | Failed: ${failed}`);

// Cleanup
try { await client?.close(); } catch {}

// Simplified dedup normalization (matches dedup.ts logic)
function normalizeForDedup(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|la|gli|i|el|los|las)\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
