#!/usr/bin/env node
/**
 * ft-reference-set-recall.mjs — how much is a `none_found` actually worth? (#3459)
 *
 * The whole design rests on asserting absence against a stated reference set.
 * That is only honest if we know the set's RECALL — how often it finds a
 * translation that genuinely exists. Until this script there was no such
 * measurement, and every `none_found` was reported as though the set were
 * complete.
 *
 * `translation_classification` (9,908 rows, built Feb–Jul 2026) is an independent
 * answer to the same question, with NAMED translators — Peterson's *Arbatel*,
 * Goold's Loeb *Astronomica*, Manzalaoui's *Secretum Secretorum*. Books it marks
 * `previously_translated` are known positives, so they are a ready-made test set.
 *
 * THE CIRCULARITY, AND WHY THIS SCRIPT REPORTS TWO NUMBERS
 * -------------------------------------------------------
 * `translation_classification` is now also a SOURCE in the reference set, which
 * was the single highest-value recall fix available. But it is the yardstick as
 * well, and a yardstick built into the thing it measures reads 100% by
 * construction — it would say the search finds every prior it was handed the
 * answer to. That number is worthless and must never be quoted.
 *
 * So the honest measure is CATALOGUE-ONLY recall: re-derive each verdict from the
 * candidates that came from the external bibliographic catalogues alone —
 * whatever `CATALOGUE_SOURCES` currently lists — and ask how often those
 * catalogues independently surface a prior we know exists. It is the number that
 * moves when the matcher genuinely improves, or when a source is added.
 *
 * Measured baselines, so a run can be read against its own history:
 *   22.0%  2026-07-31  LoC + Wikidata, before MARC 240 containment
 *   27.0%  2026-08-01  after 240 uniform-title containment (#3459)
 *   32.1%  2026-08-07  after adding ESTC (#3522) — 22,538 rows, +16% set size,
 *                      contributing 8,325 candidates across 986 efforts
 *
 * ⚠️ ADDING A SOURCE MEANS ADDING IT TO `CATALOGUE_SOURCES`. Leaving it out
 * computes "catalogue-only" over a definition that excludes the catalogue you
 * just added, so the number cannot move and reads as "that source contributed
 * nothing." The printed header is derived from the set for the same reason.
 *
 * The combined figure is still worth printing, because it is what an effort
 * actually says about a book today — but it measures COVERAGE (do we hold any
 * evidence at all), not recall (can the catalogues find evidence on their own).
 * Reporting one as the other is the mistake in the name of a metric being a claim
 * about its denominator.
 *
 * MEASURED 2026-08-01, over the 607 known-prior books both cohorts examined:
 *
 *     catalogue-only, all bases        162 surfaced / 439 none_found   27.0%
 *     catalogue-only, no 245 confirm   133 surfaced / 468 none_found   22.1%   (the old ceiling)
 *     LoC alone                        155 surfaced / 446 none_found   25.8%
 *     Wikidata alone                    46 surfaced / 555 none_found    7.7%
 *     combined, incl. classification   607 surfaced /   0 none_found  100.0%   (CIRCULAR — not recall)
 *
 * So the whole of the 22% → 27% movement came from letting the 245 display title
 * confirm under author corroboration, i.e. from the 240 ceiling. Adding
 * `translation_classification` did not raise recall at all and could not: it is a
 * join on our own book and work ids, so it resolves the 607 books we already had
 * an answer for and reaches nothing beyond them. It is worth having — those books
 * now carry their prior instead of a false clean negative — but it is COVERAGE.
 *
 * Three of every four known prior translations are still invisible to the
 * catalogues. `none_found` remains weak evidence and no count built on it should
 * be quoted.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-reference-set-recall.mjs [--date 2026-08-01]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';
import { deriveVerdict, VERDICT } from '../lib/search-effort.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');

const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };

/**
 * Newest run per cohort. Reading a stale file would compare a fresh matcher
 * against an old one's verdicts and report the difference as recall.
 */
function latestRun(cohort) {
  const explicit = argOf('--date');
  const files = fs.readdirSync(OUT_DIR)
    .filter((f) => new RegExp(`^ft-reference-set-search-${cohort}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(f))
    .filter((f) => !explicit || f.includes(explicit))
    .sort();
  if (!files.length) throw new Error(`no ${cohort} run found in ${OUT_DIR} — run ft-reference-set-search.mjs --cohort ${cohort}`);
  return path.join(OUT_DIR, files[files.length - 1]);
}

/**
 * What counts as a CATALOGUE for the governing recall figure.
 *
 * The distinction is provenance, not usefulness: a catalogue is an external
 * bibliographic authority we did not write. `translation_classification` is
 * deliberately absent because it is our own model's output over our own books —
 * including it makes the yardstick a subset of the thing it measures and returns
 * exactly 100.0%, which is circular rather than good.
 *
 * ⚠️ ADDING A SOURCE TO THE SEARCH MEANS ADDING IT HERE. ESTC (#3522) is a
 * national short-title catalogue and belongs in this set; leaving it out would
 * have computed "catalogue-only recall" over a definition that excluded the
 * catalogue just added, so 22,538 new rows would have moved the number by
 * exactly zero and read as "ESTC contributed nothing". Same family as the
 * yardstick-inside-the-set trap above, inverted.
 */
const CATALOGUE_SOURCES = new Set(['loc_mdsconnect', 'wikidata', 'estc']);

const runs = ['inverse', 'badged'].map((c) => ({ cohort: c, file: latestRun(c) }));
for (const r of runs) console.log(`  ${r.cohort.padEnd(8)} ${path.basename(r.file)}`);

const efforts = runs.flatMap((r) => JSON.parse(fs.readFileSync(r.file, 'utf8')).efforts);
const byBook = new Map(efforts.map((e) => [e.book_id, e]));

/** Verdict using only candidates from the named sources. */
const verdictFrom = (effort, keep) => deriveVerdict({
  candidates: effort.candidates.filter((c) => keep(c)),
  searchable: effort.searchable,
});

/** A verdict that surfaced something — anything other than a clean negative. */
const SURFACED = new Set([VERDICT.PRIOR_FOUND, VERDICT.ONLY_PARTIAL_FOUND, VERDICT.INCONCLUSIVE]);

await withMongo(async (db) => {
  const known = await db.collection('translation_classification')
    .find({ classification: 'previously_translated' },
      { projection: { book_id: 1, title: 1, known_translation: 1 } })
    .toArray();
  console.log(`\nbooks INDEPENDENTLY classified previously_translated: ${known.length}`);

  const checked = known.filter((k) => byBook.has(k.book_id));
  console.log(`  ...that the search also examined: ${checked.length}\n`);

  const report = (label, keep, note) => {
    const tally = {};
    let surfaced = 0;
    let missed = 0;
    for (const k of checked) {
      const v = verdictFrom(byBook.get(k.book_id), keep);
      tally[v] = (tally[v] || 0) + 1;
      if (SURFACED.has(v)) surfaced++;
      else if (v === VERDICT.NONE_FOUND) missed++;
    }
    const pct = surfaced + missed ? ((surfaced / (surfaced + missed)) * 100).toFixed(1) : 'n/a';
    console.log(`─── ${label} ${'─'.repeat(Math.max(0, 56 - label.length))}`);
    console.log(`  verdicts            : ${JSON.stringify(tally)}`);
    console.log(`  surfaced a candidate: ${surfaced}`);
    console.log(`  reported none_found : ${missed}   <- FALSE NEGATIVES`);
    console.log(`  RECALL              : ${pct}%`);
    console.log(`  ${note}\n`);
    return pct;
  };

  // The label is DERIVED from the set, never hand-written. A hard-coded
  // "(LoC + Wikidata)" survived the addition of ESTC and printed a header that
  // named two sources while the number behind it counted three — the exact trap
  // this subsystem keeps hitting: a metric's name is a claim about its
  // denominator, and a stale name is a false claim. Anyone reading that output
  // would have concluded ESTC contributed nothing.
  const catalogueNames = [...CATALOGUE_SOURCES]
    .map((s) => ({ loc_mdsconnect: 'LoC', wikidata: 'Wikidata', estc: 'ESTC' }[s] ?? s))
    .join(' + ');

  const catalogue = report(
    `CATALOGUE-ONLY (${catalogueNames}) — the honest number`,
    (c) => CATALOGUE_SOURCES.has(c.source),
    'Baselines: 22.0% (2026-07-31, LoC+Wikidata pre-240) → 27.0% (2026-08-01, after MARC 240\n'
    + '  uniform-title containment) → this run. This is the one to quote.',
  );

  report(
    'COMBINED (incl. translation_classification) — CIRCULAR',
    () => true,
    'NOT a recall figure: the yardstick is inside the set being measured. It says\n'
    + '  how many of these books an effort now holds any evidence for — coverage, not recall.',
  );

  console.log('─── What a `none_found` is worth ─────────────────────────────');
  console.log(`  Catalogue recall is ${catalogue}%. A none_found remains WEAK evidence:`);
  console.log('  it is a statement about this set on this date, never about the world.');
  console.log('  Positive findings are unaffected — poor recall cannot manufacture a');
  console.log('  false positive, so the verified demotes stand on their own.');
}, { noTimeout: true });
