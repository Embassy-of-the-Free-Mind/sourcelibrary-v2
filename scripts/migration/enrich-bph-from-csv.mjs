#!/usr/bin/env node
/**
 * ⚠️ DEPRECATED — kept for historical reference only.
 *
 * Superseded by scripts/migration/bph-memorix-final-sync.mjs (PR #1975,
 * applied 2026-05-25). The CSV "ScannedBooks" path used to enrich BPH
 * books pre-#1881; Memorix is no longer the upstream and the canonical
 * enrichment flow is now Step 2 of bph-memorix-final-sync (memorix_raw
 * JSONB + promoted columns from the XML export).
 *
 * Mongo-side fields written by this script (image_source.source_id,
 * dublin_core.dc_identifier) remain in production data, but no new
 * enrichment should be applied this way.
 *
 * Provenance / decision log: .claude/handoffs/2026-05-25-bph-memorix-sync-apply.md
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * (Original docstring follows.)
 *
 * Enrich BPH books with Vitec Memorix catalog metadata from ScannedBooks.csv.
 *
 * Two matching strategies:
 * 1. RIT match: image_source.source_id → CSV "Picturae barcode" (new imports)
 * 2. UBN match: dublin_core.dc_identifier → CSV "UBN" (old BPH books)
 *
 * Adds: UBN link, language, keywords, shelf_mark, provenance, binding,
 *        object_size, bound_with, bibliography, remarks, acquisition info.
 * All fields get field_provenance entries.
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/enrich-bph-from-csv.mjs --csv scripts/data/bph-scanned-books.csv
 *   node scripts/migration/enrich-bph-from-csv.mjs --csv scripts/data/bph-scanned-books.csv --dry-run
 *
 * See: https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/457
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { parseArgs } from 'util';
import { normalizeStateShelfMark } from '../lib/bph-state-shelfmark.mjs';

const { values: args } = parseArgs({
  options: {
    'csv': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!args['csv']) {
  console.error('Usage: node enrich-bph-from-csv.mjs --csv /path/to/ScannedBooks.csv [--dry-run]');
  process.exit(1);
}

const DRY_RUN = args['dry-run'];

// --- CSV parser (handles quoted fields) ---
function parseCSVLine(line) {
  const fields = [];
  let current = '', inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { fields.push(current); current = ''; }
    else current += c;
  }
  fields.push(current);
  return fields;
}

// --- Load CSV and build lookup maps ---
function loadCSV(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const headers = parseCSVLine(lines[0]);

  const idx = (name) => headers.findIndex(h => h === name || h.includes(name));
  const cols = {
    rit: idx('Picturae barcode'),
    ubn: idx('UBN'),
    title: idx('Title'),
    author: idx('Author'),
    language: idx('Language'),
    keywords: idx('Keywords'),
    shelfMark: idx('Shelf mark'),
    provenance: idx('Provenance'),
    binding: idx('Binding'),
    objectSize: idx('Object size'),
    boundWith: idx('Bound with'),
    bibliography: idx('Bibliography'),
    remarks: idx('Remarks'),
    internalRemarks: idx('Internal remarks'),
    status: idx('Status'),
    stateShelfMark: idx('BPH State Collection shelf mark'),
    acquisitionDate: idx('Acquisition date'),
    acquisitionSource: idx('Acquisition source'),
    price: idx('Price'),
    place: idx('Place of publication'),
    printer: idx('Printer'),
    publisher: idx('Publisher'),
    year: idx('Year of publication'),
  };

  const byRit = new Map();
  const byUbn = new Map();

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = parseCSVLine(lines[i]);
    const rit = c[cols.rit]?.trim();
    const ubn = c[cols.ubn]?.replace(/\.0$/, '')?.trim();

    const record = {
      rit,
      ubn,
      title: c[cols.title] || null,
      author: c[cols.author] || null,
      language: c[cols.language] || null,
      keywords: c[cols.keywords] || null,
      shelf_mark: c[cols.shelfMark] || null,
      provenance: c[cols.provenance] || null,
      binding: c[cols.binding] || null,
      object_size: c[cols.objectSize] || null,
      bound_with: c[cols.boundWith] || null,
      bibliography: c[cols.bibliography] || null,
      remarks: c[cols.remarks] || null,
      internal_remarks: c[cols.internalRemarks] || null,
      status: c[cols.status] || null,
      // "neen" (Dutch "no") is an answer, not a shelf mark — normalise at the
      // write boundary so a re-import can't undo the one-off sweep.
      state_shelf_mark: normalizeStateShelfMark(c[cols.stateShelfMark]),
      acquisition_date: c[cols.acquisitionDate] || null,
      acquisition_source: c[cols.acquisitionSource] || null,
      price: c[cols.price] || null,
      place: c[cols.place] || null,
      printer: c[cols.printer] || null,
      publisher: c[cols.publisher] || null,
      year: c[cols.year] || null,
    };

    if (rit) byRit.set(rit, record);
    if (ubn) byUbn.set(ubn, record);
  }

  return { byRit, byUbn };
}

const LANG_MAP = {
  'Latin': 'la', 'German': 'de', 'French': 'fr', 'Dutch': 'nl',
  'English': 'en', 'Italian': 'it', 'Spanish': 'es', 'Greek': 'el',
  'Hebrew': 'he', 'Arabic': 'ar', 'Swedish': 'sv', 'Danish': 'da',
  'Portuguese': 'pt', 'Polish': 'pl', 'Czech': 'cs', 'Hungarian': 'hu',
  'Russian': 'ru', 'Turkish': 'tr',
};

function buildUpdates(book, csvData) {
  const updates = {};
  const provEntry = {
    source: 'bph-scanned-books-csv',
    provider: 'vitec-memorix',
    method: 'csv-enrichment',
    confidence: 1.0,
    date: new Date().toISOString(),
  };

  // UBN link
  if (csvData.ubn && book.dublin_core?.dc_identifier !== csvData.ubn) {
    updates['dublin_core.dc_identifier'] = csvData.ubn;
    updates['dublin_core.dc_source'] = `BPH Catalogue (UBN: ${csvData.ubn})`;
    updates['field_provenance.dublin_core.dc_identifier'] = provEntry;
  }

  // Language (only if book doesn't have one or has auto-detect)
  if (csvData.language && (!book.language || book.language === 'auto-detect')) {
    updates.language = LANG_MAP[csvData.language] || csvData.language.toLowerCase();
    updates['field_provenance.language'] = provEntry;
  }

  // Catalog metadata — only set if not already present
  const metaFields = [
    ['keywords_csv', csvData.keywords],
    ['shelf_mark', csvData.shelf_mark],
    ['provenance', csvData.provenance],
    ['binding', csvData.binding],
    ['object_size', csvData.object_size],
    ['bound_with', csvData.bound_with],
    ['bibliography', csvData.bibliography],
    ['remarks', csvData.remarks],
    ['state_shelf_mark', csvData.state_shelf_mark],
    ['acquisition_date', csvData.acquisition_date],
    ['acquisition_source', csvData.acquisition_source],
  ];

  for (const [field, value] of metaFields) {
    if (value && !book.metadata?.[field]) {
      updates[`metadata.${field}`] = value;
      updates[`field_provenance.metadata.${field}`] = provEntry;
    }
  }

  return updates;
}

async function main() {
  console.log(`BPH Vitec Memorix Enrichment (${DRY_RUN ? 'DRY RUN' : 'LIVE'})`);

  const { byRit, byUbn } = loadCSV(args['csv']);
  console.log(`CSV loaded: ${byRit.size} RIT mappings, ${byUbn.size} UBN mappings`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Get all BPH books
  const books = await db.collection('books').find({
    'image_source.provider': 'bph',
  }).project({
    id: 1, title: 1, language: 1,
    'image_source.source_id': 1,
    'dublin_core': 1,
    'metadata': 1,
  }).toArray();

  console.log(`Found ${books.length} BPH books total`);

  let enriched = 0, noMatch = 0, noNewFields = 0;
  const matchedBy = { rit: 0, ubn: 0 };

  for (const book of books) {
    // Try RIT match first, then UBN
    const rit = book.image_source?.source_id;
    const ubn = book.dublin_core?.dc_identifier;

    let csvData = null;
    let matchType = null;

    if (rit && byRit.has(rit)) {
      csvData = byRit.get(rit);
      matchType = 'rit';
    } else if (ubn && byUbn.has(ubn)) {
      csvData = byUbn.get(ubn);
      matchType = 'ubn';
    }

    if (!csvData) {
      noMatch++;
      continue;
    }

    const updates = buildUpdates(book, csvData);

    if (Object.keys(updates).length === 0) {
      noNewFields++;
      continue;
    }

    if (DRY_RUN) {
      if (enriched < 5) {
        const fields = Object.keys(updates).filter(k => !k.startsWith('field_provenance'));
        console.log(`  [${matchType}] ${(book.title || '').substring(0, 55)} → ${fields.join(', ')}`);
      }
    } else {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { ...updates, updated_at: new Date() } }
      );
    }

    matchedBy[matchType]++;
    enriched++;
  }

  console.log(`\nResults:`);
  console.log(`  Enriched: ${enriched} (by RIT: ${matchedBy.rit}, by UBN: ${matchedBy.ubn})`);
  console.log(`  No match in CSV: ${noMatch}`);
  console.log(`  Matched but no new fields: ${noNewFields}`);

  await client.close();
  process.exit();
}

main().catch(err => { console.error(err); process.exit(1); });
