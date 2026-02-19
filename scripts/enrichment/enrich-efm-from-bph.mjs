#!/usr/bin/env node
/**
 * Backfill EFM (Embassy of the Free Mind) books from BPH catalogue.
 *
 * Queries Source Library for EFM-imported books, matches against the BPH
 * (Bibliotheca Philosophica Hermetica) catalogue in Supabase, and backfills
 * metadata: categories, language, publisher, place_of_publication, dublin_core.
 *
 * Usage:
 *   node scripts/enrich-efm-from-bph.mjs --dry-run           # Preview matches (default)
 *   node scripts/enrich-efm-from-bph.mjs --apply              # Write to DB
 *   node scripts/enrich-efm-from-bph.mjs --apply --limit 50   # First 50
 *   node scripts/enrich-efm-from-bph.mjs --apply --surface-descriptions  # Also surface AI descriptions
 *
 * Requires: MONGODB_URI (from .env.local or env)
 * BPH catalogue accessed via Supabase (anon key, read-only).
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Supabase config (public anon key — read-only) ─────────────────────
const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';

// ── BPH keyword → Source Library category mapping ─────────────────────
const KEYWORD_TO_CATEGORY = {
  'alchemy': 'alchemy',
  'alchemie': 'alchemy',
  'hermetica': 'hermeticism',
  'hermeticism': 'hermeticism',
  'hermetic philosophy': 'hermeticism',
  'mysticism': 'mysticism',
  'mystiek': 'mysticism',
  'kabbalah': 'jewish-kabbalah',
  'kabbala': 'jewish-kabbalah',
  'cabala': 'christian-cabala',
  'christian cabala': 'christian-cabala',
  'rosicrucianism': 'rosicrucianism',
  'rosicrucian': 'rosicrucianism',
  'freemasonry': 'freemasonry',
  'theosophy': 'theosophy',
  'neoplatonism': 'neoplatonism',
  'neo-platonism': 'neoplatonism',
  'astrology': 'astrology',
  'magic': 'natural-magic',
  'natural magic': 'natural-magic',
  'ritual magic': 'ritual-magic',
  'gnosticism': 'gnosticism',
  'natural philosophy': 'natural-philosophy',
  'esotericism': 'hermeticism',
  'esoterica': 'hermeticism',
  'medicine': 'medicine',
  'theology': 'theology',
  'philosophy': 'philosophy',
  'paracelsian': 'paracelsian',
  'paracelsus': 'paracelsian',
  'pythagoreanism': 'pythagoreanism',
  'divination': 'divination',
};

// ── Env ───────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=#]+)=(.*)$/);
      if (match) {
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[match[1].trim()] = value;
      }
    }
  } catch { /* no .env.local */ }
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// ── Supabase REST client ─────────────────────────────────────────────
async function supabaseQuery(table, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url.toString(), {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Fuzzy matching ───────────────────────────────────────────────────
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;

  // Check if one contains the other
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  // Word overlap
  const wordsA = new Set(na.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(nb.split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const jaccard = overlap / (wordsA.size + wordsB.size - overlap);
  return jaccard;
}

function authorMatch(bookAuthor, bphAuthor) {
  if (!bookAuthor || !bphAuthor) return true; // no author to compare — don't penalize
  const na = normalize(bookAuthor);
  const nb = normalize(bphAuthor);
  if (na.includes(nb) || nb.includes(na)) return true;
  // Check last name match
  const lastA = na.split(' ').pop();
  const lastB = nb.split(' ').pop();
  return lastA === lastB;
}

function findBestMatch(book, bphResults) {
  let bestMatch = null;
  let bestScore = 0;

  for (const bph of bphResults) {
    let score = titleSimilarity(book.title, bph.title);

    // Bonus for author match
    if (authorMatch(book.author, bph.author)) {
      score += 0.1;
    } else {
      score -= 0.3; // Penalize author mismatch
    }

    // Bonus for year match
    if (book.year && bph.year) {
      const yearDiff = Math.abs(book.year - bph.year);
      if (yearDiff === 0) score += 0.1;
      else if (yearDiff <= 5) score += 0.05;
      else if (yearDiff > 20) score -= 0.2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { bph, score };
    }
  }

  return bestMatch && bestScore >= 0.5 ? bestMatch : null;
}

// ── Category extraction from BPH keywords ─────────────────────────────
function extractCategories(keywords) {
  if (!keywords) return [];
  const cats = new Set();
  const lower = keywords.toLowerCase();

  for (const [keyword, category] of Object.entries(KEYWORD_TO_CATEGORY)) {
    if (lower.includes(keyword)) {
      cats.add(category);
    }
  }

  return [...cats];
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 1000;
  const surfaceDescriptions = args.includes('--surface-descriptions');

  console.log('=== EFM Book Enrichment from BPH Catalogue ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN (use --apply to write)' : 'APPLYING CHANGES'}`);
  console.log(`Limit: ${limit}`);
  if (surfaceDescriptions) console.log('Also surfacing AI descriptions');
  console.log();

  const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  const db = mongoClient.db(MONGODB_DB);

  // Find EFM books
  const efmBooks = await db.collection('books')
    .find({
      $or: [
        { 'image_source.provider': 'efm' },
        { 'image_source.provider': 'biodiversity_heritage_library' }, // Old bug
        { 'image_source.provider_name': { $regex: /embassy|free mind|bph/i } },
      ],
    })
    .project({
      id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1,
      categories: 1, description: 1, dublin_core: 1, field_provenance: 1,
      publisher: 1, place_of_publication: 1, 'ai_metadata.description': 1,
      'image_source.provider': 1,
    })
    .limit(limit)
    .toArray();

  console.log(`Found ${efmBooks.length} EFM books\n`);

  if (efmBooks.length === 0) {
    await mongoClient.close();
    return;
  }

  // Load BPH catalogue from Supabase (paginated — 1000 per request)
  console.log('Loading BPH catalogue from Supabase...');
  let allBphWorks = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const batch = await supabaseQuery('bph_works', {
      select: 'id,ubn,title,author,year,place,publisher,printer,keywords,language,shelf_mark',
      order: 'id',
      limit: pageSize.toString(),
      offset: offset.toString(),
    });
    allBphWorks = allBphWorks.concat(batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  console.log(`Loaded ${allBphWorks.length} BPH records\n`);

  // Stats
  let matched = 0;
  let updated = 0;
  let noMatch = 0;
  let descriptionsAdded = 0;
  const changesByField = {};

  for (let i = 0; i < efmBooks.length; i++) {
    const book = efmBooks[i];
    const shortTitle = (book.display_title || book.title || '').substring(0, 60);

    // Search BPH by title (fuzzy)
    const titleWords = normalize(book.title || '').split(' ').filter(w => w.length > 3).slice(0, 3);
    const candidates = allBphWorks.filter(bph => {
      const bphNorm = normalize(bph.title);
      return titleWords.some(w => bphNorm.includes(w));
    });

    const match = findBestMatch(book, candidates);

    if (!match) {
      noMatch++;
      if (!dryRun && surfaceDescriptions && book.ai_metadata?.description && !book.description) {
        // Surface AI description even without BPH match
        await db.collection('books').updateOne(
          { id: book.id },
          {
            $set: {
              description: book.ai_metadata.description,
              'field_provenance.description': {
                source: 'ai_enrichment',
                note: 'Surfaced from ai_metadata.description',
                date: new Date(),
              },
              updated_at: new Date(),
            },
          },
        );
        descriptionsAdded++;
      }
      continue;
    }

    matched++;
    const { bph, score } = match;

    // Build updates
    const updates = { updated_at: new Date() };
    const changes = [];

    // Language: fill if Unknown
    if (book.language === 'Unknown' && bph.language) {
      // Normalize BPH language names
      const langMap = {
        'lat': 'Latin', 'latin': 'Latin', 'deu': 'German', 'german': 'German',
        'deutsch': 'German', 'fra': 'French', 'french': 'French', 'eng': 'English',
        'english': 'English', 'nld': 'Dutch', 'dutch': 'Dutch', 'ita': 'Italian',
        'italian': 'Italian', 'spa': 'Spanish', 'spanish': 'Spanish',
        'heb': 'Hebrew', 'hebrew': 'Hebrew', 'gre': 'Greek', 'greek': 'Greek',
        'ara': 'Arabic', 'arabic': 'Arabic',
      };
      const normalizedLang = langMap[bph.language.toLowerCase()] || bph.language;
      updates.language = normalizedLang;
      changes.push({ field: 'language', previous: 'Unknown', new_value: normalizedLang });
    }

    // Categories: merge BPH keywords
    const bphCategories = extractCategories(bph.keywords);
    if (bphCategories.length > 0) {
      const existing = book.categories || [];
      const merged = [...new Set([...existing, ...bphCategories])];
      if (merged.length > existing.length) {
        updates.categories = merged;
        changes.push({ field: 'categories', previous: existing, new_value: merged });
      }
    }

    // Publisher
    if (!book.publisher && bph.publisher) {
      updates.publisher = bph.publisher;
      changes.push({ field: 'publisher', previous: null, new_value: bph.publisher });
    }

    // Place of publication
    if (!book.place_of_publication && bph.place) {
      updates.place_of_publication = bph.place;
      changes.push({ field: 'place_of_publication', previous: null, new_value: bph.place });
    }

    // Dublin Core: fill if missing
    if (!book.dublin_core || Object.keys(book.dublin_core).length === 0) {
      updates.dublin_core = {
        dc_title: bph.title,
        dc_creator: bph.author || undefined,
        dc_date: bph.year ? String(bph.year) : undefined,
        dc_publisher: bph.publisher || undefined,
        dc_language: bph.language || undefined,
        dc_source: `BPH Catalogue (UBN: ${bph.ubn || bph.id})`,
        dc_identifier: bph.ubn || bph.id,
      };
      changes.push({ field: 'dublin_core', previous: null, new_value: 'from_bph' });
    }

    // Description: surface AI description if empty
    if (!book.description && surfaceDescriptions && book.ai_metadata?.description) {
      updates.description = book.ai_metadata.description;
      changes.push({ field: 'description', previous: null, new_value: 'from_ai_metadata' });
      descriptionsAdded++;
    }

    // Fix provider bug
    if (book.image_source?.provider === 'biodiversity_heritage_library') {
      updates['image_source.provider'] = 'efm';
      updates['image_source.provider_name'] = 'Embassy of the Free Mind';
      changes.push({ field: 'image_source.provider', previous: 'biodiversity_heritage_library', new_value: 'efm' });
    }

    // Field provenance
    const provenance = book.field_provenance || {};
    const bphSource = {
      source: 'bph_catalogue',
      bph_id: bph.id,
      bph_ubn: bph.ubn,
      match_score: score.toFixed(2),
      date: new Date(),
    };
    for (const change of changes) {
      provenance[change.field.replace('.', '_')] = bphSource;
      changesByField[change.field] = (changesByField[change.field] || 0) + 1;
    }
    if (changes.length > 0) {
      updates.field_provenance = provenance;
    }

    // Print
    const marker = changes.length > 0 ? '*' : ' ';
    const changedFields = changes.map(c => c.field).join(', ');
    console.log(`${marker} [${i + 1}/${efmBooks.length}] ${shortTitle}`);
    console.log(`    BPH: "${(bph.title || '').substring(0, 50)}" | Score: ${score.toFixed(2)} | Changes: ${changedFields || 'none'}`);

    // Apply
    if (!dryRun && changes.length > 0) {
      await db.collection('books').updateOne({ id: book.id }, { $set: updates });

      // Audit log
      await db.collection('audit_log').insertOne({
        timestamp: new Date(),
        action: 'book_metadata_updated',
        book_id: book.id,
        book_title: book.display_title || book.title,
        source: 'bph_catalogue',
        bph_id: bph.id,
        bph_ubn: bph.ubn,
        match_score: score,
        changes,
      });
      updated++;
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total EFM books: ${efmBooks.length}`);
  console.log(`Matched to BPH: ${matched} (${((matched / efmBooks.length) * 100).toFixed(1)}%)`);
  console.log(`No match: ${noMatch}`);
  if (!dryRun) {
    console.log(`Updated: ${updated}`);
    console.log(`Descriptions surfaced: ${descriptionsAdded}`);
  }

  if (Object.keys(changesByField).length > 0) {
    console.log('\n--- Changes by field ---');
    for (const [field, count] of Object.entries(changesByField).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${field}: ${count}`);
    }
  }

  if (dryRun) console.log('\n(Dry run — use --apply to write to DB.)');
  await mongoClient.close();
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
