#!/usr/bin/env node
/**
 * Enrich BPH imported books with UBN + catalog metadata from ScannedBooks.csv.
 *
 * Links RIT (Picturae barcode) → UBN (BPH catalog number), then adds:
 * - dublin_core.dc_identifier = UBN
 * - dublin_core.dc_source = "BPH Catalogue (UBN: XXXX)"
 * - language (from CSV, not null like the manifest)
 * - keywords, shelf_mark, provenance, binding, object_size
 * - field_provenance on all enriched fields
 *
 * Run on Hetzner:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/enrich-bph-from-csv.mjs --csv /tmp/bph-scanned-books.csv
 *   node scripts/migration/enrich-bph-from-csv.mjs --csv /tmp/bph-scanned-books.csv --dry-run
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { parseArgs } from 'util';

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

// --- Load CSV and build RIT→metadata map ---
function loadCSV(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const headers = parseCSVLine(lines[0]);

  const idx = (name) => headers.findIndex(h => h === name || h.includes(name));
  const cols = {
    rit: idx('Picturae barcode'),
    ubn: idx('UBN'),
    title: idx('Title'),
    language: idx('Language'),
    keywords: idx('Keywords'),
    shelfMark: idx('Shelf mark'),
    provenance: idx('Provenance'),
    binding: idx('Binding'),
    objectSize: idx('Object size'),
    boundWith: idx('Bound with'),
    bibliography: idx('Bibliography'),
    remarks: idx('Remarks'),
    status: idx('Status'),
  };

  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = parseCSVLine(lines[i]);
    const rit = c[cols.rit];
    if (!rit) continue;

    map.set(rit, {
      ubn: c[cols.ubn]?.replace(/\.0$/, ''), // Strip Excel-style ".0" suffix
      title: c[cols.title],
      language: c[cols.language] || null,
      keywords: c[cols.keywords] || null,
      shelf_mark: c[cols.shelfMark] || null,
      provenance: c[cols.provenance] || null,
      binding: c[cols.binding] || null,
      object_size: c[cols.objectSize] || null,
      bound_with: c[cols.boundWith] || null,
      bibliography: c[cols.bibliography] || null,
      remarks: c[cols.remarks] || null,
      status: c[cols.status] || null,
    });
  }

  return map;
}

async function main() {
  console.log(`BPH CSV Enrichment (${DRY_RUN ? 'DRY RUN' : 'LIVE'})`);

  const csvMap = loadCSV(args['csv']);
  console.log(`CSV loaded: ${csvMap.size} RIT→UBN mappings`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find all BPH books from the migration (have RIT source_id)
  const books = await db.collection('books').find({
    'image_source.provider': 'bph',
    'image_source.source_id': { $regex: /^RIT/ },
  }).project({
    id: 1,
    title: 1,
    language: 1,
    'image_source.source_id': 1,
    'dublin_core.dc_identifier': 1,
  }).toArray();

  console.log(`Found ${books.length} BPH books with RIT source_id`);

  const provEntry = {
    source: 'bph-scanned-books-csv',
    provider: 'vitec-memorix',
    method: 'csv-enrichment',
    confidence: 1.0,
    date: new Date().toISOString(),
  };

  let enriched = 0, noMapping = 0, alreadyDone = 0;

  for (const book of books) {
    const rit = book.image_source.source_id;
    const csvData = csvMap.get(rit);

    if (!csvData) {
      noMapping++;
      continue;
    }

    // Skip if already has UBN linked
    if (book.dublin_core?.dc_identifier === csvData.ubn) {
      alreadyDone++;
      continue;
    }

    const updates = {
      'dublin_core.dc_identifier': csvData.ubn,
      'dublin_core.dc_source': `BPH Catalogue (UBN: ${csvData.ubn})`,
    };

    const provUpdates = {};

    // Add language if CSV has it and book doesn't (manifest had null for 914/1057)
    if (csvData.language && (!book.language || book.language === 'auto-detect')) {
      // Normalize language names
      const langMap = {
        'Latin': 'la', 'German': 'de', 'French': 'fr', 'Dutch': 'nl',
        'English': 'en', 'Italian': 'it', 'Spanish': 'es', 'Greek': 'el',
        'Hebrew': 'he', 'Arabic': 'ar', 'Swedish': 'sv', 'Danish': 'da',
        'Portuguese': 'pt', 'Polish': 'pl', 'Czech': 'cs', 'Hungarian': 'hu',
      };
      // CSV might have full language names or codes
      updates.language = langMap[csvData.language] || csvData.language.toLowerCase();
      provUpdates['field_provenance.language'] = provEntry;
    }

    // Add rich metadata from CSV
    if (csvData.keywords) {
      updates['metadata.keywords_csv'] = csvData.keywords;
      provUpdates['field_provenance.metadata.keywords_csv'] = provEntry;
    }
    if (csvData.shelf_mark) {
      updates['metadata.shelf_mark'] = csvData.shelf_mark;
      provUpdates['field_provenance.metadata.shelf_mark'] = provEntry;
    }
    if (csvData.provenance) {
      updates['metadata.provenance'] = csvData.provenance;
      provUpdates['field_provenance.metadata.provenance'] = provEntry;
    }
    if (csvData.binding) {
      updates['metadata.binding'] = csvData.binding;
      provUpdates['field_provenance.metadata.binding'] = provEntry;
    }
    if (csvData.object_size) {
      updates['metadata.object_size'] = csvData.object_size;
    }
    if (csvData.bound_with) {
      updates['metadata.bound_with'] = csvData.bound_with;
    }
    if (csvData.bibliography) {
      updates['metadata.bibliography'] = csvData.bibliography;
    }

    // Provenance for the UBN link itself
    provUpdates['field_provenance.dublin_core.dc_identifier'] = provEntry;

    if (DRY_RUN) {
      if (enriched < 3) {
        console.log(`  ${rit} → UBN ${csvData.ubn} | lang: ${csvData.language} | ${book.title?.substring(0, 50)}`);
      }
    } else {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { ...updates, ...provUpdates, updated_at: new Date() } }
      );
    }
    enriched++;
  }

  console.log(`\nResults:`);
  console.log(`  Enriched: ${enriched}`);
  console.log(`  No CSV mapping: ${noMapping}`);
  console.log(`  Already done: ${alreadyDone}`);

  await client.close();
  process.exit();
}

main().catch(err => { console.error(err); process.exit(1); });
