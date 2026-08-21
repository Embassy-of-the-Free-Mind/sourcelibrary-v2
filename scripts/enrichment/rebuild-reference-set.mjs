#!/usr/bin/env node
/**
 * rebuild-reference-set.mjs — rebuild the reference set from zero, and PROVE it. (#3556)
 *
 * WHY THIS EXISTS
 * ---------------
 * The reference set is the evidence under every first-translation claim, and its
 * measured recall (27%) is the most-cited number in this subsystem. On 2026-08-04
 * it emerged that the *inputs* to that number — the LoC extract and the Wikidata
 * rows — existed **only inside one session's private git worktree**. Not in the
 * repo (too large), not on the pipeline box, not anywhere shared. A single
 * `git worktree remove` would have destroyed the artifacts behind the governing
 * figure, and nothing would have reported it: the Mongo collection would have sat
 * there looking complete while being unreproducible.
 *
 * So: one command that rebuilds both sources from their origins and then VERIFIES
 * the result against the destination rather than against its own log.
 *
 * THE THREE FAILURES THIS GUARDS, ALL OBSERVED IN ONE AFTERNOON
 * ------------------------------------------------------------
 *  1. A DOCUMENTED COMMAND THAT WRITES NOTHING. The runbook said
 *     `--parts 1-43 --keep-gz`. `--keep-gz` only retains downloads; **`--load` is
 *     what writes Mongo.** Following the instructions extracted 126,558 rows to
 *     disk and wrote zero, with a success-looking log.
 *  2. A PARTIAL LOAD THAT LOOKS COMPLETE. `withMongo`'s 300s watchdog killed the
 *     load at part 30 of 43, leaving 120,976 of 126,558 rows and exit code 0. A
 *     short reference set does not error — it fails to find priors, which reads as
 *     `none_found`, which reads as "first translation".
 *  3. A BLOCKED SOURCE THAT RETURNS HTTP 200. loc.gov sits behind a Cloudflare bot
 *     challenge; from a datacenter IP every part returns a 403 HTML page. The
 *     ingest's gzip check catches it, but only because it fails closed.
 *
 * ⚠️ RESIDENTIAL IP REQUIRED. loc.gov challenges datacenter traffic — all 43 parts
 * fail from the Hetzner box with `cf-mitigated: challenge`. **This must be run
 * from a residential connection.** That is not a preference; it is why the extract
 * cannot simply live on the pipeline box, and it is the reason these artifacts
 * kept ending up on someone's laptop in the first place.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/enrichment/rebuild-reference-set.mjs            # verify only
 *   node scripts/enrichment/rebuild-reference-set.mjs --rebuild  # re-derive, then verify
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';

/**
 * Run the body only when EXECUTED, never when imported.
 *
 * Without this, importing `verifyReferenceSet` for a unit test runs the whole
 * verification — and with `--rebuild` would re-download 3GB from loc.gov. The
 * sibling script `ingest-loc-bulk.mjs` documents the identical trap (#3563); it
 * was reintroduced here and caught by the tests failing to load at all.
 */
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const REBUILD = process.argv.includes('--rebuild');
const OUT = path.join(process.cwd(), 'scripts', 'output');
const LOC_DIR = path.join(OUT, 'loc-bulk');
const WD_DIR = path.join(OUT, 'wikidata');

const run = (args, label) => {
  console.log(`\n─── ${label} ───`);
  const r = spawnSync('node', args, { stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    console.error(`\n${label} FAILED (exit ${r.status}).`);
    if (label.includes('LoC')) {
      console.error('If every part failed a gzip integrity check, loc.gov served a');
      console.error('Cloudflare challenge — you are on a datacenter IP. Re-run from a');
      console.error('residential connection. See the header of this file.');
    }
    process.exit(1);
  }
};

/**
 * THE VERIFICATION. Pure, so it can be tested against the real incidents.
 *
 * Read the DESTINATION, never the log. Every failure documented in this file's
 * header produced a log that looked like success; the only thing that
 * distinguished them was querying what actually landed.
 *
 * @param {{locFiles:number, locRows:number, wdRows:number, inMongo:number}} state
 * @returns {string[]} problems — empty means the set is usable
 */
export function verifyReferenceSet({ locFiles, locRows, wdRows, inMongo }) {
  const problems = [];
  if (locFiles !== 43) problems.push(`LoC extract has ${locFiles} of 43 parts — INCOMPLETE`);
  if (locRows === 0) problems.push('LoC extract is empty — nothing was derived');
  if (wdRows === 0) {
    problems.push('Wikidata extract is empty — the search will run LoC-only, which is a '
      + 'DIFFERENT baseline (25.8%, not 27.0%) and not comparable to the published figure');
  }
  // The load-truncation guard. Fires on the exact 2026-08-04 state: 120,976 in
  // Mongo against a 126,558-row extract, after the watchdog killed the load at
  // part 30 of 43 with exit code 0.
  if (locRows && inMongo < locRows) {
    problems.push(
      `Mongo holds ${inMongo.toLocaleString()} but the extract has ${locRows.toLocaleString()} `
      + `— ${(locRows - inMongo).toLocaleString()} rows never loaded. Re-run with --load; `
      + 'a short reference set does not error, it silently reports `none_found`.',
    );
  }
  return problems;
}

/** Count JSONL rows on disk. This is the SOURCE side of the verification. */
async function countJsonl(dir) {
  if (!fs.existsSync(dir)) return { files: 0, rows: 0 };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  let rows = 0;
  for (const f of files) {
    const rl = readline.createInterface({
      input: fs.createReadStream(path.join(dir, f)), crlfDelay: Infinity,
    });
    for await (const line of rl) if (line.trim()) rows++;
  }
  return { files: files.length, rows };
}

if (IS_MAIN) {
if (REBUILD) {
  // `--load` is NOT optional. Without it this extracts to disk and writes nothing.
  run(['scripts/enrichment/ingest-loc-bulk.mjs', '--parts', '1-43', '--load'], 'LoC MDSConnect bulk');
  run(['scripts/enrichment/ingest-wikidata-translations.mjs', '--out', WD_DIR], 'Wikidata P629');
}

const loc = await countJsonl(LOC_DIR);
const wd = await countJsonl(WD_DIR);

await withMongo(async (db) => {
  const rt = db.collection('reference_translations');
  const inMongo = await rt.countDocuments({});
  const bilingual = await rt.countDocuments({ bilingual: true });

  console.log('\n─── Reference set ───────────────────────────────────────────');
  console.log(`  LoC extract on disk   : ${loc.rows.toLocaleString()} rows in ${loc.files} file(s)`);
  console.log(`  Wikidata on disk      : ${wd.rows.toLocaleString()} rows in ${wd.files} file(s)`);
  console.log(`  reference_translations: ${inMongo.toLocaleString()} (Mongo)`);
  console.log(`  ...bilingual          : ${bilingual.toLocaleString()}`);

  const problems = verifyReferenceSet({
    locFiles: loc.files, locRows: loc.rows, wdRows: wd.rows, inMongo,
  });

  if (problems.length) {
    console.log('\n  ❌ NOT USABLE:');
    for (const p of problems) console.log(`     - ${p}`);
    console.log('\n  Do NOT quote recall or coverage from this state.');
    process.exitCode = 1;
    return;
  }
  console.log('\n  ✅ Extract and Mongo agree. Reference set is usable.');
  console.log('     Next: ft-reference-set-search.mjs --cohort badged|inverse --apply');
  console.log('           ft-reference-set-recall.mjs');
},
// A full verification walks the whole collection; the 300s watchdog would kill it
// mid-count and report a mismatch that is an artifact of its own timeout.
{ noTimeout: true });
}
