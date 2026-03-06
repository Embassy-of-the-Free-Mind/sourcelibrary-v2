#!/usr/bin/env node
/**
 * Import translation catalogs into MongoDB for first-translation verification.
 *
 * Imports ~12-15k records from scholarly CSV catalogs into a unified
 * `translation_catalogs` collection with text indexes for fast lookup.
 *
 * Idempotent: drops and reimports on each run.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/import-translation-catalogs.mjs
 *   node scripts/enrichment/import-translation-catalogs.mjs --dry-run
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ── Config ──────────────────────────────────────────────────────────
const CSV_DIR = '/Users/dereklomas/secondrenaissance/scripts';

// Each catalog with its CSV-specific column mapping
const CATALOGS = [
  {
    file: 'latin_translations_master.csv',
    source: 'unesco_master',
    map: { author: 'author', english_title: 'english_title', original_title: 'original_title', translator: 'translator', pub_year: 'pub_year', publisher: 'publisher', series: 'series', canonical_author: 'canonical_author', canonical_work: 'canonical_work' },
  },
  {
    file: 'loeb_classical_library_full.csv',
    source: 'loeb',
    map: { author: 'author', english_title: 'english_title', translator: 'translator', pub_year: 'pub_year', publisher: 'publisher', series: 'series' },
  },
  {
    file: 'brill_latin_translations.csv',
    source: 'brill',
    map: { author: 'author', english_title: 'title', translator: 'translator', pub_year: 'year', publisher: 'publisher', series: 'series' },
  },
  {
    file: 'godwin_latin_translations.csv',
    source: 'godwin',
    map: { author: 'author', english_title: 'english_title', translator: 'translator', pub_year: 'pub_year', publisher: 'publisher', series: 'series' },
  },
  {
    file: 'cua_paulist_latin_translations_2000_2025.csv',
    source: 'cua_paulist',
    map: { author: 'author', english_title: 'title', translator: 'translator', pub_year: 'year', publisher: 'publisher', series: 'series' },
  },
  {
    file: 'hathitrust_latin_pre1979.csv',
    source: 'hathitrust',
    map: { author: 'creator', english_title: 'title', translator: 'translator', pub_year: 'pub_year', publisher: 'publisher' },
  },
  {
    file: 'penguin_classics_latin_translations.csv',
    source: 'penguin',
    map: { author: 'author', english_title: 'title', translator: 'translator', pub_year: 'year', publisher: 'publisher', series: 'series' },
  },
  {
    file: 'routledge_degruyter_latin_translations.csv',
    source: 'routledge_degruyter',
    map: { author: 'author', english_title: 'title', translator: 'translator', pub_year: 'year', publisher: 'publisher', series: 'series' },
  },
  {
    file: 'cup_latin_translations.csv',
    source: 'cambridge',
    map: { author: 'author', english_title: 'title', translator: 'translator_editor', pub_year: 'year', publisher: 'publisher', series: 'series' },
  },
  {
    file: 'broadview_norton_hackett_latin.csv',
    source: 'broadview_norton_hackett',
    map: { author: 'author', english_title: 'title', translator: 'translator', pub_year: 'year', publisher: 'publisher', series: 'series' },
  },
  {
    file: 'chicago_indiana_latin.csv',
    source: 'chicago_indiana',
    map: { author: 'author', english_title: 'title', translator: 'translator', pub_year: 'year', publisher: 'publisher', series: 'series' },
  },
  {
    file: 'openlibrary_latin_pre1979.csv',
    source: 'openlibrary',
    map: { author: 'author', english_title: 'english_title', translator: 'translator', pub_year: 'pub_year', publisher: 'publisher' },
  },
];

// ── Env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
            v = v.slice(1, -1);
          env[m[1].trim()] = v;
        }
      }
      break;
    } catch {}
  }
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';
const DRY_RUN = process.argv.includes('--dry-run');

// ── CSV Parsing ─────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split('\n');
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const record = {};
    headers.forEach((h, idx) => {
      record[h.trim()] = (values[idx] || '').trim();
    });
    records.push(record);
  }
  return records;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Normalization ───────────────────────────────────────────────────
function normalize(s) {
  if (!s) return '';
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function extractSurname(author) {
  if (!author) return '';
  // Remove parentheticals and dates
  let clean = author.replace(/\([^)]*\)/g, '').replace(/\d{3,4}/g, '').trim();
  // Handle "Last, First" format
  if (clean.includes(',')) {
    clean = clean.split(',')[0].trim();
  }
  // Remove common prefixes/suffixes
  clean = clean.replace(/\b(saint|st|bishop|pope|emperor|king)\b/gi, '').trim();
  const words = clean.split(/\s+/).filter(w => w.length > 1);
  return normalize(words[words.length - 1] || clean);
}

// ── Completeness Classification ─────────────────────────────────────
const PARTIAL_RE = [
  /\bselect(ed|ions)\b/i, /\bexcerpt/i, /\bextract/i, /\babridg/i,
  /\bbook [ivxlc0-9]+\b/i, /\bvol(\.|ume)?\s/i,
  /\bpart [ivxlc0-9]+\b/i, /\bchapter/i, /\bpassages\b/i,
  /\bantho/i, /\breader\b/i, /\bsampler\b/i,
];
const COMPLETE_RE = [
  /\bcomplete\b/i, /\bentire\b/i, /\bwhole\b/i, /\bfull\b/i,
  /\bcollected works\b/i, /\bopera omnia\b/i,
];

function classifyCompleteness(title) {
  if (!title) return 'unknown';
  if (PARTIAL_RE.some(re => re.test(title))) return 'partial';
  if (COMPLETE_RE.some(re => re.test(title))) return 'complete';
  return 'unknown';
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI not found. Source .env.production.local first.');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);

  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  console.log(`CSV directory: ${CSV_DIR}\n`);

  let totalRecords = 0;
  const allDocs = [];

  for (const catalog of CATALOGS) {
    const path = `${CSV_DIR}/${catalog.file}`;
    if (!fs.existsSync(path)) {
      console.log(`  SKIP ${catalog.file} — not found`);
      continue;
    }

    const text = fs.readFileSync(path, 'utf8');
    const records = parseCSV(text);
    console.log(`  ${catalog.file}: ${records.length} records (source: ${catalog.source})`);

    for (const rec of records) {
      const m = catalog.map;
      const author = rec[m.author] || '';
      const englishTitle = rec[m.english_title] || '';
      const originalTitle = rec[m.original_title] || '';
      const translator = rec[m.translator] || '';
      const pubYear = rec[m.pub_year] || '';
      const publisher = rec[m.publisher] || '';
      const series = rec[m.series] || '';
      const canonicalAuthor = rec[m.canonical_author] || '';
      const canonicalWork = rec[m.canonical_work] || '';

      // Skip empty records
      if (!author && !englishTitle) continue;

      const doc = {
        source: catalog.source,
        author,
        author_normalized: normalize(author),
        author_surname: extractSurname(author),
        canonical_author: canonicalAuthor || undefined,
        canonical_author_normalized: canonicalAuthor ? normalize(canonicalAuthor) : undefined,
        english_title: englishTitle,
        english_title_normalized: normalize(englishTitle),
        original_title: originalTitle || undefined,
        original_title_normalized: originalTitle ? normalize(originalTitle) : undefined,
        canonical_work: canonicalWork || undefined,
        canonical_work_normalized: canonicalWork ? normalize(canonicalWork) : undefined,
        translator,
        pub_year: pubYear,
        pub_year_int: parseInt(pubYear) || null,
        publisher,
        series: series || undefined,
        completeness: classifyCompleteness(englishTitle),
        imported_at: new Date(),
      };

      // Remove undefined fields
      for (const key of Object.keys(doc)) {
        if (doc[key] === undefined) delete doc[key];
      }

      allDocs.push(doc);
    }

    totalRecords += records.length;
  }

  console.log(`\nTotal records parsed: ${totalRecords}`);
  console.log(`Valid documents to import: ${allDocs.length}`);

  // Source breakdown
  const bySource = {};
  for (const doc of allDocs) {
    bySource[doc.source] = (bySource[doc.source] || 0) + 1;
  }
  console.log('\nBy source:');
  for (const [source, count] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count}`);
  }

  if (DRY_RUN) {
    console.log('\nDry run — no changes made.');
    await client.close();
    return;
  }

  // Drop and reimport
  console.log('\nDropping existing translation_catalogs collection...');
  try {
    await db.collection('translation_catalogs').drop();
  } catch (e) {
    // Collection doesn't exist yet
  }

  // Insert in batches of 1000
  const BATCH_SIZE = 1000;
  for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
    const batch = allDocs.slice(i, i + BATCH_SIZE);
    await db.collection('translation_catalogs').insertMany(batch);
    console.log(`  Inserted ${Math.min(i + BATCH_SIZE, allDocs.length)} / ${allDocs.length}`);
  }

  // Create indexes
  console.log('\nCreating indexes...');
  await db.collection('translation_catalogs').createIndex(
    { author_normalized: 'text', english_title_normalized: 'text', original_title_normalized: 'text', canonical_author_normalized: 'text', canonical_work_normalized: 'text' },
    { name: 'translation_catalogs_text_idx', default_language: 'none' }
  );
  await db.collection('translation_catalogs').createIndex({ author_surname: 1 }, { name: 'tc_author_surname_idx' });
  await db.collection('translation_catalogs').createIndex({ canonical_author_normalized: 1 }, { name: 'tc_canonical_author_idx' });
  await db.collection('translation_catalogs').createIndex({ source: 1 }, { name: 'tc_source_idx' });

  const count = await db.collection('translation_catalogs').countDocuments();
  console.log(`\nDone. ${count} documents in translation_catalogs.`);

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
