#!/usr/bin/env node
/**
 * Tier-0 candidate classification (#2447 workstream 5).
 *
 * Deterministic, zero-cost enrichment of import_candidates — NO model calls.
 * Writes a `classification` sub-document with provenance. Three signals:
 *
 *   1. record_type (serial | monograph | unknown) — from IA collection
 *      membership. This is the census-denominator fix: ~70% of the "Chinese"
 *      pool is newspaper *issues* in serial collections, not monographs.
 *      (Measured 2026-06-08: 9 umbrella serial collections cover 49.4% of the
 *      whole IA pool; a small newspaper-archive regex adds ~0.5% more.)
 *
 *   2. script (Latin | Han | Devanagari | …) — from TITLE codepoint ranges.
 *      Script is reliably detectable from characters; language is NOT (a
 *      Devanagari string may be Sanskrit/Hindi/Marathi). Script ≠ language —
 *      this is a feature for later tiers, never a verdict.
 *
 *   3. language_iso — passthrough of the existing freetext `language` tag,
 *      normalized to ISO 639. LOW CONFIDENCE (IA tags are noisy and titles
 *      are often English descriptions of non-English books); source is
 *      recorded as 'ia-tag' so later tiers (GlotLID/Gemini) can override.
 *
 * Later tiers (USTC join, OpenLibrary join, GlotLID-on-OCR, Gemini) refine
 * these and set higher-confidence sources. This pass never overwrites a
 * higher-confidence classification.
 *
 * Scope: IA-sourced candidates (source: 'ia_language') — the only ones with
 * IA collection membership. Other sources get script + language_iso only.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/iiif-discovery/classify-candidates.mjs --dry-run
 *   node scripts/iiif-discovery/classify-candidates.mjs            # apply
 *   node scripts/iiif-discovery/classify-candidates.mjs --source=ia_language
 *
 * Options:
 *   --dry-run        Report the distribution, write nothing
 *   --source=xxx     Restrict to one source (default: all)
 *   --recompute      Re-classify rows already carrying classification.method
 *                    == this version (default: skip them — idempotent resume)
 */

import { withMongo } from '../lib/mongo.mjs';

const METHOD = 'tier0-collection-rule-v1';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  })
);
const DRY_RUN = 'dry-run' in args;
const SOURCE = args.source || null;
const RECOMPUTE = 'recompute' in args;

// ── Serial signal ──────────────────────────────────────────────────────────
// Umbrella collections (do the work — measured to cover 49.4% of the IA pool).
const SERIAL_COLLECTIONS = new Set([
  'newspapers', 'newsstand', 'eastasia-periodicals', 'periodicals',
  'journals', 'magazine_rack', 'newspapers_miscellaneous',
  'sim_microfilm', 'microfilm',
]);
// Safety net for newspaper sub-collections not under an umbrella (~0.5% extra):
// Chinese paper morphemes only (ribao 日报, wanbao 晚报, shibao 時報, bao 報 …).
// Do NOT match a bare `-archive` suffix — it over-matches non-newspaper text
// collections (e.g. `suvratsut-archive` = Suvrat Sutra, a Sanskrit scripture
// set; mis-tagged 765 Upanishads/Puranas as "serial" in v1). The genuine
// Chinese newspaper `*-archive` collections are sub-collections of the
// `eastasia-periodicals` umbrella, so they're caught regardless.
const SERIAL_NAME_RE = /(ribao|wanbao|chenbao|shibao|zaobao|rikan|zhoubao|xunbao|yuebao|xinwen|xinbao)|bao-archive/i;

// Book/monograph-positive collections — membership here (when NOT serial)
// upgrades 'unknown' to 'monograph'.
const BOOK_COLLECTIONS = new Set([
  'internetarchivebooks', 'universallibrary', 'digitallibraryindia', 'JaiGyan',
  'europeanlibraries', 'americana', 'booksbylanguage', 'booksbylanguage_sanskrit',
  'booksbylanguage_chinese', 'booksbylanguage_latin', 'early-european-books',
  'wellcomelibrary', 'medicalheritagelibrary', 'folkscanomy', 'folkscanomy_historical_texts',
  'popularchinesebooks', 'indic-manuscripts', 'universityofarizona-ol', 'getty',
]);

function recordType(collections, source) {
  if (collections && collections.length) {
    for (const c of collections) {
      if (SERIAL_COLLECTIONS.has(c)) return ['serial', `umbrella:${c}`];
    }
    for (const c of collections) {
      if (SERIAL_NAME_RE.test(c)) return ['serial', `name-rule:${c}`];
    }
    for (const c of collections) {
      if (BOOK_COLLECTIONS.has(c)) return ['monograph', `book-collection:${c}`];
    }
    return ['unknown', 'no-typed-collection'];
  }
  // No IA collections. Every non-IA source is an institutional book/manuscript
  // harvester (BSB, Gallica, e-rara, Biblissima, Vatican, ISTC, SAT, …) — they
  // target single works, never periodical runs. Verified 2026-06-08: no non-IA
  // source carries serial signals (ia_microfilm's name notwithstanding — its
  // contents are microfilmed early *books*: Demosthenes, Aristotle, pamphlets).
  // Manuscripts (Biblissima/Vatican/Heidelberg) and canon texts (SAT/Dunhuang)
  // are single works → 'monograph' for the serial-vs-monograph census split.
  if (source && source !== 'ia_language') return ['monograph', 'harvester-default'];
  return ['unknown', 'no-collections'];
}

// ── Script detection from title codepoints ──────────────────────────────────
// Counts characters per script block; returns the dominant non-Latin script,
// or 'Latin' if Latin dominates. Returns null for empty/symbol-only titles.
function detectScript(title) {
  if (!title) return null;
  let han = 0, deva = 0, latin = 0, arabic = 0, cyrillic = 0, greek = 0,
    hebrew = 0, bengali = 0, telugu = 0, tamil = 0, tibetan = 0, kana = 0, other = 0;
  for (const ch of title) {
    const cp = ch.codePointAt(0);
    if (cp < 0x41) continue; // skip digits/punct/space
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0x24f)) latin++;
    else if ((cp >= 0x3040 && cp <= 0x30ff)) kana++;            // hiragana/katakana → Japanese tell
    else if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) han++;
    else if (cp >= 0x0900 && cp <= 0x097f) deva++;
    else if (cp >= 0x0600 && cp <= 0x06ff) arabic++;
    else if (cp >= 0x0400 && cp <= 0x04ff) cyrillic++;
    else if (cp >= 0x0370 && cp <= 0x03ff) greek++;
    else if (cp >= 0x0590 && cp <= 0x05ff) hebrew++;
    else if (cp >= 0x0980 && cp <= 0x09ff) bengali++;
    else if (cp >= 0x0c00 && cp <= 0x0c7f) telugu++;
    else if (cp >= 0x0b80 && cp <= 0x0bff) tamil++;
    else if (cp >= 0x0f00 && cp <= 0x0fff) tibetan++;
    else other++;
  }
  const scripts = [
    ['Han', han], ['Devanagari', deva], ['Arabic', arabic], ['Cyrillic', cyrillic],
    ['Greek', greek], ['Hebrew', hebrew], ['Bengali', bengali], ['Telugu', telugu],
    ['Tamil', tamil], ['Tibetan', tibetan], ['Kana', kana],
  ];
  const nonLatin = scripts.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  // Kana present at all → Japanese context (Han may be kanji, not Chinese)
  if (kana > 0 && han > 0) return 'Han+Kana';
  if (nonLatin.length && nonLatin[0][1] >= latin) return nonLatin[0][0];
  if (latin > 0) return 'Latin';
  if (nonLatin.length) return nonLatin[0][0];
  return null;
}

// ── Language → ISO 639 normalization ─────────────────────────────────────────
const LANG_ISO = {
  Latin: 'lat', Chinese: 'zho', Sanskrit: 'san', German: 'deu', French: 'fra',
  Italian: 'ita', Dutch: 'nld', English: 'eng', Spanish: 'spa', Greek: 'grc',
  Hebrew: 'heb', Arabic: 'ara', Russian: 'rus', Polish: 'pol', Portuguese: 'por',
  Swedish: 'swe', Danish: 'dan', Czech: 'ces', Hungarian: 'hun', Turkish: 'tur',
  Persian: 'fas', Japanese: 'jpn', Korean: 'kor', Syriac: 'syc', Coptic: 'cop',
  Hindi: 'hin', Marathi: 'mar', Tamil: 'tam', Bengali: 'ben', Telugu: 'tel',
  Tibetan: 'bod', Nepali: 'nep', Pali: 'pli',
};
function languageIso(language) {
  if (!language || language === 'Unknown') return null;
  return LANG_ISO[language] || null;
}

await withMongo(async (db) => {
  const col = db.collection('import_candidates');
  const filter = {};
  if (SOURCE) filter.source = SOURCE;
  if (!RECOMPUTE) filter['classification.method'] = { $ne: METHOD };

  const total = await col.countDocuments(filter);
  console.log(`\n=== Tier-0 classification (${METHOD}) ===`);
  console.log(`Candidates to classify: ${total.toLocaleString()}${SOURCE ? ` (source=${SOURCE})` : ''}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  const cursor = col.find(filter, {
    projection: { title: 1, language: 1, 'metadata.collections': 1, source: 1 },
  });

  const tally = { record_type: {}, script: {}, language_iso: {} };
  let bulk = [];
  let processed = 0;

  for await (const doc of cursor) {
    const [rt, rtReason] = recordType(doc.metadata?.collections, doc.source);
    const script = detectScript(doc.title);
    const iso = languageIso(doc.language);

    tally.record_type[rt] = (tally.record_type[rt] || 0) + 1;
    tally.script[script || 'none'] = (tally.script[script || 'none'] || 0) + 1;
    tally.language_iso[iso || 'none'] = (tally.language_iso[iso || 'none'] || 0) + 1;

    if (!DRY_RUN) {
      bulk.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              classification: {
                record_type: rt,
                record_type_reason: rtReason,
                record_type_source: 'ia-collection-rule',
                script,
                language_iso: iso,
                language_iso_source: 'ia-tag', // low confidence — later tiers override
                method: METHOD,
                classified_at: new Date(),
              },
            },
          },
        },
      });
      if (bulk.length >= 2000) {
        await col.bulkWrite(bulk, { ordered: false });
        bulk = [];
      }
    }
    processed++;
    if (processed % 200000 === 0) console.log(`  …${processed.toLocaleString()} processed`);
  }
  if (!DRY_RUN && bulk.length) await col.bulkWrite(bulk, { ordered: false });

  const pct = (n) => `${n.toLocaleString()} (${(n / processed * 100).toFixed(1)}%)`;
  console.log(`\nProcessed: ${processed.toLocaleString()}`);
  console.log('\n--- record_type ---');
  for (const [k, v] of Object.entries(tally.record_type).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(10)} ${pct(v)}`);
  console.log('\n--- script (from title codepoints) ---');
  for (const [k, v] of Object.entries(tally.script).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${pct(v)}`);
  console.log('\n--- language_iso (from IA tag, low confidence) ---');
  for (const [k, v] of Object.entries(tally.language_iso).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${k.padEnd(8)} ${pct(v)}`);
  console.log(DRY_RUN ? '\nDry run — nothing written. Re-run without --dry-run to apply.' : '\nWritten.');
}, { noTimeout: true });
