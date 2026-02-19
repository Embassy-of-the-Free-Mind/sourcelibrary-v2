#!/usr/bin/env node
/**
 * Cross-reference Source Library Latin books against the UNESCO Latin
 * translations census (7,542 records from Second Renaissance).
 *
 * 1. Imports the CSV into `latin_translations_census` collection (idempotent)
 * 2. Matches each Latin book by author + title
 * 3. Stores results in `book.translation_census` with provenance
 *
 * Usage:
 *   node scripts/cross-reference-translations.mjs --dry-run        # Preview
 *   node scripts/cross-reference-translations.mjs --apply          # Write to DB
 *   node scripts/cross-reference-translations.mjs --apply --reimport  # Force re-import CSV
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Simple CSV parser (no external dependency) ─────────────────────
function parseCsv(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      lines.push(current); current = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lines.push(current); current = ''; lines.push('\n');
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);

  // Reconstruct rows
  const rows = [];
  let row = [];
  for (const token of lines) {
    if (token === '\n') {
      if (row.length > 0) rows.push(row);
      row = [];
    } else {
      row.push(token);
    }
  }
  if (row.length > 0) rows.push(row);

  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = (r[i] || '').trim();
    }
    return obj;
  });
}

// ── Config ──────────────────────────────────────────────────────────
const CSV_PATH = '/Users/dereklomas/secondrenaissance/scripts/latin_translations_master.csv';

// Keywords for completeness classification (from translation_lookup.py)
const PARTIAL_RE = [
  /\bselect(ed|ions)\b/i, /\bexcerpt/i, /\bextract/i, /\babridg/i,
  /\bbook [ivxlc0-9]+\b/i, /\bbooks [ivxlc0-9]/i, /\bvol(\.|ume)?\s/i,
  /\bpart [ivxlc0-9]+\b/i, /\bchapter/i, /\bpassages\b/i,
  /\bantho/i, /\breader\b/i, /\bsampler\b/i,
];
const COMPLETE_RE = [
  /\bcomplete\b/i, /\bentire\b/i, /\bwhole\b/i, /\bfull\b/i,
  /\bcollected works\b/i, /\bopera omnia\b/i,
];

// ── Env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  try {
    const content = fs.readFileSync('.env.local', 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        env[m[1].trim()] = v;
      }
    }
  } catch {}
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// ── Helpers ─────────────────────────────────────────────────────────

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

/** Check if all query terms appear in the field */
function termsMatch(field, query) {
  const f = normalize(field);
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every(t => f.includes(t));
}

/** Classify completeness from the English title */
function classifyCompleteness(title) {
  const t = (title || '').toLowerCase();
  for (const re of COMPLETE_RE) if (re.test(t)) return 'complete';
  for (const re of PARTIAL_RE) if (re.test(t)) return 'partial';
  return 'unknown';
}

/** Extract a clean author surname for matching */
function extractSurname(authorStr) {
  if (!authorStr) return '';
  // Handle "Lastname, Firstname" format
  const comma = authorStr.indexOf(',');
  let name = comma > 0 ? authorStr.substring(0, comma) : authorStr;
  // Remove titles, honorifics
  name = name.replace(/\b(saint|st\.?|von|de|van|del|di|da|al-)\b/gi, '').trim();
  // Take last word if multi-word
  const parts = name.split(/\s+/);
  return normalize(parts[parts.length - 1]);
}

/** Extract meaningful title keywords from a book title */
function extractTitleKeywords(title) {
  if (!title) return [];
  const cleaned = normalize(title)
    // Remove common Latin prefixes
    .replace(/^(de|in|ad|pro|per|super|contra)\s+/g, '')
    // Remove common publishing info
    .replace(/\b(vol|volume|tome|part|edition|ed|trans|translated)\b.*/g, '');
  return cleaned.split(/\s+/).filter(w => w.length > 2);
}

// ── CSV Import ──────────────────────────────────────────────────────

async function importCsv(db, force) {
  const col = db.collection('latin_translations_census');
  const existing = await col.countDocuments();

  if (existing > 0 && !force) {
    console.log(`Census collection already has ${existing} records (use --reimport to force)`);
    return existing;
  }

  if (force && existing > 0) {
    console.log(`Dropping existing ${existing} records...`);
    await col.drop();
  }

  console.log(`Reading CSV from ${CSV_PATH}...`);
  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parseCsv(csvContent);
  console.log(`Parsed ${records.length} records`);

  // Enrich each record with normalized fields for matching
  const enriched = records.map(r => ({
    ...r,
    _author_norm: normalize(r.author || ''),
    _canonical_author_norm: normalize(r.canonical_author || ''),
    _author_surname: extractSurname(r.author || r.canonical_author || ''),
    _english_title_norm: normalize(r.english_title || ''),
    _original_title_norm: normalize(r.original_title || ''),
    _canonical_work_norm: normalize(r.canonical_work || ''),
    _completeness: classifyCompleteness(r.english_title),
    pub_year_int: parseInt(r.pub_year) || null,
    imported_at: new Date(),
  }));

  // Bulk insert
  const batchSize = 1000;
  for (let i = 0; i < enriched.length; i += batchSize) {
    await col.insertMany(enriched.slice(i, i + batchSize));
    process.stdout.write(`\r  Inserted ${Math.min(i + batchSize, enriched.length)}/${enriched.length}`);
  }
  console.log();

  // Create indexes for efficient searching
  await col.createIndex({ _author_surname: 1 });
  await col.createIndex({ _canonical_author_norm: 1 });
  await col.createIndex({ _canonical_work_norm: 1 });
  console.log(`Created indexes on census collection`);

  return enriched.length;
}

// ── Matching ────────────────────────────────────────────────────────

/**
 * Multi-strategy matching:
 * 1. Exact canonical_author + canonical_work match (highest confidence)
 * 2. Author surname + title keywords match (medium confidence)
 * 3. Author surname only match (low confidence, just for context)
 */
function matchBook(book, censusRecords) {
  const bookAuthor = normalize(book.author || '');
  const bookTitle = normalize(book.title || book.display_title || '');
  const bookSurname = extractSurname(book.author || '');
  const titleKeywords = extractTitleKeywords(book.title || book.display_title || '');

  const matches = {
    exact: [],       // canonical author + canonical work
    strong: [],      // author surname + title keywords (2+ keywords match)
    author_only: [], // just the author, for context
  };

  for (const r of censusRecords) {
    // Skip if author surname doesn't match at all
    if (!bookSurname || !r._author_surname) continue;
    if (!r._author_surname.includes(bookSurname) && !bookSurname.includes(r._author_surname)) continue;

    // Check canonical work match
    const workMatch = r._canonical_work_norm && bookTitle &&
      (termsMatch(bookTitle, r._canonical_work_norm) || termsMatch(r._canonical_work_norm, bookTitle));

    // Check title keyword overlap
    let titleKeywordHits = 0;
    for (const kw of titleKeywords) {
      if (r._english_title_norm.includes(kw) ||
          r._original_title_norm.includes(kw) ||
          r._canonical_work_norm.includes(kw)) {
        titleKeywordHits++;
      }
    }

    const entry = {
      english_title: r.english_title,
      original_title: r.original_title,
      canonical_author: r.canonical_author,
      canonical_work: r.canonical_work,
      translator: r.translator,
      pub_year: r.pub_year,
      publisher: r.publisher,
      source: r.source,
      series: r.series,
      completeness: r._completeness,
    };

    if (workMatch) {
      matches.exact.push(entry);
    } else if (titleKeywordHits >= 2 || (titleKeywordHits >= 1 && titleKeywords.length <= 2)) {
      matches.strong.push(entry);
    } else {
      matches.author_only.push(entry);
    }
  }

  return matches;
}

/** Determine verdict from matches */
function getVerdict(matches) {
  const allSignificant = [...matches.exact, ...matches.strong];

  if (allSignificant.length === 0) {
    return {
      status: 'no_translation_found',
      confidence: 'medium', // Census isn't exhaustive
      summary: 'No English translation found in the census (7,542 records). Likely a first English translation.',
      translations_by_other_authors: matches.author_only.length,
    };
  }

  const hasComplete = allSignificant.some(m => m.completeness === 'complete');
  const hasUnknown = allSignificant.some(m => m.completeness === 'unknown');
  const allPartial = allSignificant.every(m => m.completeness === 'partial');

  if (hasComplete) {
    return {
      status: 'has_complete_translation',
      confidence: 'high',
      summary: `Complete English translation exists (${allSignificant.length} edition(s) found).`,
      editions: allSignificant,
    };
  }

  if (allPartial) {
    return {
      status: 'only_partial_translations',
      confidence: 'medium',
      summary: `Only partial/selected translations found (${allSignificant.length}). May be a first complete English translation.`,
      editions: allSignificant,
    };
  }

  if (hasUnknown) {
    return {
      status: 'translation_exists_completeness_unknown',
      confidence: 'low',
      summary: `Translation(s) exist (${allSignificant.length}) but completeness unclear from title alone.`,
      editions: allSignificant,
    };
  }

  return {
    status: 'translation_exists',
    confidence: 'medium',
    summary: `${allSignificant.length} translation(s) found.`,
    editions: allSignificant,
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const reimport = args.includes('--reimport');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 5000;

  console.log(`=== Latin Translation Cross-Reference ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLYING CHANGES'}`);
  console.log();

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Step 1: Import CSV
  const censusCount = await importCsv(db, reimport);
  console.log(`Census: ${censusCount} records\n`);

  // Step 2: Load all census records into memory for fast matching
  const censusRecords = await db.collection('latin_translations_census').find({}).toArray();

  // Step 3: Find Latin books
  const latinBooks = await db.collection('books')
    .find({
      $or: [
        { language: { $regex: /latin/i } },
        { 'ai_metadata.language': { $regex: /latin/i } },
      ],
    })
    .sort({ title: 1 })
    .limit(limit)
    .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1,
               categories: 1, ai_metadata: 1, translation_census: 1 })
    .toArray();

  console.log(`Found ${latinBooks.length} Latin books to cross-reference\n`);

  // Stats
  const verdictCounts = {};
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < latinBooks.length; i++) {
    const book = latinBooks[i];
    const shortTitle = (book.display_title || book.title || '').substring(0, 55);
    const shortAuthor = (book.author || 'Unknown').substring(0, 25);

    const matches = matchBook(book, censusRecords);
    const verdict = getVerdict(matches);

    verdictCounts[verdict.status] = (verdictCounts[verdict.status] || 0) + 1;

    const exactCount = matches.exact.length;
    const strongCount = matches.strong.length;
    const authorCount = matches.author_only.length;

    const icon = verdict.status === 'no_translation_found' ? '!' :
                 verdict.status === 'has_complete_translation' ? ' ' :
                 verdict.status === 'only_partial_translations' ? '~' : '?';

    console.log(`${icon} [${i + 1}/${latinBooks.length}] ${shortTitle}`);
    console.log(`    Author: ${shortAuthor} | ${verdict.status} | exact:${exactCount} strong:${strongCount} author:${authorCount}`);

    if (matches.exact.length > 0) {
      const first = matches.exact[0];
      console.log(`    -> ${first.pub_year} "${first.english_title?.substring(0, 60)}" (${first.completeness})`);
    } else if (matches.strong.length > 0) {
      const first = matches.strong[0];
      console.log(`    -> ${first.pub_year} "${first.english_title?.substring(0, 60)}" (${first.completeness})`);
    }

    // Apply
    if (!dryRun) {
      const censusData = {
        verdict: verdict.status,
        confidence: verdict.confidence,
        summary: verdict.summary,
        exact_matches: matches.exact.length,
        strong_matches: matches.strong.length,
        author_only_matches: matches.author_only.length,
        top_editions: [...matches.exact, ...matches.strong].slice(0, 5),
        census_size: censusCount,
        checked_at: new Date(),
        source: 'latin_translations_master.csv (UNESCO + 50 publishers)',
      };

      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { translation_census: censusData, updated_at: new Date() } }
      );
      updated++;
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total Latin books: ${latinBooks.length}`);
  console.log(`Updated: ${updated}`);
  console.log();
  console.log('--- Verdicts ---');
  for (const [status, count] of Object.entries(verdictCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / latinBooks.length) * 100).toFixed(1);
    console.log(`  ${status}: ${count} (${pct}%)`);
  }

  if (dryRun) {
    console.log('\n(Dry run — use --apply to write to DB)');
  }

  await client.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
