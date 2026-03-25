#!/usr/bin/env node
/**
 * Pre-OCR enrichment for Kloss Collection books.
 *
 * Phase 1: Language detection from titles (heuristic + Gemini)
 * Phase 2: Author normalization (canonical forms, variant collapse)
 * Phase 3: Kloss shelf mark decoder (section → subject mapping)
 * Phase 4: Multi-volume grouping
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import/kloss-enrich.mjs
 *
 * Options:
 *   --phase N        Run only phase N (1-4), or 'all' (default: all)
 *   --dry-run        Show changes without writing
 *   --limit N        Process at most N books
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const phaseArg = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : 'all';
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;

// ── Kloss Shelf Mark Classification ──────────────────────────────────
// Based on sampling titles in each section of Kloss's original system.

const KLOSS_SECTIONS = {
  'I':      { subject: 'Masonic Reference & Bibliography', categories: ['Freemasonry'] },
  'II':     { subject: 'History of Freemasonry', categories: ['Freemasonry'] },
  'III':    { subject: 'Constitutions & Old Charges', categories: ['Freemasonry'] },
  'IV':     { subject: 'Masonic Exposures & Catechisms', categories: ['Freemasonry'] },
  'V':      { subject: 'Masonic Correspondence & Administration', categories: ['Freemasonry'] },
  'VI':     { subject: 'Strict Observance & Templar Masonry', categories: ['Freemasonry', 'Templar'] },
  'VII':    { subject: 'Clerical & Religious Orders', categories: ['Freemasonry'] },
  'VIII':   { subject: 'African Builders (Afrikanische Bauherren)', categories: ['Freemasonry'] },
  'IX':     { subject: 'Masonic Orations & Addresses', categories: ['Freemasonry'] },
  'X':      { subject: 'Masonic Systems & Surveys', categories: ['Freemasonry'] },
  'XI':     { subject: 'Masonic Rituals (Craft Degrees)', categories: ['Freemasonry'] },
  'XII':    { subject: 'Alchemy, Magic & Occult Sciences', categories: ['Alchemy', 'Occult'] },
  'XIII':   { subject: 'Rosicrucianism & Gold- und Rosenkreuz', categories: ['Rosicrucianism', 'Freemasonry'] },
  'XIV':    { subject: 'Asiatic Brethren (Ritter des Lichts)', categories: ['Freemasonry'] },
  'XV':     { subject: 'Miscellaneous Secret Societies', categories: ['Freemasonry'] },
  'XVI':    { subject: 'Jesuits, Illuminati & Political Societies', categories: ['Illuminati', 'Freemasonry'] },
  'XVII':   { subject: 'French Masonic Administration', categories: ['Freemasonry'] },
  'XVIII':  { subject: 'French Masonic Bibliography & History', categories: ['Freemasonry'] },
  'XIX':    { subject: 'French Masonic Correspondence', categories: ['Freemasonry'] },
  'XX':     { subject: 'Grand Orient de France', categories: ['Freemasonry'] },
  'XXI':    { subject: 'French Lodge Records & Minutes', categories: ['Freemasonry'] },
  'XXII':   { subject: 'French Provincial Masonry', categories: ['Freemasonry'] },
  'XXIII':  { subject: 'French Masonic Speeches & Poetry', categories: ['Freemasonry'] },
  'XXIV':   { subject: 'Adoptive & Women\'s Masonry', categories: ['Freemasonry'] },
  'XXV':    { subject: 'French Higher Degrees (Élu, Écossais)', categories: ['Freemasonry'] },
  'XXVI':   { subject: 'French Higher Degrees (continued)', categories: ['Freemasonry'] },
  'XXVII':  { subject: 'Templar Degrees & Kadosh', categories: ['Freemasonry', 'Templar'] },
  'XXVIII': { subject: 'Rose-Croix Degrees (Masonic)', categories: ['Freemasonry', 'Rosicrucianism'] },
  'XXIX':   { subject: 'Supreme Councils & 33rd Degree', categories: ['Freemasonry'] },
  'XXX':    { subject: 'Scottish Rite Higher Degrees', categories: ['Freemasonry'] },
  'XXXI':   { subject: 'French Rite Instruction', categories: ['Freemasonry'] },
  'XXXII':  { subject: 'Grand Orient Craft Rituals', categories: ['Freemasonry'] },
  'XXXIII': { subject: 'Provincial French Rituals', categories: ['Freemasonry'] },
  'XXXIV':  { subject: 'Rectified Scottish Rite', categories: ['Freemasonry'] },
  'XXXV':   { subject: 'Egyptian & Cagliostro Rites', categories: ['Freemasonry'] },
  'XXXVI':  { subject: 'Clermont & Early French Systems', categories: ['Freemasonry'] },
  'XXXVII': { subject: 'Rite of Perfection', categories: ['Freemasonry'] },
  'XXXVIII':{ subject: 'Miscellaneous French Rites', categories: ['Freemasonry'] },
  'XXXIX':  { subject: 'German Lodge Rituals', categories: ['Freemasonry'] },
  'XL':     { subject: 'Templar Order (Ordre du Temple)', categories: ['Freemasonry', 'Templar'] },
  'XLI':    { subject: 'Templar Order (continued)', categories: ['Freemasonry', 'Templar'] },
  'XLII':   { subject: 'Philalèthes & Amis Réunis', categories: ['Freemasonry'] },
  'XLIII':  { subject: 'Miscellaneous Orders', categories: ['Freemasonry'] },
  'XLIV':   { subject: 'Miscellaneous Secret Societies', categories: ['Freemasonry'] },
  'XLV':    { subject: 'Chivalric & Pseudo-Historical Orders', categories: ['Freemasonry'] },
  'Verz':   { subject: 'Kloss Inventories & Catalogs', categories: ['Freemasonry'] },
  'Byz':    { subject: 'Lodge Records & Archival Documents', categories: ['Freemasonry'] },
};

// ── Author Normalization Map ─────────────────────────────────────────
// Hand-curated canonical forms for known variants in the Kloss catalog.

const AUTHOR_CANONICAL = {
  // Georg Kloss himself — 6 variants
  'kloss': 'Kloss, Georg',
  'kloss, br.': 'Kloss, Georg',
  'kloss, g.': 'Kloss, Georg',
  'kloss, georg': 'Kloss, Georg',
  '[kloss, g.]': 'Kloss, Georg',
  '[kloss, georg]': 'Kloss, Georg',
};

function normalizeAuthorString(raw) {
  if (!raw) return raw;
  // Check canonical map first (exact match on raw)
  const rawLower = raw.toLowerCase().trim();
  if (AUTHOR_CANONICAL[rawLower]) return AUTHOR_CANONICAL[rawLower];
  // Strip all brackets (= uncertain attribution in catalog convention)
  // Handles: "[Kloss, G.]", "Knigge, [A.F.F. von]", "[Bode, Joh. Joachim Christoph]"
  let cleaned = raw.replace(/\[/g, '').replace(/\]/g, '').trim();
  // Check canonical map on cleaned form
  const cleanedLower = cleaned.toLowerCase();
  if (AUTHOR_CANONICAL[cleanedLower]) return AUTHOR_CANONICAL[cleanedLower];
  // Standardize spacing
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

// ── Language Detection ───────────────────────────────────────────────
// Heuristic detection from title text. French, German, Latin, Dutch, English.

const LANG_MARKERS = {
  French: {
    weight: 0,
    words: ['des', 'les', 'du', 'une', 'dans', 'sur', 'par', 'pour', 'avec', 'aux',
            'qui', 'est', 'sont', 'cette', 'tous', 'ses', 'son', 'leurs', 'entre',
            'franc-maçon', 'maçon', 'loge', 'frère', 'frères', 'chevalier', 'grade',
            'rite', 'chapitre', 'élu', 'écossais', 'maître', 'apprentif', 'compagnon',
            'respectable', 'souverain', 'prince', 'orient', 'très', 'aussi',
            'histoire', 'rituel', 'règlement', 'statuts', 'discours'],
    phrases: ['de la', 'de l\'', 'du fr', 'le fr', 'grand orient', 'franc-maçonnerie',
              'rose-croix', 'chevalier de', 'grade de', 'loge de'],
  },
  German: {
    weight: 0,
    words: ['der', 'die', 'das', 'des', 'den', 'dem', 'ein', 'eine', 'und', 'oder',
            'von', 'zur', 'zum', 'über', 'aus', 'mit', 'nach', 'für', 'bei', 'auf',
            'vom', 'nebst', 'aller', 'seiner', 'seinen', 'diesem', 'welche', 'dessen',
            'freimaurerei', 'loge', 'bruder', 'brüder', 'meister', 'gesellen',
            'lehrling', 'orden', 'ritter', 'geschichte', 'abhandlung', 'ritual',
            'rede', 'verzeichniss', 'ueber', 'uebersicht'],
    phrases: ['der gr', 'die fr', 'von der', 'in der', 'zu den', 'an den',
              'über die', 'aus dem', 'und die', 'nebst ein'],
  },
  Latin: {
    weight: 0,
    words: ['qua', 'quae', 'quod', 'est', 'sunt', 'cum', 'pro', 'per', 'sub',
            'ante', 'post', 'inter', 'contra', 'super', 'supra', 'circa',
            'societas', 'ordo', 'frater', 'fratrum', 'magister', 'constitutio',
            'literae', 'apostolicae', 'pontifex', 'ecclesia', 'divina'],
    phrases: ['societas jesu', 'sancti', 'beati', 'ordo', 'anno domini'],
  },
  Dutch: {
    weight: 0,
    words: ['het', 'een', 'van', 'voor', 'met', 'ook', 'aan', 'dat', 'niet',
            'zijn', 'haar', 'hun', 'deze', 'dit', 'die', 'door', 'naar', 'uit',
            'bij', 'tot', 'werd', 'werden', 'heeft', 'hebben', 'onder',
            'vrijmetselarij', 'loge', 'broeder', 'broeders', 'receptie',
            'verhandeling', 'beschrijving', 'graad'],
    phrases: ['van de', 'in de', 'van het', 'op de', 'aan de'],
  },
  English: {
    weight: 0,
    words: ['the', 'and', 'for', 'with', 'from', 'this', 'that', 'which', 'their',
            'being', 'having', 'were', 'been', 'also', 'upon', 'into', 'unto',
            'freemasonry', 'freemasons', 'lodge', 'brother', 'brethren', 'master',
            'grand', 'ancient', 'charges', 'mystery', 'discovered'],
    phrases: ['of the', 'in the', 'to the', 'by the', 'and the'],
  },
};

function detectLanguageFromTitle(title) {
  if (!title) return null;
  const lower = title.toLowerCase();
  const scores = {};

  for (const [lang, markers] of Object.entries(LANG_MARKERS)) {
    let score = 0;
    // Word matching — split title into words
    const titleWords = lower.replace(/[^a-zàâçéèêëîïôûùüÿñæœäöüß'-]/g, ' ').split(/\s+/).filter(Boolean);
    for (const w of markers.words) {
      if (titleWords.includes(w)) score += 1;
    }
    // Phrase matching — higher weight
    for (const p of markers.phrases) {
      if (lower.includes(p)) score += 2;
    }
    scores[lang] = score;
  }

  // Disambiguate French/German 'des' overlap
  // 'des' is both French and German, so check context
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (entries[0][1] === 0) return null; // No signal
  if (entries[0][1] < 2) return null;   // Too weak

  // Need clear winner (at least 2 points ahead of second place)
  if (entries.length > 1 && entries[0][1] - entries[1][1] < 2) {
    // Ambiguous — return top candidate but mark as uncertain
    return { language: entries[0][0], confidence: 'low', scores };
  }

  return { language: entries[0][0], confidence: entries[0][1] >= 5 ? 'high' : 'medium', scores };
}

// ── Multi-Volume Detection ───────────────────────────────────────────

function detectMultiVolume(title, shelfMark) {
  const patterns = [
    /\bBand\s+(\d+)/i,
    /\bVol\.?\s*(\d+)/i,
    /\bdeel\s+(\d+)/i,
    /\bTh(?:eil|l)\.?\s*(\d+)/i,
    /\bTome\s+(\d+)/i,
    /\bPart\s+(\d+)/i,
    /\bHeft\s+(\d+)/i,
    /\bLieferung\s+(\d+)/i,
  ];

  for (const pat of patterns) {
    const m = title?.match(pat);
    if (m) {
      // Strip volume indicator from title to get base title for grouping
      const baseTitle = title.replace(pat, '').replace(/[.\s-]+$/, '').trim();
      return { volumeNumber: parseInt(m[1], 10), baseTitle, pattern: pat.source };
    }
  }

  // Check shelf mark for sub-numbering (e.g., "192 A 18:007")
  const shelfSub = shelfMark?.match(/:(\d{3})$/);
  if (shelfSub) {
    const baseShelf = shelfMark.replace(/:(\d{3})$/, '');
    return { volumeNumber: parseInt(shelfSub[1], 10), baseShelf, pattern: 'shelf_mark_sub' };
  }

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const klossBooks = await db.collection('books').find(
  { 'image_source.provider': 'cmc_kloss' },
  { projection: {
    id: 1, title: 1, author: 1, language: 1, categories: 1,
    'image_source.identifier': 1,
    'catalog_metadata.kloss_shelf_mark': 1,
    'catalog_metadata.shelf_mark': 1,
    'catalog_metadata.authors': 1,
  }}
).limit(limitArg).toArray();

console.log(`Loaded ${klossBooks.length} Kloss books for enrichment`);
console.log(`Phases: ${phaseArg} | Dry run: ${dryRun}\n`);

const stats = { lang: { set: 0, ambiguous: 0, none: 0 }, author: { normalized: 0, unchanged: 0 }, shelf: { mapped: 0, unmapped: 0 }, multiVol: { detected: 0 } };

// ── Phase 1: Language Detection ──────────────────────────────────────
if (phaseArg === 'all' || phaseArg === '1') {
  console.log('═══ Phase 1: Language Detection from Titles ═══\n');

  for (const book of klossBooks) {
    if (book.language && book.language !== 'Unknown') {
      continue; // Already has language
    }

    const result = detectLanguageFromTitle(book.title);
    if (!result) {
      stats.lang.none++;
      continue;
    }

    if (result.confidence === 'low') {
      stats.lang.ambiguous++;
      continue;
    }

    stats.lang.set++;
    if (!dryRun) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: {
          language: result.language,
          'kloss_enrichment.language_source': 'title_heuristic',
          'kloss_enrichment.language_confidence': result.confidence,
        }}
      );
    }

    if (stats.lang.set <= 5) {
      console.log(`  ${result.language} (${result.confidence}): ${book.title?.substring(0, 80)}`);
    }
  }

  console.log(`\n  Language: ${stats.lang.set} set, ${stats.lang.ambiguous} ambiguous, ${stats.lang.none} no signal\n`);
}

// ── Phase 2: Author Normalization ────────────────────────────────────
if (phaseArg === 'all' || phaseArg === '2') {
  console.log('═══ Phase 2: Author Normalization ═══\n');

  // First pass: build a canonical author map from all catalog entries
  const allCatalogAuthors = await db.collection('kloss_catalog').distinct('authors', { is_kloss: true });
  const authorMap = new Map(); // normalized → canonical
  const variantGroups = new Map(); // canonical → [variants]

  for (const raw of allCatalogAuthors) {
    if (!raw) continue;
    const canonical = normalizeAuthorString(raw);
    if (canonical !== raw) {
      authorMap.set(raw, canonical);
      if (!variantGroups.has(canonical)) variantGroups.set(canonical, []);
      variantGroups.get(canonical).push(raw);
    }
  }

  // Also detect variants by normalized comparison (strip brackets, standardize "Last, First")
  const byNormalized = new Map();
  for (const raw of allCatalogAuthors) {
    if (!raw) continue;
    const key = raw.toLowerCase().replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
    if (!byNormalized.has(key)) byNormalized.set(key, []);
    byNormalized.get(key).push(raw);
  }

  // Find groups with multiple variants
  const variantReport = [];
  for (const [key, variants] of byNormalized) {
    if (variants.length > 1) {
      variantReport.push({ key, variants, canonical: normalizeAuthorString(variants[0]) });
    }
  }

  if (variantReport.length > 0) {
    console.log('  Author variant groups found:');
    for (const { key, variants, canonical } of variantReport.slice(0, 15)) {
      console.log(`    ${canonical} ← [${variants.join(', ')}]`);
    }
    if (variantReport.length > 15) console.log(`    ... and ${variantReport.length - 15} more`);
  }

  // Apply normalizations to books
  for (const book of klossBooks) {
    if (!book.author || book.author === 'Unknown') continue;

    const normalized = normalizeAuthorString(book.author);
    if (normalized !== book.author) {
      stats.author.normalized++;
      if (!dryRun) {
        await db.collection('books').updateOne(
          { id: book.id },
          { $set: {
            author: normalized,
            'kloss_enrichment.original_author': book.author,
            'kloss_enrichment.author_normalized': true,
          }}
        );
      }
      if (stats.author.normalized <= 5) {
        console.log(`  "${book.author}" → "${normalized}"`);
      }
    } else {
      stats.author.unchanged++;
    }
  }

  console.log(`\n  Authors: ${stats.author.normalized} normalized, ${stats.author.unchanged} unchanged\n`);
}

// ── Phase 3: Shelf Mark Decoder ──────────────────────────────────────
if (phaseArg === 'all' || phaseArg === '3') {
  console.log('═══ Phase 3: Kloss Shelf Mark Classification ═══\n');

  for (const book of klossBooks) {
    const shelfMark = book.catalog_metadata?.kloss_shelf_mark;
    if (!shelfMark) { stats.shelf.unmapped++; continue; }

    // Parse section from shelf mark: "Kl.MS:VI.C.32" → "VI"
    const sectionMatch = shelfMark.match(/Kl\.?\s*MS\s*:?\s*(Verz|Byz|[IVXLC]+)/i);
    if (!sectionMatch) { stats.shelf.unmapped++; continue; }

    const section = sectionMatch[1];
    const info = KLOSS_SECTIONS[section];
    if (!info) { stats.shelf.unmapped++; continue; }

    stats.shelf.mapped++;

    // Merge categories (add new ones, keep existing)
    const existingCats = new Set(book.categories || []);
    const newCats = [...info.categories].filter(c => !existingCats.has(c));
    const mergedCats = [...existingCats, ...newCats];

    if (!dryRun) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: {
          categories: mergedCats,
          'kloss_enrichment.shelf_section': section,
          'kloss_enrichment.shelf_subject': info.subject,
          'kloss_enrichment.shelf_mark_parsed': shelfMark,
        }}
      );
    }

    if (stats.shelf.mapped <= 5) {
      console.log(`  [${section}] ${info.subject} → ${book.title?.substring(0, 60)}`);
    }
  }

  console.log(`\n  Shelf marks: ${stats.shelf.mapped} mapped, ${stats.shelf.unmapped} unmapped\n`);
}

// ── Phase 4: Multi-Volume Grouping ───────────────────────────────────
if (phaseArg === 'all' || phaseArg === '4') {
  console.log('═══ Phase 4: Multi-Volume Detection ═══\n');

  const volumeGroups = new Map(); // groupKey → [{ book, volumeNumber }]

  for (const book of klossBooks) {
    const shelfMark = book.catalog_metadata?.shelf_mark;
    const mv = detectMultiVolume(book.title, shelfMark);
    if (!mv) continue;

    stats.multiVol.detected++;

    const groupKey = mv.baseTitle || mv.baseShelf || 'unknown';

    if (!volumeGroups.has(groupKey)) volumeGroups.set(groupKey, []);
    volumeGroups.get(groupKey).push({ bookId: book.id, title: book.title, volume: mv.volumeNumber, pattern: mv.pattern });

    if (!dryRun) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: {
          'kloss_enrichment.multi_volume': {
            group_key: groupKey,
            volume_number: mv.volumeNumber,
            detection_pattern: mv.pattern,
          },
        }}
      );
    }
  }

  // Report actual multi-volume groups (2+ items)
  const actualGroups = [...volumeGroups.entries()].filter(([, items]) => items.length > 1);
  console.log(`  Detected ${stats.multiVol.detected} volume indicators`);
  console.log(`  Found ${actualGroups.length} actual multi-volume groups:\n`);

  for (const [key, items] of actualGroups.slice(0, 10)) {
    console.log(`    "${key.substring(0, 70)}"`);
    for (const item of items.sort((a, b) => a.volume - b.volume)) {
      console.log(`      Vol ${item.volume}: ${item.title?.substring(0, 70)}`);
    }
  }
  if (actualGroups.length > 10) console.log(`    ... and ${actualGroups.length - 10} more groups`);
}

// ── Summary ──────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log('KLOSS PRE-OCR ENRICHMENT — SUMMARY');
console.log('════════════════════════════════════════');
console.log(`Books processed: ${klossBooks.length}`);
console.log(`Language: ${stats.lang.set} set, ${stats.lang.ambiguous} ambiguous`);
console.log(`Authors: ${stats.author.normalized} normalized`);
console.log(`Shelf marks: ${stats.shelf.mapped} classified`);
console.log(`Multi-volume: ${stats.multiVol.detected} items in groups`);
console.log(`Dry run: ${dryRun}`);

await client.close();
