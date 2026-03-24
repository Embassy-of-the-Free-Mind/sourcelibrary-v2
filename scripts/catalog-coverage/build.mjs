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

import { MongoClient } from 'mongodb';

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
  console.log('Loading IIIF scan candidates (paginated)...');
  const byAuthorDecade = new Map();
  const byUstcId = new Map();
  let total = 0, withUstc = 0;

  const col = db.collection('import_candidates');
  const PAGE_SIZE = 10000;
  let lastId = null;

  while (true) {
    const filter = { status: { $in: ['discovered', 'imported'] } };
    if (lastId) filter._id = { $gt: lastId };

    const batch = await col.find(filter, {
      projection: { author: 1, title: 1, date_earliest: 1, source: 1, manifest_url: 1, ustc_id: 1, status: 1 },
    }).sort({ _id: 1 }).limit(PAGE_SIZE).toArray();

    if (batch.length === 0) break;

    for (const c of batch) {
      total++;
      if (c.ustc_id) { byUstcId.set(c.ustc_id, c); withUstc++; }

      const surname = extractSurname(c.author);
      if (!surname || surname.length < 2) continue;
      const decade = c.date_earliest ? Math.floor(c.date_earliest / 10) * 10 : null;
      if (!decade) continue;

      const quality = c.scan_quality || (c.source === 'ia_microfilm' ? 'low' : ['bsb', 'erara'].includes(c.source) ? 'high' : 'medium');
      const slim = { _id: c._id, title: c.title, source: c.source, manifest_url: c.manifest_url, status: c.status, scan_quality: quality };
      const key = `${surname}:${decade}`;
      if (!byAuthorDecade.has(key)) byAuthorDecade.set(key, []);
      byAuthorDecade.get(key).push(slim);
      // Also index Latin/Italian-stripped variant so ficinus→ficin matches ficino→ficin
      const stripped = surname.replace(/(us|is|ius|inus|o)$/, '');
      if (stripped !== surname && stripped.length >= 3) {
        const strippedKey = `${stripped}:${decade}`;
        if (!byAuthorDecade.has(strippedKey)) byAuthorDecade.set(strippedKey, []);
        byAuthorDecade.get(strippedKey).push(slim);
      }
      // Also index first word of multi-word surnames (e.g. "agrippa von nettesheim" → "agrippa")
      const firstWord = surname.split(/\s+/)[0];
      if (firstWord !== surname && firstWord.length >= 3) {
        const fwKey = `${firstWord}:${decade}`;
        if (!byAuthorDecade.has(fwKey)) byAuthorDecade.set(fwKey, []);
        byAuthorDecade.get(fwKey).push(slim);
      }
    }

    lastId = batch[batch.length - 1]._id;
    process.stdout.write(`  ${total.toLocaleString()} loaded...\r`);
  }

  console.log(`  ${total.toLocaleString()} candidates loaded, ${byAuthorDecade.size.toLocaleString()} author-decade blocks, ${withUstc.toLocaleString()} with ustc_id`);
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
        if (ref.source === 'ustc') byCatalogRef.set(String(ref.ustc_id || ref.record_id), b);
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
      has_iiif_scan: true,
      scan_sources: [c.source],
      scan_quality: c.scan_quality || 'medium',
      iiif_manifest_url: c.manifest_url,
      import_candidate_id: c._id,
      imported_to_sl: c.status === 'imported',
      match_method: 'ustc_id',
    };
  }

  // Blocking match: author surname + decade (check adjacent decades too)
  const surname = extractSurname(ustcEdition.author_1);
  if (!surname || !ustcEdition.year) return null;

  const decade = Math.floor(ustcEdition.year / 10) * 10;
  // Try exact surname and Latin/Italian-stripped variants, across 3 decades
  const surnameVariants = [surname];
  const stripped = surname.replace(/(us|is|ius|inus|o)$/, '');
  if (stripped !== surname && stripped.length >= 3) surnameVariants.push(stripped);
  // First word of multi-word surnames (e.g. "agrippa von nettesheim" → "agrippa")
  const firstWord = surname.split(/\s+/)[0];
  if (firstWord !== surname && firstWord.length >= 3) surnameVariants.push(firstWord);

  let candidates = [];
  for (const s of surnameVariants) {
    for (const d of [decade, decade - 10, decade + 10]) {
      const found = scanLookup.byAuthorDecade.get(`${s}:${d}`);
      if (found) candidates.push(...found);
    }
  }

  // Score candidates and prefer higher quality when scores are close
  const QUALITY_RANK = { high: 3, medium: 2, low: 1 };
  let bestMatch = null;
  let bestScore = 0;
  let bestQuality = 0;
  for (const c of candidates) {
    const score = titleWordOverlap(ustcEdition.title, c.title);
    const qRank = QUALITY_RANK[c.scan_quality] || 1;
    // Prefer higher score; break ties by quality
    if (score > bestScore || (score === bestScore && qRank > bestQuality)) {
      bestScore = score;
      bestMatch = c;
      bestQuality = qRank;
    }
  }

  if (bestMatch && bestScore >= 0.4) {
    return {
      has_iiif_scan: true,
      scan_sources: [bestMatch.source],
      scan_quality: bestMatch.scan_quality || 'medium',
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
    has_english_translation: true,
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
    // Only create the indexes we actually need (see issue #332 for cleanup rationale)
    const indexes = [
      [{ ustc_id: 1 }, { unique: true }],
      [{ language: 1, year: 1 }],
      [{ source_library_id: 1 }, { sparse: true }],
      [{ author_surname: 1, year: 1 }],
      [{ work_cluster_id: 1 }],
      [{ has_iiif_scan: 1, has_english_translation: 1, language: 1 }],
      // Skipped: text_search (432MB, 60x slower than author_surname fallback)
      // Skipped: has_iiif_scan_1, has_english_translation_1 (redundant with compound)
    ];
    for (const [key, opts] of indexes) {
      try { await col.createIndex(key, opts || {}); } catch (e) { console.error(`  Index ${JSON.stringify(key)}: ${e.message.slice(0, 60)}`); }
    }
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
    let langScansHigh = 0;
    let langScansMedium = 0;
    let langScansLow = 0;
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
        // English editions are already in a modern language — skip translation matching
        const lang = edition.language_1 || language;
        const translation = lang === 'English' ? null : findTranslation(edition, translationLookup);
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
          has_iiif_scan: !!scan,
          scan_sources: scan?.scan_sources || [],
          scan_quality: scan?.scan_quality || null,
          iiif_manifest_url: scan?.iiif_manifest_url || null,
          scan_match_method: scan?.match_method || null,
          scan_match_score: scan?.match_score || null,

          // Translation
          has_english_translation: !!translation,
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
        if (scan) {
          langScans++;
          if (scan.scan_quality === 'high') langScansHigh++;
          else if (scan.scan_quality === 'low') langScansLow++;
          else langScansMedium++;
        }
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
        // Write in chunks of 500 with retry on timeout
        for (let i = 0; i < ops.length; i += 500) {
          const chunk = ops.slice(i, i + 500);
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await col.bulkWrite(chunk, { ordered: false });
              break;
            } catch (err) {
              const msg = String(err.message || err);
              if (attempt < 2 && (msg.includes('timed out') || msg.includes('ECONNRESET') || msg.includes('PoolCleared') || msg.includes('pool was cleared') || msg.includes('ENOTFOUND') || msg.includes('ResetPool'))) {
                console.error(`\n  Write error, retry ${attempt + 1}/3: ${msg.slice(0, 100)}`);
                await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
              } else {
                throw err;
              }
            }
          }
        }
      }

      if ((y - YEAR_MIN) % 25 === 0 || y + 5 > YEAR_MAX) {
        process.stdout.write(`  ${y}-${yEnd}: ${langEditions.toLocaleString()} editions (${langScans} scans, ${langTranslations} translations, ${langSL} SL)\r`);
      }
    }

    console.log(`\n  ${language}: ${langEditions.toLocaleString()} editions | ${langScans.toLocaleString()} scans (${(langEditions > 0 ? langScans / langEditions * 100 : 0).toFixed(1)}%) | ${langTranslations.toLocaleString()} with translations (${(langEditions > 0 ? langTranslations / langEditions * 100 : 0).toFixed(1)}%)`);

    stats[language] = { editions: langEditions, scans: langScans, scansHigh: langScansHigh, scansMedium: langScansMedium, scansLow: langScansLow, translations: langTranslations, inSL: langSL };
    totalProcessed += langEditions;
    totalWithScan += langScans;
    totalWithTranslation += langTranslations;
    totalInSL += langSL;
  }

  // Compute work-level stats
  let worksStats = null;
  if (!DRY_RUN) {
    console.log('\nComputing work-level stats...');
    const worksResult = await col.aggregate([
      {
        $group: {
          _id: '$work_cluster_id',
          any_scan: { $max: { $cond: ['$has_iiif_scan', 1, 0] } },
          any_translation: { $max: { $cond: ['$has_english_translation', 1, 0] } },
          any_sl: { $max: { $cond: ['$in_source_library', 1, 0] } },
        }
      },
      {
        $group: {
          _id: null,
          total_works: { $sum: 1 },
          works_with_scan: { $sum: '$any_scan' },
          works_with_translation: { $sum: '$any_translation' },
          works_in_sl: { $sum: '$any_sl' },
          works_scanned_not_translated: {
            $sum: { $cond: [{ $and: [{ $eq: ['$any_scan', 1] }, { $eq: ['$any_translation', 0] }] }, 1, 0] }
          },
          works_neither: {
            $sum: { $cond: [{ $and: [{ $eq: ['$any_scan', 0] }, { $eq: ['$any_translation', 0] }] }, 1, 0] }
          },
        }
      },
    ], { allowDiskUse: true }).toArray();
    worksStats = worksResult[0] || {};
    delete worksStats._id;
    console.log(`  ${worksStats.total_works?.toLocaleString()} distinct works, ${worksStats.works_with_scan?.toLocaleString()} scanned, ${worksStats.works_with_translation?.toLocaleString()} translated`);
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
        works: worksStats,
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

  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }
  const client = new MongoClient(uri, {
    maxPoolSize: 3,
    serverSelectionTimeoutMS: 30_000,
    connectTimeoutMS: 30_000,
    socketTimeoutMS: 120_000,  // 2min — needed for streaming 664K candidates
    maxIdleTimeMS: 120_000,
  });
  await client.connect();
  const db = client.db('bookstore');

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
