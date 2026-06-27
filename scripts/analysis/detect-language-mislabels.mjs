#!/usr/bin/env node
/**
 * detect-language-mislabels.mjs — REPORT-ONLY language-mislabel detector (#2780)
 *
 * Some books are tagged `language: 'English'` (en/eng/...) but are actually
 * non-English works. The bug has two harms:
 *   (1) it risks a wrong FT demote if anyone treats language=English as
 *       "English original";
 *   (2) it wrongly EXCLUDES them from the FT-eligible census denominator
 *       (eligibility = readable + non-English `language`).
 * Correcting `language` KEEPS the first-translation badge and fixes the count.
 * This script NEVER touches the badge and NEVER writes — it only reports.
 *
 * For each English-tagged book, the likely TRUE source language is inferred,
 * in priority order:
 *   (a) `original_language` if set and non-English  -> HIGH confidence
 *   (b) an explicit cataloguer prefix `[Hebrew: ...]` / `[Greek:] ...`
 *                                                     -> MEDIUM confidence
 *   (c) a non-Latin script in the title (Hebrew/Greek/Cyrillic/Arabic/CJK/...)
 *                                                     -> LOW confidence
 *                                                        (title-script inferred)
 *   (d) no signal                                      -> AMBIGUOUS / needs-review
 *       (could be a genuine English original — left alone)
 *
 * Output: scripts/output/ft-language-mislabel-<date>.{json,md}
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/analysis/detect-language-mislabels.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../lib/mongo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');

// "English" in all the forms the corpus uses.
const ENGLISH_TAGS = ['en', 'eng', 'English', 'english', 'en-US', 'en-GB'];
const ENGLISH_SET = new Set(ENGLISH_TAGS.map((s) => s.toLowerCase()));

function isEnglishValue(v) {
  if (!v) return false;
  return ENGLISH_SET.has(String(v).trim().toLowerCase());
}

// Cataloguer prefix like "[Hebrew: ...]" or "[Greek:] ...".
const PREFIX_RE =
  /^\s*\[\s*(Hebrew|Greek|Arabic|Sanskrit|Chinese|Syriac|Coptic|Cyrillic|Russian|Japanese|Korean|Tibetan|Persian|Latin|Aramaic|Ethiopic|Ge'ez|Geez|Armenian|Georgian)\b/i;

// Unicode-script blocks -> a coarse language guess. Title-script is the weakest
// signal: a CJK string in parentheses ("浮生六记") next to an English title is a
// genuine English translation, so this is LOW confidence only.
const SCRIPT_BLOCKS = [
  { name: 'Hebrew', re: /[֐-׿יִ-ﭏ]/ },
  { name: 'Greek', re: /[Ͱ-Ͽἀ-῿]/ },
  { name: 'Cyrillic', re: /[Ѐ-ӿ]/ },
  { name: 'Arabic', re: /[؀-ۿݐ-ݿ]/ },
  { name: 'Syriac', re: /[܀-ݏ]/ },
  { name: 'Chinese', re: /[一-鿿㐀-䶿]/ },
  { name: 'Japanese', re: /[぀-ヿ]/ }, // hiragana/katakana
  { name: 'Korean', re: /[가-힯]/ },
  { name: 'Devanagari', re: /[ऀ-ॿ]/ }, // Sanskrit/Hindi
  { name: 'Tibetan', re: /[ༀ-࿿]/ },
  { name: 'Armenian', re: /[԰-֏]/ },
  { name: 'Georgian', re: /[Ⴀ-ჿ]/ },
];

// Devanagari script -> Sanskrit is the historically-correct default for this
// corpus (overwhelmingly Sanskrit, not modern Hindi).
const SCRIPT_TO_LANGUAGE = { Devanagari: 'Sanskrit' };

function scriptLanguage(title) {
  if (!title) return null;
  for (const { name, re } of SCRIPT_BLOCKS) {
    if (re.test(title)) return SCRIPT_TO_LANGUAGE[name] || name;
  }
  return null;
}

function prefixLanguage(title) {
  if (!title) return null;
  const m = title.match(PREFIX_RE);
  if (!m) return null;
  let lang = m[1];
  if (/^ge'?ez$/i.test(lang)) lang = "Ge'ez";
  // Title-cased canonical form.
  return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase().replace(/^ge'ez$/i, "Ge'ez");
}

function classify(book) {
  const ol = book.original_language;

  // (a) original_language non-English -> HIGH confidence, unambiguous.
  if (ol && String(ol).trim() && !isEnglishValue(ol)) {
    return {
      proposed: String(ol).trim(),
      signal: 'original_language',
      confidence: 'high',
    };
  }

  // (b) cataloguer prefix -> MEDIUM.
  const pref = prefixLanguage(book.title);
  if (pref) {
    return { proposed: pref, signal: 'title-prefix', confidence: 'medium' };
  }

  // (c) non-Latin title script -> LOW.
  const scr = scriptLanguage(book.title);
  if (scr) {
    return { proposed: scr, signal: 'title-script', confidence: 'low' };
  }

  // (d) no signal -> needs review (could be a genuine English original).
  return { proposed: null, signal: 'none', confidence: 'ambiguous' };
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const rows = [];
  const summary = {
    date,
    total_english_tagged: 0,
    by_confidence: {},
    by_proposed_language: {},
    badged_total: 0,
    badged_mislabel: { high: 0, medium: 0, low: 0 },
    denominator_impact_note: '',
  };

  await withMongo(
    async (db) => {
      const cursor = db
        .collection('books')
        .find({ language: { $in: ENGLISH_TAGS } })
        .project({
          id: 1,
          title: 1,
          language: 1,
          original_language: 1,
          is_first_translation: 1,
        });

      for await (const book of cursor) {
        summary.total_english_tagged += 1;
        const badged = book.is_first_translation === true;
        if (badged) summary.badged_total += 1;

        const { proposed, signal, confidence } = classify(book);

        summary.by_confidence[confidence] =
          (summary.by_confidence[confidence] || 0) + 1;

        // Only mislabel candidates (proposed != null) count as "would change".
        if (proposed) {
          summary.by_proposed_language[proposed] =
            (summary.by_proposed_language[proposed] || 0) + 1;
          if (badged && summary.badged_mislabel[confidence] !== undefined) {
            summary.badged_mislabel[confidence] += 1;
          }
        }

        rows.push({
          id: book.id,
          mongo_id: String(book._id),
          title: book.title || '',
          current_language: book.language,
          proposed_language: proposed,
          signal,
          confidence,
          is_first_translation: badged,
        });
      }
    },
    { timeoutMs: 180000 },
  );

  // Sort: high first, then medium, low, ambiguous; within each by language.
  const order = { high: 0, medium: 1, low: 2, ambiguous: 3 };
  rows.sort(
    (a, b) =>
      (order[a.confidence] ?? 9) - (order[b.confidence] ?? 9) ||
      String(a.proposed_language).localeCompare(String(b.proposed_language)),
  );

  const highMislabels = rows.filter(
    (r) => r.confidence === 'high' && r.proposed_language,
  );
  summary.denominator_impact_note =
    `${highMislabels.length} high-confidence mislabels would move from the ` +
    `English bucket into a non-English bucket — adding them to the ` +
    `FT-eligible census denominator (readable + non-English) and removing ` +
    `the risk of a wrong "English original" FT demote. ` +
    `${summary.badged_mislabel.high} of them are currently FT-badged.`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `ft-language-mislabel-${date}.json`);
  const mdPath = path.join(OUT_DIR, `ft-language-mislabel-${date}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify({ summary, rows }, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(summary, rows));

  // ---- console report --------------------------------------------------
  console.log('\n=== Language-mislabel detector (#2780) ===');
  console.log(`English-tagged books scanned: ${summary.total_english_tagged}`);
  console.log('\nBy confidence:');
  for (const [k, v] of Object.entries(summary.by_confidence)) {
    console.log(`  ${k.padEnd(10)} ${v}`);
  }
  console.log('\nMislabel candidates by proposed language (top 20):');
  const langSorted = Object.entries(summary.by_proposed_language).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [lang, n] of langSorted.slice(0, 20)) {
    console.log(`  ${String(lang).padEnd(20)} ${n}`);
  }
  console.log('\n--- Buckets (the spec asks these be explicit) ---');
  const high = rows.filter((r) => r.confidence === 'high').length;
  const med = rows.filter((r) => r.confidence === 'medium').length;
  const low = rows.filter((r) => r.confidence === 'low').length;
  const amb = rows.filter((r) => r.confidence === 'ambiguous').length;
  console.log(`  HIGH  (non-English original_language) : ${high}`);
  console.log(`  MED   (cataloguer [Lang:] prefix)     : ${med}`);
  console.log(`  LOW   (title-script inferred)         : ${low}`);
  console.log(`  AMBIG (no signal / leave as English)  : ${amb}`);
  console.log('\nDenominator / badge impact:');
  console.log(`  Currently FT-badged English-tagged    : ${summary.badged_total}`);
  console.log(`  ... that are HIGH-conf mislabels       : ${summary.badged_mislabel.high}`);
  console.log(`  ... that are MED-conf mislabels        : ${summary.badged_mislabel.medium}`);
  console.log(`  ... that are LOW-conf mislabels        : ${summary.badged_mislabel.low}`);
  console.log(`\n${summary.denominator_impact_note}`);
  console.log(`\nWrote:\n  ${jsonPath}\n  ${mdPath}`);
  console.log(
    '\nNEXT: review the report, then run (gated on Derek):\n' +
      `  node scripts/maintenance/fix-language-mislabels.mjs ${jsonPath} --apply`,
  );
}

function renderMarkdown(summary, rows) {
  const L = [];
  L.push(`# Language-mislabel report (#2780) — ${summary.date}`);
  L.push('');
  L.push(
    'Books tagged `language: English` that are actually non-English works. ' +
      'Fixing `language` KEEPS any first-translation badge and corrects the ' +
      'FT-eligible census denominator. **Nothing here demotes a badge.**',
  );
  L.push('');
  L.push(`- English-tagged books scanned: **${summary.total_english_tagged}**`);
  L.push(`- Currently FT-badged: **${summary.badged_total}**`);
  L.push('');
  L.push('## Buckets by confidence');
  L.push('| Confidence | Signal | Count |');
  L.push('|---|---|---|');
  L.push(`| high | non-English \`original_language\` | ${summary.by_confidence.high || 0} |`);
  L.push(`| medium | cataloguer \`[Lang:]\` title prefix | ${summary.by_confidence.medium || 0} |`);
  L.push(`| low | non-Latin title script | ${summary.by_confidence.low || 0} |`);
  L.push(`| ambiguous | no signal (left as English) | ${summary.by_confidence.ambiguous || 0} |`);
  L.push('');
  L.push('## Denominator / badge impact');
  L.push('');
  L.push(summary.denominator_impact_note);
  L.push('');
  L.push('## Mislabel candidates by proposed language');
  L.push('| Proposed language | Count |');
  L.push('|---|---|');
  for (const [lang, n] of Object.entries(summary.by_proposed_language).sort(
    (a, b) => b[1] - a[1],
  )) {
    L.push(`| ${lang} | ${n} |`);
  }
  L.push('');
  L.push('## Rows (high & medium confidence)');
  L.push('| id | title | current | proposed | signal | conf | FT |');
  L.push('|---|---|---|---|---|---|---|');
  for (const r of rows.filter(
    (r) => r.confidence === 'high' || r.confidence === 'medium',
  )) {
    const t = (r.title || '').slice(0, 70).replace(/\|/g, '\\|');
    L.push(
      `| ${r.id} | ${t} | ${r.current_language} | ${r.proposed_language} | ${r.signal} | ${r.confidence} | ${r.is_first_translation ? 'yes' : ''} |`,
    );
  }
  L.push('');
  return L.join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
