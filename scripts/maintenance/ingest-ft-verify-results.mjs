#!/usr/bin/env node
/**
 * ingest-ft-verify-results.mjs — persist an ft-verify round into ALL its sinks
 * in one command, so no session can "complete" a round with a sink dropped.
 *
 * The ft-verify skill (Stage-2 Claude-subagent verification) produces a
 * round-results JSON. The write contract for FT evidence is THREE sinks
 * (.claude/docs/ft-enumeration-three-sink-spec.md); this script owns two of
 * them and the third is deliberately excluded:
 *
 *   Sink A  first_translation_attempts (Mongo)  — append-only evidence rows,
 *           method claude_subagent_verify, idempotent attempt_id.
 *   Sink C  translation_catalogs (Mongo)        — every CONFIRMED real prior
 *           becomes a registry row (dedup-on-write), with completeness,
 *           source_language and source_url set. The flywheel: verified
 *           positives make the next check a free membership test.
 *   Sink B  book.first_translation (verdict)    — NOT written here. Verdicts
 *           stay derived-from-evidence (derive-ft-verdict-from-attempts.ts),
 *           and the public flag stays behind the sign-off-gated reconcile.
 *
 * Input file: JSON array; per entry:
 *   book_id, work, author, direction (demote|promote), result
 *   (confirmed_complete|confirmed_partial|not_found|uncertain|none_found|
 *   only_partial_exists|complete_prior_found), survivor (bool), bucket,
 *   prior (string), evidence_url, queries_run[], sources_consulted[{url,found}],
 *   reasoning, registry_rows?[{author, english_title, translator, pub_year,
 *   publisher?, original_title?, source_language?, completeness, source_url?, notes?}],
 *   priors?[{translator, year, english_title, completeness, source_url}]
 *
 * The attempt's structured `priors[]` are built from `registry_rows` (or the
 * `priors` array), NOT the free `prior` string — so every prior carries a
 * `pub_year`. The derive step needs that year to grade `first_modern` (a prior
 * that is only pre-1900 is a badgeable "First Modern Translation", not not_first);
 * a year lost inside a string collapses a genuine first-modern to not_first.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/ingest-ft-verify-results.mjs <round-results.json>          # dry-run
 *   node scripts/maintenance/ingest-ft-verify-results.mjs <round-results.json> --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { buildCatalogDoc } from '../lib/translation-catalog-record.mjs';

const file = process.argv.slice(2).find((a) => a.endsWith('.json'));
const APPLY = process.argv.includes('--apply');
if (!file || !fs.existsSync(file)) {
  console.error('usage: ingest-ft-verify-results.mjs <round-results.json> [--apply]');
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(rows) || rows.length === 0) {
  console.error('input must be a non-empty JSON array');
  process.exit(1);
}
const runDate = new Date().toISOString().slice(0, 10);

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const attempts = db.collection('first_translation_attempts');
const registry = db.collection('translation_catalogs');
const quarantine = db.collection('translation_catalogs_quarantine');

const FOUND = new Set(['confirmed_complete', 'confirmed_partial', 'complete_prior_found', 'only_partial_exists']);
let aIns = 0, aSkip = 0, cIns = 0, cSkip = 0, cQuar = 0, badRows = 0;

const completenessFor = (result) =>
  result === 'confirmed_complete' || result === 'complete_prior_found' ? 'complete'
  : result === 'confirmed_partial' || result === 'only_partial_exists' ? 'partial'
  : 'unknown';

/**
 * Build the attempt's structured `priors[]`.
 *
 * CRITICAL: prefer `registry_rows` (they carry `pub_year`, `translator`,
 * `english_title` as separate fields) over the free `prior` string. The derive
 * step grades `first_modern` (a badgeable first) vs `not_first` by whether the
 * priors are ALL pre-1900 — but it can only read the year if `pub_year` is a
 * structured field. Cramming "translator, 1547, title" into `english_title`
 * (the old behaviour) hides the year, so a genuine first-modern collapses to
 * not_first. This is exactly how De remediis fortuitorum (Whittington 1547) was
 * mis-graded before the fix.
 */
function buildPriors(r) {
  // 1. registry_rows — the canonical structured source (pub_year, translator).
  const rows = Array.isArray(r.registry_rows) ? r.registry_rows.filter((t) => t.english_title) : [];
  if (rows.length) {
    return rows.map((t) => ({
      english_title: t.english_title,
      translator: t.translator || undefined,
      pub_year: t.pub_year != null ? String(t.pub_year) : undefined,
      completeness: t.completeness || completenessFor(r.result),
      // The judgement that decides whether this prior DEFEATS the claim. See
      // PriorRelationship in types.ts. Carried through because dropping it is
      // what let a prior verified as translating a different witness be read as
      // a defeater — Kerns 2008 renders Yonge's Middle English, not the Latin
      // Secretum secretorum, and the badge came off anyway (2026-08-08).
      relationship: t.relationship || undefined,
      source_url: t.source_url || r.evidence_url || undefined,
    }));
  }
  // 2. priors[] — the subagent's structured array (year as a number field).
  const sub = Array.isArray(r.priors) ? r.priors.filter((t) => t.english_title) : [];
  if (sub.length) {
    return sub.map((t) => ({
      english_title: t.english_title,
      translator: t.translator || undefined,
      pub_year: t.year != null && t.year !== 0 ? String(t.year) : (t.pub_year != null ? String(t.pub_year) : undefined),
      completeness: t.completeness || completenessFor(r.result),
      relationship: t.relationship || undefined,
      source_url: t.source_url || r.evidence_url || undefined,
    }));
  }
  // 3. Fallback: only a free `prior` string is available (no structured row).
  //    The year is unparseable here — the derive step cannot grade first_modern.
  return r.prior
    ? [{ english_title: r.prior, completeness: completenessFor(r.result), source_url: r.evidence_url || undefined }]
    : [];
}

for (const r of rows) {
  if (!r.book_id || !r.result || !Array.isArray(r.queries_run)) { badRows++; continue; }

  // ---- Sink A: evidence ledger (idempotent) ----
  const attempt_id = `${r.book_id}:claude_subagent_verify:${runDate}`;
  const exists = await attempts.findOne({ attempt_id });
  if (exists) aSkip++;
  else {
    if (APPLY) {
      await attempts.insertOne({
        attempt_id,
        book_id: r.book_id,
        date: new Date().toISOString(),
        method: 'claude_subagent_verify',
        model: 'claude-sonnet',
        match_key: 'author_title',
        queries: r.queries_run,
        sources_checked: (r.sources_consulted ?? []).map((s) => s.url),
        sources_detail: r.sources_consulted ?? [],
        result: FOUND.has(r.result) ? 'found' : 'none',
        verdict: r.result,
        priors: buildPriors(r),
        evidence_strength: 'strong',
        independence_score: 1,
        notes: `[ft-verify-${runDate} ${r.direction ?? 'demote'}-check bucket=${r.bucket ?? 'unbucketed'}] ${r.reasoning ?? ''}`,
        _src: 'claude-subagent-gate',
      });
    }
    aIns++;
  }

  // ---- Sink C: registry harvest (dedup-on-write) ----
  for (const t of r.registry_rows ?? []) {
    if (!t.english_title || !t.pub_year) { badRows++; continue; }
    const dupQuery = { english_title: t.english_title, pub_year: String(t.pub_year) };
    if (t.translator) dupQuery.translator = t.translator;
    const dup = await registry.findOne(dupQuery);
    if (dup) { cSkip++; continue; }

    // #3460: build through the shared builder rather than spreading the raw
    // subagent object. Spreading stored `source_language` verbatim as a display
    // name ("Sanskrit") — the matcher's SOURCE_LANG guard compares ISO buckets,
    // so every such row was inert. buildCatalogDoc also derives author_surname /
    // english_title_normalized / pub_year_int, which the raw spread never set.
    let doc;
    try {
      doc = buildCatalogDoc({
        ...t,
        pub_year: String(t.pub_year),
        source: 'claude_subagent_verify',
      });
    } catch (err) {
      // An unmappable source_language is a real verified prior we must not drop.
      // Quarantine keeps the record (and the reason) rather than throwing it away.
      cQuar++;
      if (APPLY) {
        await quarantine.insertOne({
          ...t,
          pub_year: String(t.pub_year),
          source: 'claude_subagent_verify',
          quarantine_reason: err.message,
          quarantined_at: new Date(),
          source_language_provenance: `ft-verify-${runDate}`,
        });
      }
      continue;
    }

    if (APPLY) {
      await registry.insertOne({
        ...doc,
        source_language_provenance: `ft-verify-${runDate}`,
        imported_at: new Date(),
      });
    }
    cIns++;
  }
}

console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — ${rows.length} results from ${file}`);
console.log(`  Sink A (attempts ledger): +${aIns} inserted, ${aSkip} already present`);
console.log(`  Sink C (translation_catalogs): +${cIns} inserted, ${cSkip} deduped, ${cQuar} quarantined`);
if (badRows) console.log(`  WARNING: ${badRows} malformed rows/registry entries skipped`);
console.log('  Sink B (verdict) deliberately untouched — run derive-ft-verdict-from-attempts.ts; the public flag stays behind the reconcile.');
await c.close();
