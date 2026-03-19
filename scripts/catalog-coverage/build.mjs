#!/usr/bin/env node
/**
 * Build the catalog_coverage collection — a materialized join of:
 *   USTC editions (Supabase) × IIIF scans (import_candidates) × translations (translation_catalogs) × Source Library (books)
 *
 * For every USTC edition (1450–1700), determines:
 *   - Whether a digital scan exists (IIIF)
 *   - Whether a published translation exists
 *   - Whether it's in Source Library (and OCR/translation progress)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/catalog-coverage/build.mjs
 *   node scripts/catalog-coverage/build.mjs --language=Latin --year-min=1450 --year-max=1550
 *   node scripts/catalog-coverage/build.mjs --dry-run
 */

import { getScriptClient } from '../lib/mongo.mjs';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';
const SUPABASE_HEADERS = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

// --- CLI args ---
const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);
const DRY_RUN = 'dry-run' in args;
const LANG_FILTER = args.language || null;
const YEAR_MIN = parseInt(args['year-min']) || 1450;
const YEAR_MAX = parseInt(args['year-max']) || 1700;

// --- Latin → English author aliases (from census-v2) ---
const LATIN_TO_ENGLISH = {
  'ovidius naso': ['ovid'], 'ovidius': ['ovid'],
  'vergilius maro': ['virgil', 'vergil'], 'vergilius': ['virgil'],
  'horatius flaccus': ['horace'], 'horatius': ['horace'],
  'terentius afer': ['terence'], 'terentius': ['terence'],
  'sallustius crispus': ['sallust'], 'sallustius': ['sallust'],
  'plinius secundus': ['pliny'], 'plinius caecilius secundus': ['pliny'], 'plinius': ['pliny'],
  'livius': ['livy'], 'titus livius': ['livy'],
  'suetonius tranquillus': ['suetonius'], 'martialis': ['martial'],
  'juvenalis': ['juvenal'], 'lucanus': ['lucan'], 'statius': ['statius'],
  'curtius rufus': ['curtius'], 'quintilianus': ['quintilian'],
  'lucretius carus': ['lucretius'], 'lucretius': ['lucretius'],
  'persius flaccus': ['persius'], 'persius': ['persius'],
  'petronius arbiter': ['petronius'], 'petronius': ['petronius'],
  'claudianus': ['claudian'], 'caesar': ['caesar'], 'julius caesar': ['caesar'],
  'aristoteles': ['aristotle'], 'plato': ['plato'], 'plutarchus': ['plutarch'],
  'aesopus': ['aesop'], 'homerus': ['homer'], 'euclides': ['euclid'],
  'hippocrates': ['hippocrates'], 'galenus': ['galen'], 'ptolemaeus': ['ptolemy'],
  'josephus flavius': ['josephus'], 'josephus': ['josephus'],
  'augustinus': ['augustine', 'augustin'], 'thomas aquinas': ['aquinas', 'thomas'],
  'thomas de aquino': ['aquinas'], 'boethius': ['boethius'],
  'hieronymus': ['jerome'], 'gregorius magnus': ['gregory'], 'gregorius i': ['gregory'],
  'ambrosius': ['ambrose'], 'chrysostomus': ['chrysostom'],
  'johannes chrysostomus': ['chrysostom'],
  'basilius magnus': ['basil'], 'basilius': ['basil'],
  'origenes': ['origen'], 'tertullianus': ['tertullian'],
  'cyprianus': ['cyprian'], 'beda': ['bede'], 'beda venerabilis': ['bede'],
  'bernardus claraevallensis': ['bernard'], 'bernardus': ['bernard'],
  'anselmus cantuariensis': ['anselm'], 'anselmus': ['anselm'],
  'petrus lombardus': ['lombard', 'peter lombard'],
  'duns scotus': ['scotus', 'duns'],
  'isidorus hispalensis': ['isidore'], 'isidorus': ['isidore'],
  'lactantius': ['lactantius'], 'dionysius areopagita': ['dionysius', 'pseudo-dionysius'],
  'petrarca': ['petrarch'], 'ficinus': ['ficino'], 'marsilius ficinus': ['ficino'],
  'pico della mirandola': ['pico'], 'machiavelli': ['machiavelli'],
  'lutherus': ['luther'], 'calvinus': ['calvin'],
  'justinianus i': ['justinian'], 'justinianus': ['justinian'],
  'erasmus roterodamus': ['erasmus'], 'erasmus': ['erasmus'],
  'morus': ['more', 'thomas more'], 'thomas morus': ['more'],
  'grotius': ['grotius'], 'hugo grotius': ['grotius'],
  'spinoza': ['spinoza'], 'benedictus de spinoza': ['spinoza'],
  'descartes': ['descartes'], 'renatus descartes': ['descartes'],
  'leibnitius': ['leibniz'], 'copernicus': ['copernicus'],
  'vesalius': ['vesalius'], 'kircher': ['kircher'],
  'agrippa': ['agrippa'], 'agrippa von nettesheim': ['agrippa'],
  'hermes trismegistus': ['hermes'], 'iamblichus': ['iamblichus'],
  'proclus': ['proclus'], 'plotinus': ['plotinus'], 'porphyrius': ['porphyry'],
};

// --- Helpers ---

function extractSurname(author) {
  if (!author || author === 'Unknown') return null;
  const cleaned = author.replace(/&amp;/g, '&').replace(/<[^>]*>/g, '').trim();
  const commaIdx = cleaned.indexOf(',');
  if (commaIdx > 0) return cleaned.substring(0, commaIdx).trim().toLowerCase();
  const parts = cleaned.split(/\s+/);
  return parts[parts.length - 1].toLowerCase();
}

function normalizeTitle(title) {
  if (!title) return '';
  return title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function workClusterId(surname, title) {
  const normTitle = normalizeTitle(title).split(' ').slice(0, 6).join(' ');
  return `${surname || 'unknown'}::${normTitle || 'untitled'}`;
}

function titleWordOverlap(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(normalizeTitle(a).split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normalizeTitle(b).split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  return overlap / Math.min(wordsA.size, wordsB.size);
}

// --- Phase 1: Load MongoDB lookups ---

async function loadScanLookup(db) {
  console.log('Loading IIIF scan candidates...');
  const candidates = await db.collection('import_candidates').find(
    { status: { $in: ['discovered', 'imported'] } },
    { projection: { author: 1, title: 1, date_earliest: 1, date_latest: 1, source: 1, manifest_url: 1, book_id: 1, ustc_id: 1, status: 1 } }
  ).toArray();

  // Index by author surname + decade for blocking
  const byAuthorDecade = new Map();
  // Index by ustc_id for direct matches
  const byUstcId = new Map();
  let withUstc = 0;

  for (const c of candidates) {
    if (c.ustc_id) {
      byUstcId.set(c.ustc_id, c);
      withUstc++;
    }

    const surname = extractSurname(c.author);
    if (!surname || surname.length < 2) continue;
    const decade = c.date_earliest ? Math.floor(c.date_earliest / 10) * 10 : null;
    if (!decade) continue;

    const key = `${surname}:${decade}`;
    if (!byAuthorDecade.has(key)) byAuthorDecade.set(key, []);
    byAuthorDecade.get(key).push(c);
  }

  console.log(`  ${candidates.length.toLocaleString()} candidates loaded, ${byAuthorDecade.size.toLocaleString()} author-decade blocks, ${withUstc.toLocaleString()} with ustc_id`);
  return { byAuthorDecade, byUstcId };
}

async function loadTranslationLookup(db) {
  console.log('Loading translation catalogs...');
  const catalogs = await db.collection('translation_catalogs').find({}, {
    projection: { author_surname: 1, canonical_work_normalized: 1, source: 1 }
  }).toArray();

  // Build alias lookup: USTC surname → set of catalog surnames to check
  const aliasMap = new Map();
  for (const [latin, englishForms] of Object.entries(LATIN_TO_ENGLISH)) {
    for (const key of [latin, latin.split(' ')[0]]) {
      const k = key.toLowerCase().trim();
      if (!aliasMap.has(k)) aliasMap.set(k, new Set());
      for (const eng of englishForms) aliasMap.get(k).add(eng.toLowerCase().trim());
    }
  }

  const bySurname = new Map();
  for (const c of catalogs) {
    const surname = (c.author_surname || '').toLowerCase().trim();
    if (!surname || surname.length < 2) continue;
    if (!bySurname.has(surname)) bySurname.set(surname, []);
    bySurname.get(surname).push({
      work: (c.canonical_work_normalized || '').toLowerCase().trim(),
      source: c.source,
    });
  }

  console.log(`  ${catalogs.length.toLocaleString()} records, ${bySurname.size.toLocaleString()} author surnames`);
  return { bySurname, aliasMap };
}

async function loadSourceLibraryLookup(db) {
  console.log('Loading Source Library books...');
  const books = await db.collection('books').find(
    { hidden: { $ne: true } },
    { projection: { id: 1, ustc_id: 1, title: 1, author: 1, published: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, catalog_refs: 1 } }
  ).toArray();

  const byUstcId = new Map();
  const byCatalogRef = new Map();

  for (const b of books) {
    if (b.ustc_id) byUstcId.set(String(b.ustc_id), b);
    if (b.catalog_refs) {
      for (const ref of b.catalog_refs) {
        if (ref.source === 'ustc') byCatalogRef.set(String(ref.record_id), b);
      }
    }
  }

  // Also index by author surname + decade for fuzzy matching
  const byAuthorDecade = new Map();
  for (const b of books) {
    const surname = extractSurname(b.author);
    if (!surname || surname.length < 2) continue;
    const year = parseInt(b.published);
    if (!year || year < 1400 || year > 1800) continue;
    const decade = Math.floor(year / 10) * 10;
    const key = `${surname}:${decade}`;
    if (!byAuthorDecade.has(key)) byAuthorDecade.set(key, []);
    byAuthorDecade.get(key).push(b);
  }

  console.log(`  ${books.length.toLocaleString()} books, ${byUstcId.size.toLocaleString()} with ustc_id, ${byAuthorDecade.size.toLocaleString()} author-decade blocks`);
  return { byUstcId, byCatalogRef, byAuthorDecade, total: books.length };
}

// --- Phase 2: Match functions ---

function findScan(ustcEdition, scanLookup) {
  const ustcId = ustcEdition.id;

  // Direct USTC ID match
  if (scanLookup.byUstcId.has(ustcId)) {
    const c = scanLookup.byUstcId.get(ustcId);
    return {
      has_scan: true,
      scan_sources: [c.source],
      iiif_manifest_url: c.manifest_url,
      import_candidate_id: c._id,
      imported_to_sl: c.status === 'imported',
      match_method: 'ustc_id',
    };
  }

  // Blocking match: author surname + decade
  const surname = extractSurname(ustcEdition.author_1);
  if (!surname || !ustcEdition.year) return null;

  const decade = Math.floor(ustcEdition.year / 10) * 10;
  const candidates = scanLookup.byAuthorDecade.get(`${surname}:${decade}`) || [];

  let bestMatch = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = titleWordOverlap(ustcEdition.title, c.title);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = c;
    }
  }

  if (bestMatch && bestScore >= 0.4) {
    return {
      has_scan: true,
      scan_sources: [bestMatch.source],
      iiif_manifest_url: bestMatch.manifest_url,
      import_candidate_id: bestMatch._id,
      imported_to_sl: bestMatch.status === 'imported',
      match_method: 'title_similarity',
      match_score: bestScore,
    };
  }

  return null;
}

function findTranslation(ustcEdition, translationLookup) {
  const surname = extractSurname(ustcEdition.author_1);
  if (!surname) return null;

  // Direct surname match
  let entries = translationLookup.bySurname.get(surname);

  // Alias match
  if (!entries) {
    const aliases = translationLookup.aliasMap.get(surname);
    if (aliases) {
      entries = [];
      for (const alias of aliases) {
        const found = translationLookup.bySurname.get(alias);
        if (found) entries.push(...found);
      }
      if (entries.length === 0) entries = null;
    }
  }

  if (!entries || entries.length === 0) return null;

  const sources = [...new Set(entries.map(e => e.source))];
  const works = [...new Set(entries.map(e => e.work).filter(w => w))];
  return {
    has_published_translation: true,
    translation_sources: sources,
    translated_works_count: works.length,
  };
}

function findSourceLibrary(ustcEdition, slLookup) {
  const ustcId = String(ustcEdition.id);
  let book = slLookup.byUstcId.get(ustcId) || slLookup.byCatalogRef.get(ustcId);

  // Fuzzy match by author surname + decade + title similarity
  if (!book) {
    const surname = extractSurname(ustcEdition.author_1);
    if (surname && ustcEdition.year) {
      const decade = Math.floor(ustcEdition.year / 10) * 10;
      const candidates = slLookup.byAuthorDecade.get(`${surname}:${decade}`) || [];
      let bestScore = 0;
      for (const c of candidates) {
        const score = titleWordOverlap(ustcEdition.title, c.title);
        if (score > bestScore) { bestScore = score; book = c; }
      }
      if (bestScore < 0.4) book = null;
    }
  }

  if (!book) return null;

  const pagesCount = book.pages_count || 0;
  const pagesOcr = book.pages_ocr || 0;
  const pagesTranslated = book.pages_translated || 0;

  return {
    source_library_id: book.id,
    ocr_status: pagesOcr === 0 ? 'none' : pagesOcr >= pagesCount ? 'complete' : 'partial',
    translation_status: pagesTranslated === 0 ? 'none' : pagesTranslated >= pagesCount ? 'complete' : 'partial',
    sl_translation_percent: pagesCount > 0 ? Math.round((pagesTranslated / pagesCount) * 100) : 0,
    sl_ocr_percent: pagesCount > 0 ? Math.round((pagesOcr / pagesCount) * 100) : 0,
  };
}

// --- Phase 3: Pull USTC and build coverage ---

async function fetchUstcBatch(language, yearStart, yearEnd, offset, limit = 1000) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/ustc_editions`);
  url.searchParams.set('select', 'id,title,author_1,year,language_1,place,format,classification_1');
  if (language) url.searchParams.set('language_1', `eq.${language}`);
  url.searchParams.set('year', `gte.${yearStart}`);
  url.searchParams.set('and', `(year.lte.${yearEnd})`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('order', 'id');

  const res = await fetch(url.toString(), { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// Fetch all editions for a year range, retrying with smaller windows on timeout
async function fetchYearRange(language, yearStart, yearEnd) {
  const results = [];
  let offset = 0;

  while (true) {
    try {
      const data = await fetchUstcBatch(language, yearStart, yearEnd, offset);
      if (data.length === 0) break;
      results.push(...data);
      offset += 1000;
      if (data.length < 1000) break;
    } catch (err) {
      // If 5-year window times out, split into individual years
      if (yearEnd - yearStart > 0 && err.message?.includes('timeout')) {
        for (let y = yearStart; y <= yearEnd; y++) {
          const yearResults = await fetchYearRange(language, y, y);
          results.push(...yearResults);
        }
        return results;
      }
      // Single year timeout or other error — log and skip
      console.error(`  Error fetching ${language} ${yearStart}-${yearEnd} offset ${offset}: ${err.message}`);
      break;
    }
  }

  return results;
}

async function buildCoverage(db, scanLookup, translationLookup, slLookup) {
  const col = db.collection('catalog_coverage');

  // Create indexes
  if (!DRY_RUN) {
    console.log('\nCreating indexes...');
    await col.createIndex({ ustc_id: 1 }, { unique: true });
    await col.createIndex({ language: 1, year: 1 });
    await col.createIndex({ has_scan: 1 });
    await col.createIndex({ has_published_translation: 1 });
    await col.createIndex({ source_library_id: 1 }, { sparse: true });
    await col.createIndex({ author_surname: 1, year: 1 });
    await col.createIndex({ work_cluster_id: 1 });
    await col.createIndex({ has_scan: 1, has_published_translation: 1, language: 1 });
  }

  const languages = LANG_FILTER ? [LANG_FILTER] : ['Latin', 'German', 'French', 'Italian', 'Dutch', 'Spanish', 'Portuguese', 'English', 'Greek'];

  let totalProcessed = 0;
  let totalWithScan = 0;
  let totalWithTranslation = 0;
  let totalInSL = 0;

  const stats = {};

  for (const language of languages) {
    let langEditions = 0;
    let langScans = 0;
    let langTranslations = 0;
    let langSL = 0;

    console.log(`\n--- ${language} (${YEAR_MIN}–${YEAR_MAX}) ---`);

    for (let y = YEAR_MIN; y <= YEAR_MAX; y += 5) {
      const yEnd = Math.min(y + 4, YEAR_MAX);
      const batch = await fetchYearRange(language, y, yEnd);

      if (batch.length === 0) continue;

      // Match each edition
      const docs = [];
      for (const edition of batch) {
        const surname = extractSurname(edition.author_1);
        const scan = findScan(edition, scanLookup);
        const translation = findTranslation(edition, translationLookup);
        const sl = findSourceLibrary(edition, slLookup);

        const doc = {
          ustc_id: edition.id,
          title: edition.title || '',
          author: edition.author_1 || '',
          author_surname: surname || '',
          year: edition.year,
          language: edition.language_1 || language,
          place: edition.place || '',
          format: edition.format || '',
          classification: edition.classification_1 || '',
          work_cluster_id: workClusterId(surname, edition.title),

          // Scan
          has_scan: !!scan,
          scan_sources: scan?.scan_sources || [],
          iiif_manifest_url: scan?.iiif_manifest_url || null,
          scan_match_method: scan?.match_method || null,
          scan_match_score: scan?.match_score || null,

          // Translation
          has_published_translation: !!translation,
          translation_sources: translation?.translation_sources || [],

          // Source Library
          source_library_id: sl?.source_library_id || null,
          in_source_library: !!sl,
          ocr_status: sl?.ocr_status || null,
          translation_status: sl?.translation_status || null,
          sl_translation_percent: sl?.sl_translation_percent ?? null,
          sl_ocr_percent: sl?.sl_ocr_percent ?? null,

          built_at: new Date(),
        };

        docs.push(doc);
        if (scan) langScans++;
        if (translation) langTranslations++;
        if (sl) langSL++;
      }

      langEditions += docs.length;

      // Bulk upsert
      if (!DRY_RUN && docs.length > 0) {
        const ops = docs.map(d => ({
          updateOne: {
            filter: { ustc_id: d.ustc_id },
            update: { $set: d },
            upsert: true,
          }
        }));
        await col.bulkWrite(ops, { ordered: false });
      }

      if ((y - YEAR_MIN) % 25 === 0 || y + 5 > YEAR_MAX) {
        process.stdout.write(`  ${y}-${yEnd}: ${langEditions.toLocaleString()} editions (${langScans} scans, ${langTranslations} translations, ${langSL} SL)\r`);
      }
    }

    console.log(`\n  ${language}: ${langEditions.toLocaleString()} editions | ${langScans.toLocaleString()} scans (${(langEditions > 0 ? langScans / langEditions * 100 : 0).toFixed(1)}%) | ${langTranslations.toLocaleString()} with translations (${(langEditions > 0 ? langTranslations / langEditions * 100 : 0).toFixed(1)}%)`);

    stats[language] = { editions: langEditions, scans: langScans, translations: langTranslations, inSL: langSL };
    totalProcessed += langEditions;
    totalWithScan += langScans;
    totalWithTranslation += langTranslations;
    totalInSL += langSL;
  }

  // Store build metadata
  if (!DRY_RUN) {
    await db.collection('catalog_coverage_meta').updateOne(
      { _id: 'latest_build' },
      { $set: {
        built_at: new Date(),
        year_range: [YEAR_MIN, YEAR_MAX],
        languages: LANG_FILTER ? [LANG_FILTER] : languages,
        total_editions: totalProcessed,
        total_with_scan: totalWithScan,
        total_with_translation: totalWithTranslation,
        total_in_source_library: totalInSL,
        stats,
      }},
      { upsert: true }
    );
  }

  return { totalProcessed, totalWithScan, totalWithTranslation, totalInSL, stats };
}

// --- Main ---

async function main() {
  console.log('=== Catalog Coverage Builder ===');
  console.log(`Year range: ${YEAR_MIN}–${YEAR_MAX}`);
  console.log(`Language: ${LANG_FILTER || 'all'}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  const { client, db } = await getScriptClient({ noTimeout: true, maxPoolSize: 3 });

  try {
    // Phase 1: Load lookups
    const scanLookup = await loadScanLookup(db);
    const translationLookup = await loadTranslationLookup(db);
    const slLookup = await loadSourceLibraryLookup(db);

    // Phase 2: Build coverage
    const start = Date.now();
    const results = await buildCoverage(db, scanLookup, translationLookup, slLookup);
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('  CATALOG COVERAGE BUILD COMPLETE');
    console.log('='.repeat(60));
    console.log(`  Total editions:       ${results.totalProcessed.toLocaleString()}`);
    console.log(`  With digital scan:    ${results.totalWithScan.toLocaleString()} (${(results.totalWithScan / results.totalProcessed * 100).toFixed(1)}%)`);
    console.log(`  With translation:     ${results.totalWithTranslation.toLocaleString()} (${(results.totalWithTranslation / results.totalProcessed * 100).toFixed(1)}%)`);
    console.log(`  In Source Library:     ${results.totalInSL.toLocaleString()} (${(results.totalInSL / results.totalProcessed * 100).toFixed(1)}%)`);
    console.log(`  Elapsed:              ${elapsed}s`);
    if (DRY_RUN) console.log('  (DRY RUN — nothing written)');
  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
