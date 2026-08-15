#!/usr/bin/env node
/**
 * Import Egyptian texts from ORAEC (Open Richly Annotated Egyptian Corpus).
 * Source: https://github.com/oraec/corpus_raw_data
 *
 * Each ORAEC text becomes a single-page "book" with:
 *   - OCR field: hieroglyphic transliteration (word-by-word)
 *   - Translation field: German sentence translations
 *   - Hieroglyphs displayed inline
 *
 * Usage:
 *   # First, clone or download the corpus:
 *   git clone https://github.com/oraec/corpus_raw_data.git /tmp/oraec
 *
 *   # Then import:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/import-oraec.mjs --corpus-dir /tmp/oraec --limit 50
 *
 * Flags:
 *   --corpus-dir PATH    Path to cloned corpus (required)
 *   --limit N            Max texts to import (default: 100)
 *   --min-sentences N    Skip texts with fewer sentences (default: 3)
 *   --dry-run            Print what would be imported without writing
 *   --famous-only        Import only well-known texts first
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// ── CLI flags ──
const args = process.argv.slice(2);
function getFlag(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] || defaultVal;
}
const CORPUS_DIR = getFlag('corpus-dir', null);
const LIMIT = parseInt(getFlag('limit', '100'), 10);
const MIN_SENTENCES = parseInt(getFlag('min-sentences', '3'), 10);
const DRY_RUN = args.includes('--dry-run');
const FAMOUS_ONLY = args.includes('--famous-only');

if (!CORPUS_DIR) {
  console.error('--corpus-dir is required. Clone the corpus first:\n  git clone https://github.com/oraec/corpus_raw_data.git /tmp/oraec');
  process.exit(1);
}

// ── Famous Egyptian texts (prioritize these) ──
const FAMOUS_TEXTS = [
  'sinuhe', 'wenamun', 'eloquent peasant', 'shipwrecked sailor',
  'westcar', 'ipuwer', 'neferti', 'ptahhotep', 'merikare',
  'book of the dead', 'amduat', 'pyramid text', 'coffin text',
  'instruction', 'teaching', 'hymn', 'rosetta',
];

// ── Helpers ──
function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function generateSlug(db, title) {
  const base = slugify(title);
  let slug = base;
  let i = 1;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

function normalizeTitle(t) { return (t || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(); }
function normalizeAuthor(a) { return (a || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(); }

/**
 * Map ORAEC date strings to approximate year and period label.
 */
function parseDate(dateArray) {
  if (!dateArray?.length) return { year: null, period: 'Unknown' };
  const d = dateArray[0].date;
  // Common patterns: "12. Dyn.", "18. Dyn.", "Neues Reich", "Ptolemäisch"
  const dynMatch = d.match(/(\d+)\.\s*Dyn/);
  if (dynMatch) {
    const dyn = parseInt(dynMatch[1], 10);
    // Very rough dynasty-to-year mapping
    const dynYears = {
      1: -3000, 2: -2890, 3: -2686, 4: -2613, 5: -2494, 6: -2345,
      7: -2181, 8: -2181, 9: -2160, 10: -2160, 11: -2055, 12: -1985,
      13: -1773, 14: -1773, 15: -1650, 16: -1650, 17: -1580, 18: -1550,
      19: -1295, 20: -1186, 21: -1069, 22: -945, 23: -818, 24: -727,
      25: -747, 26: -664, 27: -525, 28: -404, 29: -399, 30: -380, 31: -343,
    };
    return { year: dynYears[dyn] || null, period: d };
  }
  if (d.includes('Ptolem')) return { year: -300, period: d };
  if (d.includes('Röm')) return { year: 100, period: d };
  if (d.includes('Kopt')) return { year: 400, period: d };
  return { year: null, period: d };
}

/**
 * Map object type (German) to English.
 */
function mapObjectType(typeArray) {
  if (!typeArray?.length) return 'text';
  const t = typeArray[0].objecttype.toLowerCase();
  const map = {
    'schriftrolle': 'papyrus scroll',
    'stele': 'stela', 'stela': 'stela',
    'wand': 'wall inscription',
    'ostrakon': 'ostracon',
    'sarg': 'coffin', 'sarkophag': 'sarcophagus',
    'tempel': 'temple inscription',
    'statue': 'statue inscription',
    'gefäß': 'vessel inscription',
    'tafel': 'tablet',
    'papyrus': 'papyrus',
  };
  for (const [de, en] of Object.entries(map)) {
    if (t.includes(de)) return en;
  }
  return typeArray[0].objecttype;
}

/**
 * Build the OCR text from ORAEC sentences.
 * Format: numbered lines with transliteration + hieroglyphs.
 */
function buildOcrText(sentences) {
  const lines = [];
  for (let i = 0; i < sentences.length; i++) {
    const sent = sentences[i];
    const tokens = sent.token || [];

    // Build transliteration line
    const translit = tokens
      .map(t => t.written_form || '')
      .filter(Boolean)
      .join(' ');

    // Build hieroglyph line
    const hieros = tokens
      .map(t => t.hiero || '')
      .filter(h => h && h !== '[⯑]')
      .join(' ');

    if (!translit && !hieros) continue;

    const lineNum = lines.length + 1;
    let line = `${lineNum}. ${translit}`;
    if (hieros) {
      line += `\n   ${hieros}`;
    }
    lines.push(line);
  }
  return lines.join('\n\n');
}

/**
 * Build the translation text from ORAEC sentences.
 */
function buildTranslation(sentences) {
  const lines = [];
  let lineNum = 0;
  for (const sent of sentences) {
    const translit = (sent.token || []).map(t => t.written_form || '').filter(Boolean).join(' ');
    if (!translit) continue;
    lineNum++;
    const translation = sent.translation || '[untranslated]';
    lines.push(`${lineNum}. ${translation}`);
  }
  return lines.join('\n\n');
}

/**
 * Build a cleaner English title from the German ORAEC title.
 */
function cleanTitle(rawTitle, oraecId) {
  // Strip manuscript sigla like "pBerlin P 3022 und Fragmente pAmherst m-q (B)"
  let title = rawTitle;
  // If it has a "/" separating name from manuscript, take the name
  if (title.includes(' / ')) {
    title = title.split(' / ')[0].trim();
  }
  // Remove parenthetical manuscript sigla at end
  title = title.replace(/\s*\([A-Z]\)\s*$/, '').trim();
  return title || `ORAEC ${oraecId}`;
}

// ── Main ──
async function main() {
  console.log(`ORAEC Import — limit: ${LIMIT}, min-sentences: ${MIN_SENTENCES}, famous-only: ${FAMOUS_ONLY}, dry-run: ${DRY_RUN}`);

  // Step 1: List all JSON files
  const files = readdirSync(CORPUS_DIR)
    .filter(f => f.startsWith('oraec') && f.endsWith('.json'))
    .sort((a, b) => {
      const numA = parseInt(a.replace('oraec', '').replace('.json', ''), 10);
      const numB = parseInt(b.replace('oraec', '').replace('.json', ''), 10);
      return numA - numB;
    });
  console.log(`Found ${files.length} ORAEC text files`);

  // Step 2: Pre-scan for famous texts if --famous-only
  let targetFiles = files;
  if (FAMOUS_ONLY) {
    console.log('Pre-scanning for famous texts...');
    const famous = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(CORPUS_DIR, file), 'utf8'));
        const key = Object.keys(raw)[0];
        const title = (raw[key].title || '').toLowerCase();
        if (FAMOUS_TEXTS.some(f => title.includes(f))) {
          famous.push({ file, title: raw[key].title });
        }
      } catch { /* skip */ }
    }
    console.log(`Found ${famous.length} famous texts`);
    famous.forEach(f => console.log(`  ${f.file}: ${f.title}`));
    targetFiles = famous.map(f => f.file);
  }

  // Step 3: Connect to MongoDB
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('bookstore');
  console.log('Connected to MongoDB');

  let imported = 0, skipped = 0, dupes = 0, errors = 0;
  let totalSentences = 0;
  const importedIds = [];

  for (const file of targetFiles) {
    if (imported >= LIMIT) break;

    let raw, text, oraecId;
    try {
      raw = JSON.parse(readFileSync(join(CORPUS_DIR, file), 'utf8'));
      oraecId = Object.keys(raw)[0];
      text = raw[oraecId];
    } catch (err) {
      errors++;
      continue;
    }

    const sentences = text.sentences || [];
    if (sentences.length < MIN_SENTENCES) {
      skipped++;
      continue;
    }

    // Count sentences with actual content
    const contentSentences = sentences.filter(s =>
      (s.token || []).some(t => t.written_form && t.written_form !== '[...]')
    );
    if (contentSentences.length < MIN_SENTENCES) {
      skipped++;
      continue;
    }

    const title = cleanTitle(text.title || `ORAEC ${oraecId}`, oraecId);
    const normalizedT = normalizeTitle(title);

    // Dedup check
    try {
      const existing = await db.collection('books').findOne(
        { $or: [
          { source_fingerprint: `oraec:${oraecId}` },
          { normalized_title: normalizedT, original_language: 'Egyptian hieroglyphs' },
        ]},
        { projection: { _id: 1, title: 1 }, maxTimeMS: 30000 }
      );
      if (existing) {
        dupes++;
        continue;
      }
    } catch (err) {
      console.warn(`  Dedup check failed for ${oraecId}: ${err.message}`);
      errors++;
      continue;
    }

    const { year, period } = parseDate(text.date);
    const objectType = mapObjectType(text.objecttype);
    const ocrText = buildOcrText(contentSentences);
    const translationText = buildTranslation(contentSentences);
    const author = text.credits?.author || 'Unknown';
    const origPlace = text.origplace?.[0]?.origplace || '';

    if (DRY_RUN) {
      console.log(`  [DRY] ${title} | ${objectType} | ${period} | ${contentSentences.length} sentences | by ${author}`);
      imported++;
      totalSentences += contentSentences.length;
      continue;
    }

    // Atomic-by-construction: insert page FIRST, then book.
    // If the page insert fails, no book is created (no orphan with 0 pages).
    // If the book insert fails after the page is in, the orphan page is harmless
    // (no book references it) and gets cleaned up by the standard page sweeper.
    // We also defensively roll back if the book insert fails.
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();
    const pageId = new ObjectId();

    try {
      const slug = await generateSlug(db, title);

      const pageDoc = makePageDoc({
        _id: pageId,
        id: pageId.toHexString(),
        book_id: bookIdStr,
        page_number: 1,
        photo: null,
        thumbnail: null,
        ocr: { data: ocrText, model: 'oraec-corpus', updated_at: new Date() },
        translation: {
          data: translationText,
          model: 'oraec-corpus-de',
          language: 'de',
          updated_at: new Date(),
        },
        created_at: new Date(),
        updated_at: new Date(),
      });
      await db.collection('pages').insertOne(pageDoc);

      const bookDoc = makeBookDoc({
        _id: bookId,
        id: bookIdStr,
        slug,
        title,
        author: origPlace ? `${origPlace} (${objectType})` : objectType,
        language: 'Egyptian hieroglyphs',
        original_language: 'Egyptian hieroglyphs',
        published: year ? String(year) : period || 'Unknown',
        categories: [],
        collections: ['middle-east-africa', 'ancient-egyptian'],
        pages_count: 1,
        pages_ocr: 1,
        pages_translated: 1,
        dublin_core: {
          dc_identifier: [`oraec:${oraecId}`],
          dc_source: `https://oraec.github.io/corpus/${oraecId}.html`,
        },
        image_source: {
          provider: 'oraec',
          provider_name: 'ORAEC (Open Richly Annotated Egyptian Corpus)',
          source_url: `https://oraec.github.io/corpus/${oraecId}.html`,
          identifier: oraecId,
          license: text.credits?.license || 'cc-by-sa-4.0',
          contributing_library: 'Berlin-Brandenburgische Akademie der Wissenschaften',
          access_date: new Date(),
        },
        field_provenance: {
          title: { source: 'oraec', method: 'import', confidence: 1.0, date: new Date() },
          author: { source: 'oraec', method: 'import', confidence: 0.8, date: new Date() },
          language: { source: 'oraec', method: 'import', confidence: 1.0, date: new Date() },
        },
        oraec_id: oraecId,
        oraec_object_type: objectType,
        oraec_period: period,
        oraec_origplace: origPlace,
        oraec_bibliography: text.bibliography || null,
        oraec_sentence_count: contentSentences.length,
        status: 'published',
        hidden: false,
        visible: true,
        pipeline_auto: {
          status: 'translate_complete',
          source: 'import',
          queued_at: new Date(),
          started_at: new Date(),
          completed_at: new Date(),
          last_updated: new Date(),
        },
        source_fingerprint: `oraec:${oraecId}`,
        normalized_title: normalizedT,
        normalized_author: normalizeAuthor(author),
        created_at: new Date(),
        updated_at: new Date(),
      });

      try {
        await db.collection('books').insertOne(bookDoc);
      } catch (bookErr) {
        // Roll back the orphan page so we don't litter the pages collection
        await db.collection('pages').deleteOne({ _id: pageId }).catch(() => {});
        throw bookErr;
      }

      imported++;
      totalSentences += contentSentences.length;
      importedIds.push(bookIdStr);
      process.stdout.write(`  [${imported}/${LIMIT}] ${title.slice(0, 60)} — ${contentSentences.length} sentences\n`);

    } catch (err) {
      console.error(`  ERROR importing ${oraecId}: ${err.message?.slice(0, 80)}`);
      errors++;
    }
  }

  console.log(`\nDone: ${imported} imported, ${dupes} dupes, ${skipped} skipped (too short), ${errors} errors`);
  console.log(`Total sentences imported: ${totalSentences}`);

  if (importedIds.length > 0) {
    console.log(`\nImported book IDs:\n${importedIds.join('\n')}`);
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
