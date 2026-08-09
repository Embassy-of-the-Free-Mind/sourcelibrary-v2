#!/usr/bin/env node
/**
 * export-ft-dataset.mjs — versioned snapshot of the first-translation
 * verification corpus, for deposit as a citable dataset (#3798).
 *
 * What this exports, and why it is publishable: the corpus is documented
 * EVIDENCE OF ABSENCE at scale — every recorded search attempt behind every
 * "first English translation" verdict, with per-attempt provenance (sources
 * consulted, queries issued, result, evidence grade), plus the per-book graded
 * verdicts under the 8-verdict taxonomy of src/lib/first-translation/types.ts.
 * No library publishes this layer; the dataset is the deliverable the working
 * paper (.claude/docs/ft-first-translation-paper.md) describes.
 *
 * Files written to --out (default scripts/output/ft-dataset-<date>/):
 *   attempts.jsonl / attempts.csv     append-only provenance log (one search per row)
 *   verdicts.jsonl / verdicts.csv     one row per book: resolved verdict + public metadata
 *   screening_decisions.jsonl         human/agent screening judgements, keyed (work, prior)
 *   taxonomy.json                     verdict / qualifier / method definitions
 *   reference-set-summary.json        composition stats of `reference_translations`
 *                                     (summary only — the full set is LoC/ESTC/Wikidata
 *                                     derived and reproducible from those sources)
 *   manifest.json                     git SHA, timestamps, row counts, sha256 checksums,
 *                                     exclusion + redaction tallies
 *
 * Invariants:
 *  - DETERMINISTIC: rows are sorted (attempt_id / book_id / work+date) and field
 *    order is explicit, so two runs against the same data produce byte-identical
 *    files apart from manifest timestamps.
 *  - EXCLUSION: books hidden by a takedown or an owner/curator removal request
 *    are excluded entirely (attempts, verdicts, ids). Curation-hidden and
 *    unprocessed books stay, flagged `visible: false` — a bibliographic fact is
 *    public, a removal request is a removal request.
 *  - REDACTION: notes/queries/URLs are swept for email addresses and query-string
 *    credentials before writing. Tallies land in the manifest so a reviewer can
 *    see how much was touched.
 *  - READ-ONLY: this script never writes to Mongo. (Writing to a store an
 *    automated job reads is actuation — this exports, nothing more.)
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/eval/export-ft-dataset.mjs [--out DIR]
 */

import { MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const DB_NAME = 'bookstore';
const DATASET_VERSION_DATE = new Date().toISOString().slice(0, 10);

const argOut = process.argv.indexOf('--out');
const OUT_DIR =
  argOut > -1
    ? resolve(process.argv[argOut + 1])
    : join(REPO_ROOT, 'scripts', 'output', `ft-dataset-${DATASET_VERSION_DATE}`);

/**
 * Books excluded from the dataset entirely. A takedown or a removal request is
 * a statement that we should stop distributing material about the item; the
 * dataset honours it. Curation states (launch_curation, unprocessed, catalog
 * stubs) are NOT exclusions — those books are simply not yet public.
 */
const EXCLUDED_REASON_RE = /kloss|takedown|removal requested|feedback_remove|test-record/i;

// ── redaction ──────────────────────────────────────────────────────────────

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+\.[a-z]{2,}|[\w.+-]+@[\w-]+\.[a-z]{2,}/gi;
const TOKEN_PARAM_RE = /([?&])(key|token|apikey|api_key|sig|signature|access_token|secret|password)=[^&\s"']*/gi;

const redactionTally = { emails: 0, token_params: 0 };

function redactString(s) {
  if (typeof s !== 'string') return s;
  let out = s.replace(EMAIL_RE, () => {
    redactionTally.emails++;
    return '[email-redacted]';
  });
  out = out.replace(TOKEN_PARAM_RE, (_, sep, name) => {
    redactionTally.token_params++;
    return `${sep}${name}=[redacted]`;
  });
  return out;
}

/** Redact every string in a plain object/array, recursively. */
function redactDeep(v) {
  if (typeof v === 'string') return redactString(v);
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = redactDeep(val);
    return out;
  }
  return v;
}

// ── output helpers ─────────────────────────────────────────────────────────

/** Pick fields in a fixed order; omit undefined/null so files stay lean. */
function pick(doc, fields) {
  const out = {};
  for (const f of fields) {
    const v = doc[f];
    if (v !== undefined && v !== null) out[f] = v;
  }
  return out;
}

function writeJsonl(path, rows) {
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function csvCell(v) {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(path, header, rows) {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map((h) => csvCell(r[h])).join(','));
  writeFileSync(path, lines.join('\n') + '\n');
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Same year logic as src/lib/dedup.ts editionYear — books.published is free text. */
function editionYear(book) {
  if (typeof book.year === 'number' && book.year > 0) return book.year;
  const m = String(book.published || '').match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return m ? Number(m[1]) : null;
}

// ── main ───────────────────────────────────────────────────────────────────

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(DB_NAME);
mkdirSync(OUT_DIR, { recursive: true });

console.log(`Exporting FT dataset → ${OUT_DIR}`);

// 1. The exclusion set: takedown / removal-request books, by BOTH id fields.
const excludedBooks = await db
  .collection('books')
  .find(
    { hidden_reason: { $regex: EXCLUDED_REASON_RE } },
    { projection: { id: 1 } },
  )
  .toArray();
const excludedIds = new Set();
for (const b of excludedBooks) {
  if (b.id) excludedIds.add(String(b.id));
  excludedIds.add(String(b._id));
}
console.log(`Exclusion set: ${excludedBooks.length} books (takedown/removal/test)`);

// 2. Verdict-carrying books, with the public-metadata join.
const BOOK_FIELDS = {
  id: 1, title: 1, author: 1, language: 1, original_language: 1,
  published: 1, year: 1, visible: 1, pages_count: 1, pages_translated: 1,
  work_id: 1, is_first_translation: 1, first_translation: 1,
};
const verdictBooks = await db
  .collection('books')
  .find({ 'first_translation.verdict': { $exists: true } }, { projection: BOOK_FIELDS })
  .toArray();

const verdictRows = [];
let excludedVerdicts = 0;
for (const b of verdictBooks) {
  const bookId = String(b.id || b._id);
  if (excludedIds.has(bookId) || excludedIds.has(String(b._id))) {
    excludedVerdicts++;
    continue;
  }
  const ft = b.first_translation || {};
  verdictRows.push(
    redactDeep({
      book_id: bookId,
      work_id: b.work_id ?? undefined,
      title: b.title,
      author: b.author,
      language: b.language ?? undefined,
      original_language: b.original_language ?? undefined,
      published_raw: b.published ?? undefined,
      year: editionYear(b) ?? undefined,
      visible: b.visible === true,
      pages_count: b.pages_count ?? undefined,
      pages_translated: b.pages_translated ?? undefined,
      badge_rendered: b.is_first_translation === true,
      verdict: ft.verdict,
      evidence_strength: ft.evidence_strength,
      our_completeness: ft.our_completeness,
      match_key: ft.match_key,
      prior_relationship: ft.prior_relationship ?? undefined,
      prior_refs: ft.prior_refs?.length ? ft.prior_refs : undefined,
      resolver: ft.resolver,
      best_attempt_id: ft.best_attempt_id ?? undefined,
      resolved_at: ft.resolved_at ? new Date(ft.resolved_at).toISOString() : undefined,
    }),
  );
}
verdictRows.sort((a, b) => a.book_id.localeCompare(b.book_id));
console.log(`Verdicts: ${verdictRows.length} books (${excludedVerdicts} excluded)`);

// 3. Attempts — the append-only provenance log.
const ATTEMPT_FIELDS = [
  'attempt_id', 'book_id', 'work_id', 'date', 'method', 'match_key',
  'sources_checked', 'queries', 'result', 'verdict', 'found_refs', 'priors',
  'evidence_strength', 'independence_score', 'model', 'cost_usd',
  'prompt_version', 'transcript_ref', 'notes',
];
const attemptRows = [];
let excludedAttempts = 0;
const attemptCursor = db.collection('first_translation_attempts').find({});
for await (const a of attemptCursor) {
  if (excludedIds.has(String(a.book_id))) {
    excludedAttempts++;
    continue;
  }
  const row = pick(a, ATTEMPT_FIELDS);
  if (a._src) row.ingest_source = a._src;
  attemptRows.push(redactDeep(row));
}
attemptRows.sort(
  (a, b) => a.book_id.localeCompare(b.book_id) || String(a.attempt_id).localeCompare(String(b.attempt_id)),
);
console.log(`Attempts: ${attemptRows.length} rows (${excludedAttempts} excluded)`);

// 4. Screening decisions (work, prior) — small but load-bearing: immutable
// efforts re-open when the set improves; screening is what persists judgement.
const screeningDocs = await db.collection('screening_decisions').find({}).toArray();
const screeningRows = screeningDocs
  .map((s) => redactDeep(pick(s, ['work', 'screen', 'reason', 'decided_by', 'decided_at'])))
  .map((s) => {
    const d = s.decided_at ? new Date(s.decided_at) : null;
    return { ...s, decided_at: d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined };
  })
  .sort((a, b) => JSON.stringify(a.work).localeCompare(JSON.stringify(b.work)) || String(a.decided_at).localeCompare(String(b.decided_at)));
console.log(`Screening decisions: ${screeningRows.length} rows`);

// 5. Reference-set composition summary (the full 149K-row set derives from
// LoC / ESTC / Wikidata dumps and is reproducible from those sources; what the
// dataset needs is its SHAPE, because every absence claim is bounded by it).
const refCol = db.collection('reference_translations');
const [refTotal, refBySource, refByLang, refByDecade, refUniform] = await Promise.all([
  refCol.countDocuments({}),
  refCol.aggregate([{ $group: { _id: '$source', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
  refCol.aggregate([
    { $unwind: { path: '$original_languages', preserveNullAndEmptyArrays: false } },
    { $group: { _id: '$original_languages', n: { $sum: 1 } } },
    { $sort: { n: -1 } }, { $limit: 40 },
  ]).toArray(),
  refCol.aggregate([
    { $match: { year: { $type: 'number' } } },
    { $group: { _id: { $multiply: [{ $floor: { $divide: ['$year', 10] } }, 10] }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray(),
  refCol.countDocuments({ uniform_title: { $exists: true, $nin: [null, ''] } }),
]);
const referenceSetSummary = {
  description:
    'Composition of reference_translations, the bibliographic reference set every catalogue-tier absence claim is asserted against. An absence claim is only as strong as this set; its measured catalogue-only recall is 32.1% (2026-08-07, scripts/eval/ft-reference-set-recall.mjs), i.e. roughly two of every three known prior translations are invisible to it.',
  total_rows: refTotal,
  rows_by_source: Object.fromEntries(refBySource.map((r) => [String(r._id), r.n])),
  rows_by_original_language_top40: Object.fromEntries(refByLang.map((r) => [String(r._id), r.n])),
  rows_by_decade: Object.fromEntries(refByDecade.map((r) => [String(r._id), r.n])),
  rows_with_uniform_title: refUniform,
  measured_recall: {
    catalogue_only: 0.321,
    measured_at: '2026-08-07',
    instrument: 'scripts/eval/ft-reference-set-recall.mjs',
    baselines: { '2026-07-31': 0.22, '2026-08-01': 0.27, '2026-08-07': 0.321 },
    note: 'Recall measured against attributed priors in translation_classification. none_found is therefore weak evidence by construction; positive findings are unaffected.',
  },
};

// 6. Taxonomy — the codebook, verbatim from src/lib/first-translation/types.ts.
const taxonomy = {
  verdicts: {
    first_no_prior: 'No English translation of this text in any form.',
    first_from_source: 'English of the work exists from a different source language, but not from this text (source-language rule).',
    first_complete: 'Only partial/excerpt/anthology English exists; ours is the first complete one. Gated on our item being complete.',
    first_modern: 'Only antiquated (pre-~1900) English exists.',
    not_first: 'A complete modern English translation of this text exists.',
    not_applicable: 'Not a single translatable text (visual art, scripture manuscript copy, English-source original, multi-work container).',
    unverifiable: 'Competent tradition sources are catalogue-blind here; the search cannot be bounded. Excluded from public headline counts.',
    needs_review: 'Conflicting or inconclusive evidence, or unresolved work identity.',
  },
  first_family: ['first_no_prior', 'first_from_source', 'first_complete', 'first_modern'],
  prior_relationship: {
    same_text: 'Defeats "first".',
    same_work_diff_edition: 'Defeats "first" (recension / authorial revision).',
    different_source_language: 'Does NOT defeat (source-language rule).',
    related_distinct_work: 'Does NOT defeat (parent/sibling/derivative work).',
    partial: 'Supports first_complete.',
    adaptation: 'Usually does not defeat; flagged for review.',
  },
  evidence_strength: {
    strong: 'Prior positively found, OR absence confirmed in competent tradition sources.',
    moderate: 'Well-searched absence, bounded (e.g. could not scan dissertations).',
    weak: 'Absence from a blind catalogue only — effectively unsearched. Weak-evidence first claims are excluded from public headline counts.',
  },
  match_key: {
    work_id: 'Matched via the work-identity layer.',
    author_title: 'Matched on normalised author + title strings.',
    transliteration: 'Matched via transliterated title.',
    none: 'No usable match key.',
  },
  resolver: {
    tier0_linked: 'Deterministic: a linked registry prior.',
    tier1_catalog: 'Catalogue sweep against the reference set.',
    tier2_agent: 'Per-book grounded model adjudication.',
    human: 'Human judgement.',
  },
  attempt_method: {
    tier0_linked: 'Deterministic registry lookup.',
    tier1_catalog: 'Catalogue sweep against reference_translations.',
    tier2_agent: 'Per-book tool-using agent adjudication.',
    human: 'Human review.',
    gemini_verifier: 'Nightly grounded-Gemini verification cron.',
    gemini_grounded_search: 'Gemini call with Google-Search grounding enabled.',
    claude_subagent_verify: 'Independent Claude subagent verification (stage-2, /ft-verify).',
    llm_prior_adjudicate: 'LLM adjudication of a specific asserted prior.',
    constituent_catalog_match: 'Deterministic registry match for one CONSTITUENT sub-work of a container (evidence scoped by attempt.constituent, not the whole book).',
    opus48_collection_scan: 'Collection-level Claude Opus scan (legacy instrument).',
  },
  attempt_result: {
    found: 'A prior English translation was found.',
    none: 'Searched; no prior found (evidence of absence, graded by evidence_strength).',
    not_applicable: 'The book is not an English-translation candidate (original-language edition, container, non-English translation). NOT an absence vote.',
    not_found: 'Demote-direction check: the agent searched for a SPECIFIC cited prior and could not confirm it exists (a targeted refutation).',
    na: 'Legacy alias of not_applicable.',
    not_first: 'Legacy collection-scan result: a prior exists.',
    likely_first: 'Legacy collection-scan result: probably a first (weak).',
  },
};

// ── write everything ───────────────────────────────────────────────────────

writeJsonl(join(OUT_DIR, 'attempts.jsonl'), attemptRows);
writeCsv(
  join(OUT_DIR, 'attempts.csv'),
  ['attempt_id', 'book_id', 'date', 'method', 'match_key', 'result', 'verdict', 'evidence_strength', 'model', 'cost_usd', 'n_sources', 'n_queries', 'n_priors', 'sources_checked'],
  attemptRows.map((a) => ({
    ...a,
    n_sources: a.sources_checked?.length ?? 0,
    n_queries: a.queries?.length ?? 0,
    n_priors: a.priors?.length ?? 0,
    sources_checked: (a.sources_checked || []).join('|'),
  })),
);
writeJsonl(join(OUT_DIR, 'verdicts.jsonl'), verdictRows);
writeCsv(
  join(OUT_DIR, 'verdicts.csv'),
  ['book_id', 'work_id', 'title', 'author', 'language', 'original_language', 'year', 'visible', 'badge_rendered', 'verdict', 'evidence_strength', 'our_completeness', 'match_key', 'prior_relationship', 'resolver', 'resolved_at'],
  verdictRows,
);
writeJsonl(join(OUT_DIR, 'screening_decisions.jsonl'), screeningRows);
writeFileSync(join(OUT_DIR, 'taxonomy.json'), JSON.stringify(taxonomy, null, 2) + '\n');
writeFileSync(join(OUT_DIR, 'reference-set-summary.json'), JSON.stringify(referenceSetSummary, null, 2) + '\n');

// Copy the datasheet in if it exists (kept tracked beside this script).
const datasheetSrc = join(__dirname, 'ft-dataset-datasheet.md');
if (existsSync(datasheetSrc)) {
  writeFileSync(join(OUT_DIR, 'DATASHEET.md'), readFileSync(datasheetSrc));
}

// Manifest last, so it can checksum the rest.
let gitSha = 'unknown';
try {
  gitSha = execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
} catch { /* fine outside a checkout */ }

const files = ['attempts.jsonl', 'attempts.csv', 'verdicts.jsonl', 'verdicts.csv', 'screening_decisions.jsonl', 'taxonomy.json', 'reference-set-summary.json']
  .concat(existsSync(join(OUT_DIR, 'DATASHEET.md')) ? ['DATASHEET.md'] : []);

const manifest = {
  dataset: 'sourcelibrary-first-translation-verification-corpus',
  version: DATASET_VERSION_DATE,
  generated_at: new Date().toISOString(),
  git_sha: gitSha,
  license: 'CC-BY-4.0',
  generator: 'scripts/eval/export-ft-dataset.mjs',
  source_database: DB_NAME,
  counts: {
    attempts: attemptRows.length,
    verdict_books: verdictRows.length,
    screening_decisions: screeningRows.length,
    reference_set_rows_summarised: refTotal,
  },
  exclusions: {
    policy: 'Books hidden by takedown, owner/curator removal request, or marked as test records are excluded entirely (verdicts and attempts).',
    excluded_books: excludedBooks.length,
    excluded_verdict_rows: excludedVerdicts,
    excluded_attempt_rows: excludedAttempts,
  },
  redactions: { ...redactionTally },
  files: Object.fromEntries(files.map((f) => [f, { sha256: sha256(join(OUT_DIR, f)) }])),
};
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`\nDone. ${files.length + 1} files in ${OUT_DIR}`);
console.log(`  attempts=${attemptRows.length} verdicts=${verdictRows.length} screening=${screeningRows.length}`);
console.log(`  redactions: ${redactionTally.emails} emails, ${redactionTally.token_params} token params`);
console.log(`  git_sha=${gitSha}`);

await client.close();
