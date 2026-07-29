#!/usr/bin/env node
/**
 * reproject-translation-catalogs.mjs — repair rows written without the shared
 * builder, so the matcher can actually see them.  (#3460)
 *
 * WHY
 * ---
 * `scripts/maintenance/ingest-ft-verify-results.mjs` used to insert its Sink-C
 * rows by spreading the raw ft-verify subagent object:
 *
 *     await registry.insertOne({ ...t, author_normalized: t.author.toLowerCase(), … })
 *
 * That bypassed `buildCatalogDoc()`, so those rows never got the derived fields
 * the Tier-0 matcher relies on, and — the binding defect — kept
 * `source_language` as a human display name ("Sanskrit", "Greek", "Latin")
 * instead of the ISO bucket ("sa", "grc", "la").
 *
 * `scripts/eval/ft-catalog-match.mjs` resolves the BOOK's language to an ISO
 * bucket and compares it against the catalog row's stored string, so a display
 * name can never match. Every affected row failed the SOURCE_LANG guard against
 * every book — measured 2026-07-29: 305 rows, ALL of `source:
 * 'claude_subagent_verify'`, carrying 213 of the catalogue's 385
 * `completeness: 'complete'` rows (55% of the only rows strong enough to defeat
 * a first-translation claim).
 *
 * This sweep recomputes the derived fields from data already present on the row.
 * It is a re-projection, not a re-fetch: no network, no LLM, no cost.
 *
 * SAFETY
 * ------
 *   - Dry-run by default; `--apply` required to write.
 *   - Writes a full backup of every touched document BEFORE mutating.
 *   - Never changes `completeness`, `english_title`, `translator`, `pub_year`,
 *     or any human-entered judgement — only derived/normalised fields.
 *   - A row whose `source_language` cannot be resolved is REPORTED, never
 *     guessed and never deleted.
 *   - Idempotent: a second run reports 0 to change.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/reproject-translation-catalogs.mjs           # dry-run
 *   node scripts/maintenance/reproject-translation-catalogs.mjs --apply
 *   node scripts/maintenance/reproject-translation-catalogs.mjs --source claude_subagent_verify
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';
import {
  normalize,
  extractSurname,
  toSourceIso,
  KNOWN_SOURCE_LANGUAGES,
} from '../lib/translation-catalog-record.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const APPLY = process.argv.includes('--apply');
const SOURCE_FILTER = (() => {
  const i = process.argv.indexOf('--source');
  return i === -1 ? null : process.argv[i + 1];
})();

/**
 * Recompute the derived fields for one row.
 *
 * FILL-ONLY, deliberately. A derived field that is already populated is left
 * alone even when recomputation would produce something different.
 *
 * Measured 2026-07-29: recomputing unconditionally would have MUTATED 2,961
 * existing `author_surname` values, and the new value is frequently worse. The
 * stored keys were derived from the `author` field, which is in reliable
 * "Last, First" form; `buildCatalogDoc` prefers `canonical_author`, which is an
 * English display name, and `extractSurname`'s last-word rule mangles those:
 *
 *     "Augustine of Hippo"           → "hippo"     (was "aurelius")
 *     "Various Authors"              → "authors"
 *     "Ioannes Paulus II"            → "ii"
 *     "Various Early Church Fathers" → "fathers"
 *
 * Those are the matcher's candidate-lookup keys, so overwriting them silently
 * re-buckets thousands of rows. That is a separate concern with its own
 * evidence bar — this sweep exists to fix `source_language`, and it stays in
 * that lane. The divergence is counted and reported so the follow-up is sized.
 *
 * Returns the fields that would change, the divergences observed but NOT
 * applied, and any problem worth reporting.
 */
function reproject(row) {
  const patch = {};
  const problems = [];
  const divergences = [];

  /** Fill `field` only when it is currently empty; otherwise record divergence. */
  const fill = (field, value) => {
    if (!value) return;
    const current = row[field];
    if (current === value) return;
    if (current === undefined || current === null || current === '') patch[field] = value;
    else divergences.push({ field, was: current, would_be: value });
  };

  // ── source_language → ISO bucket ───────────────────────────────────────────
  // The ONE field this sweep overwrites: a display name here is not a stylistic
  // difference, it is a value the SOURCE_LANG guard can never match (#3460).
  const rawLang = (row.source_language || '').trim();
  const iso = toSourceIso(rawLang);
  if (!rawLang) {
    problems.push('no source_language');
  } else if (!iso || !KNOWN_SOURCE_LANGUAGES.has(iso)) {
    problems.push(`unmappable source_language "${rawLang}"`);
  } else if (iso !== rawLang) {
    patch.source_language = iso;
    patch.source_language_raw = rawLang;
  }

  // ── derived match keys (fill-only) ─────────────────────────────────────────
  const author = (row.author || '').trim();
  const canonicalAuthor = (row.canonical_author || '').trim();
  fill('author_surname', extractSurname(canonicalAuthor || author));
  fill('author_normalized', normalize(author));
  fill('english_title_normalized', normalize(row.english_title || ''));
  if (row.canonical_work) fill('canonical_work_normalized', normalize(row.canonical_work));
  if (row.original_title) fill('original_title_normalized', normalize(row.original_title));

  const yearInt = parseInt(String(row.pub_year ?? '').trim(), 10);
  if (Number.isFinite(yearInt)) fill('pub_year_int', yearInt);

  return { patch, problems, divergences };
}

await withMongo(async (db) => {
  const registry = db.collection('translation_catalogs');
  const query = SOURCE_FILTER ? { source: SOURCE_FILTER } : {};
  const rows = await registry.find(query).toArray();
  console.log(`Scanning ${rows.length} rows${SOURCE_FILTER ? ` (source=${SOURCE_FILTER})` : ''}…\n`);

  const toWrite = [];
  const problemRows = [];
  const fieldTally = {};
  const sourceTally = {};
  const divergenceTally = {};
  const divergenceExamples = [];

  for (const row of rows) {
    const { patch, problems, divergences } = reproject(row);
    if (problems.length) {
      problemRows.push({ _id: String(row._id), source: row.source, title: row.english_title, problems });
    }
    for (const d of divergences) {
      divergenceTally[d.field] = (divergenceTally[d.field] || 0) + 1;
      if (d.field === 'author_surname' && divergenceExamples.length < 10) {
        divergenceExamples.push({ src: row.source, author: row.author, canon: row.canonical_author, ...d });
      }
    }
    if (Object.keys(patch).length === 0) continue;
    toWrite.push({ row, patch });
    for (const f of Object.keys(patch)) fieldTally[f] = (fieldTally[f] || 0) + 1;
    sourceTally[row.source] = (sourceTally[row.source] || 0) + 1;
  }

  console.log(`Rows needing re-projection: ${toWrite.length}`);
  console.log('  by field:', fieldTally);
  console.log('  by source:', sourceTally);
  console.log(`\nRows with unresolvable problems (reported, NOT changed): ${problemRows.length}`);
  for (const p of problemRows.slice(0, 20)) {
    console.log(`  - [${p.source}] ${String(p.title).slice(0, 60)} — ${p.problems.join('; ')}`);
  }
  if (problemRows.length > 20) console.log(`  … and ${problemRows.length - 20} more`);

  console.log('\nDIVERGENCES observed but deliberately NOT applied (fill-only policy):');
  console.log(' ', divergenceTally);
  if (divergenceExamples.length) {
    console.log('  sample author_surname divergences — note the recomputed value is often WORSE,');
    console.log('  which is why this sweep does not overwrite populated keys:');
    for (const e of divergenceExamples) {
      console.log(`    [${e.src}] author="${e.author}" canon="${e.canon}" stored="${e.was}" recomputed="${e.would_be}"`);
    }
  }

  // How many rows become guard-eligible as a result — the number that matters.
  const nowComplete = toWrite.filter(
    ({ row, patch }) => row.completeness === 'complete' && patch.source_language,
  ).length;
  console.log(`\n"complete" rows gaining an ISO source_language: ${nowComplete}`);

  if (!APPLY) {
    console.log('\nDRY-RUN — nothing written. Re-run with --apply.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(OUT_DIR, `reproject-translation-catalogs-backup-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(toWrite.map(({ row }) => row), null, 2));
  console.log(`\nBacked up ${toWrite.length} original documents → ${backupPath}`);

  let written = 0;
  for (let i = 0; i < toWrite.length; i += 500) {
    const chunk = toWrite.slice(i, i + 500);
    const res = await registry.bulkWrite(
      chunk.map(({ row, patch }) => ({
        updateOne: {
          filter: { _id: row._id },
          update: { $set: { ...patch, reprojected_at: new Date() } },
        },
      })),
    );
    written += res.modifiedCount;
  }
  console.log(`APPLIED — modifiedCount=${written} (expected ${toWrite.length})`);
  if (written !== toWrite.length) {
    console.log('WARNING: modifiedCount does not match the planned count — investigate before trusting this run.');
  }
});
