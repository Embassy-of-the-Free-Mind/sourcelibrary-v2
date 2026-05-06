#!/usr/bin/env node
/**
 * Pull a 100-row stratified sample from bph_works for hand-labeling the
 * "language pair" eval set. The eval is what we use to grade the Gemini
 * prompt before running it across all 24k rows — without it we have no way
 * to tell a 70% prompt from a 92% one.
 *
 * Stratification (by case, not proportional to corpus):
 *   30 hand-press works by named ancient/medieval authors  — exercises the
 *      "author tells you the original language" signal. Mix Greco-Roman,
 *      Arabic, medieval Latin so we don't only learn one branch.
 *   25 hand-press vernacular works (Paracelsus in German, English alchemy)
 *      — exercises the "language IS the original" branch.
 *   20 rows whose `editor` field is populated  — translator signal. Mix
 *      languages so we exercise more than one source→target pair.
 *   15 hand-press rows with non-obvious authors  — the medium-confidence
 *      bucket the prompt will struggle with most.
 *   10 edge cases: anonymous, missing author, multi-language strings,
 *      compilations.
 *
 * Output: one CSV with the model's input fields (everything we'll feed
 * Gemini) plus two empty columns for hand-labeling. Drop into a
 * spreadsheet, fill in `original_language` + `translation_target_language`
 * (NULL when same as edition language), save back as CSV. That's the
 * eval set.
 *
 * Usage:
 *   export DB_URL=$(secret-lover get SUPABASE_DB_URL | tail -1)
 *   node scripts/qa/sample-bph-language-eval.mjs --out eval.csv
 */

import pg from 'pg';
import { writeFileSync } from 'fs';
import { parseArgs } from 'util';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: 'bph-language-eval-unlabeled.csv' },
    seed: { type: 'string', default: '42' },
  },
});

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
  console.error('Missing DB_URL — export DB_URL=$(secret-lover get SUPABASE_DB_URL | tail -1) first.');
  process.exit(1);
}

// Authors whose original language is unambiguous — pulling a few of these per
// bucket grounds the eval against well-known cases the model should never miss.
const ANCIENT_GREEK = ['Aristoteles', 'Plato', 'Galenus', 'Hippocrates', 'Ptolemaeus', 'Hermes Trismegistus', 'Plotinus', 'Porphyrius', 'Iamblichus', 'Proclus'];
const ANCIENT_LATIN = ['Cicero', 'Seneca', 'Ovidius', 'Vergilius', 'Plinius', 'Boethius', 'Augustinus', 'Lucretius', 'Apuleius'];
const MEDIEVAL_ARABIC = ['Avicenna', 'Averroes', 'Geber', 'Albumasar', 'Alkindi', 'Rhazes'];
const VERNACULAR_GERMAN = ['Paracelsus', 'Böhme', 'Eckhart', 'Khunrath', 'Maier'];
const VERNACULAR_ENGLISH = ['Dee', 'Fludd', 'Ashmole', 'Vaughan', 'Newton'];

const inList = (col, list) =>
  `(${list.map(n => `${col} ILIKE '%${n.replace(/'/g, "''")}%'`).join(' OR ')})`;

async function main() {
  const c = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Reproducible random sample within each bucket. setseed needs to fire
  // before each random() call within a single transaction to be honored.
  const seed = parseFloat(args.seed) % 1 || 0.42;

  const buckets = [
    {
      name: 'ancient-greek-author',
      n: 10,
      where: `year IS NOT NULL AND year < 1800 AND ${inList('author', ANCIENT_GREEK)}`,
    },
    {
      name: 'ancient-latin-author',
      n: 10,
      where: `year IS NOT NULL AND year < 1800 AND ${inList('author', ANCIENT_LATIN)}`,
    },
    {
      name: 'medieval-arabic-author',
      n: 10,
      where: `year IS NOT NULL AND year < 1800 AND ${inList('author', MEDIEVAL_ARABIC)}`,
    },
    {
      name: 'vernacular-german-author',
      n: 15,
      where: `year IS NOT NULL AND year < 1800 AND ${inList('author', VERNACULAR_GERMAN)}`,
    },
    {
      name: 'vernacular-english-author',
      n: 10,
      where: `year IS NOT NULL AND year < 1800 AND ${inList('author', VERNACULAR_ENGLISH)}`,
    },
    {
      name: 'editor-populated',
      n: 20,
      where: `year IS NOT NULL AND year < 1800 AND editor IS NOT NULL AND length(editor) > 3`,
    },
    {
      name: 'less-famous-named-author',
      n: 15,
      where: `
        year IS NOT NULL AND year < 1800 AND author IS NOT NULL
        AND NOT ${inList('author', [
          ...ANCIENT_GREEK, ...ANCIENT_LATIN, ...MEDIEVAL_ARABIC,
          ...VERNACULAR_GERMAN, ...VERNACULAR_ENGLISH,
        ])}
      `,
    },
    {
      name: 'anonymous-or-missing-author',
      n: 5,
      where: `year IS NOT NULL AND year < 1800 AND (author IS NULL OR author = '' OR author ILIKE '%anon%')`,
    },
    {
      name: 'multilingual-or-compilation',
      n: 5,
      where: `year IS NOT NULL AND year < 1800 AND (language ILIKE '%,%' OR language ILIKE '%/%' OR language ILIKE '%and%' OR title ILIKE '%polyglot%' OR keywords ILIKE '%polyglot%')`,
    },
  ];

  const rows = [];
  for (const b of buckets) {
    await c.query(`SELECT setseed($1)`, [seed]);
    const sql = `
      SELECT
        ubn, title, parallel_title, author, variant_author, pseudonym,
        editor, variant_editor,
        language, year, place, printer, publisher, keywords,
        $1::text AS bucket
      FROM bph_works
      WHERE ${b.where}
      ORDER BY random()
      LIMIT ${b.n}
    `;
    const { rows: r } = await c.query(sql, [b.name]);
    console.log(`  ${b.name}: ${r.length}/${b.n}`);
    rows.push(...r);
  }
  await c.end();

  // Dedupe by UBN (a row could match multiple buckets, e.g. a Paracelsus
  // edition with an editor). Keep the first bucket it landed in.
  const seen = new Set();
  const deduped = rows.filter(r => {
    if (seen.has(r.ubn)) return false;
    seen.add(r.ubn);
    return true;
  });
  console.log(`Total: ${deduped.length} (deduped from ${rows.length})`);

  // CSV: input fields + two empty columns for the human label, plus a
  // "notes" column for the labeler to record reasoning on hard cases.
  const COLS = [
    'bucket', 'ubn', 'title', 'parallel_title', 'author', 'variant_author',
    'pseudonym', 'editor', 'variant_editor', 'language', 'year', 'place',
    'printer', 'publisher', 'keywords',
    'LABEL_original_language', 'LABEL_translation_target_language',
    'LABEL_confidence', 'LABEL_notes',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLS.join(',')];
  for (const r of deduped) {
    lines.push(COLS.map(c => esc(r[c])).join(','));
  }
  writeFileSync(args.out, lines.join('\n') + '\n');
  console.log(`Wrote ${args.out}`);
  console.log('');
  console.log('Next: open the CSV in a spreadsheet, fill in the LABEL_* columns');
  console.log('for each row. The LABEL_confidence column should be high|medium|low');
  console.log('reflecting how sure YOU are — not how sure a model would be. That');
  console.log('lets us cut the eval into a "high-bar" subset later.');
}

main().catch(err => { console.error(err); process.exit(1); });
