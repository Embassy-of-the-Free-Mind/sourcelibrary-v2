#!/usr/bin/env node
// Generate src/generated/ustc-year-counts.json for the ngram viewer's
// "Collection coverage" panel (issue #3214).
//
// One GROUP BY over the `ustc_editions` Supabase table (~1.6M dated editions,
// 1450-1744 — the Universal Short Title Catalogue's universe of European
// print), carrying the per-edition coverage flags the catalog-coverage build
// (scripts/catalog-coverage/build.mjs) maintains:
//   matched    — in_source_library: this exact USTC edition is held here
//   scanned    — has_iiif_scan: ANY open IIIF scan exists anywhere
//   translated — has_english_translation: an English translation exists anywhere
//
// The output is checked in: USTC's universe is static and the coverage flags
// move only when the (51-min, Hetzner) coverage build reruns, so the panel
// costs zero runtime queries. Re-run this script after a coverage rebuild and
// commit the diff.
//
// Usage (SUPABASE_DB_URL lives on Hetzner, not in the local env file):
//   SUPABASE_DB_URL=$(ssh root@46.224.122.120 "grep '^SUPABASE_DB_URL=' /root/sourcelibrary/.env.production.local | cut -d= -f2-") \
//     node scripts/analytics/ustc-year-counts.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..',
  'src', 'generated', 'ustc-year-counts.json',
);

// USTC is authoritative for European print 1450-1700; the dump runs to 1744.
// We store the full dump range — the UI decides what window to show.
const YEAR_MIN = 1450;
const YEAR_MAX = 1744;

if (!process.env.SUPABASE_DB_URL) {
  console.error('Set SUPABASE_DB_URL (see header for the Hetzner one-liner)');
  process.exit(1);
}

const { default: pg } = await import('pg');
const pgc = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await pgc.connect();
await pgc.query('SET statement_timeout = 0'); // PgBouncer: SET after connect

const { rows } = await pgc.query(`
  SELECT year,
         count(*)::int AS editions,
         count(*) FILTER (WHERE in_source_library)::int AS matched,
         count(*) FILTER (WHERE has_iiif_scan)::int AS scanned,
         count(*) FILTER (WHERE has_english_translation)::int AS translated
  FROM ustc_editions
  WHERE year IS NOT NULL
  GROUP BY year
  ORDER BY year
`);

// Per-language subsets keyed by NGRAM corpus id, so the panel can compare an
// original-language corpus against USTC's same-language editions (apples to
// apples). The `en` corpus (translations of EVERYTHING) deliberately has no
// subset — it reads against all of European print.
const USTC_LANG_TO_CORPUS = {
  Latin: 'la', German: 'de', French: 'fr', English: 'en-orig', Dutch: 'nl',
  Italian: 'it', Spanish: 'es', Greek: 'el', Portuguese: 'pt', Hebrew: 'he',
};
const { rows: langRows } = await pgc.query(`
  SELECT language_1 AS lang, year,
         count(*)::int AS editions,
         count(*) FILTER (WHERE in_source_library)::int AS matched
  FROM ustc_editions
  WHERE year IS NOT NULL AND language_1 = ANY($1)
  GROUP BY language_1, year
  ORDER BY language_1, year
`, [Object.keys(USTC_LANG_TO_CORPUS)]);

const { rows: [{ coverage_built_at }] } = await pgc.query(
  'SELECT max(coverage_built_at) AS coverage_built_at FROM ustc_editions',
);
await pgc.end();

// `year` may arrive as int or text depending on the dump's schema — coerce and
// drop anything non-numeric or outside the dump's range.
const years = rows
  .map(r => ({ ...r, year: Number(r.year) }))
  .filter(r => Number.isInteger(r.year) && r.year >= YEAR_MIN && r.year <= YEAR_MAX)
  .map(({ year, editions, matched, scanned, translated }) => ({ year, editions, matched, scanned, translated }));

const languages = {};
for (const r of langRows) {
  const year = Number(r.year);
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) continue;
  const corpusId = USTC_LANG_TO_CORPUS[r.lang];
  const entry = (languages[corpusId] ??= { label: r.lang, years: [] });
  entry.years.push({ year, editions: r.editions, matched: r.matched });
}

const sum = (k) => years.reduce((s, r) => s + r[k], 0);
const out = {
  generated_at: new Date().toISOString(),
  // When the in_source_library / has_iiif_scan / has_english_translation flags
  // were last rebuilt (scripts/catalog-coverage/build.mjs stamps every row).
  coverage_built_at: coverage_built_at ? new Date(coverage_built_at).toISOString() : null,
  year_min: YEAR_MIN,
  year_max: YEAR_MAX,
  total_editions: sum('editions'),
  total_matched: sum('matched'),
  total_scanned: sum('scanned'),
  total_translated: sum('translated'),
  years,
  languages,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote ${OUT}: ${years.length} years, ${out.total_editions.toLocaleString()} editions, ` +
  `${out.total_matched.toLocaleString()} matched in SL, coverage flags built ${out.coverage_built_at}`);
