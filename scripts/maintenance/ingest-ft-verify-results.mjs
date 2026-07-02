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
 *   publisher?, original_title?, source_language?, completeness, source_url?, notes?}]
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/ingest-ft-verify-results.mjs <round-results.json>          # dry-run
 *   node scripts/maintenance/ingest-ft-verify-results.mjs <round-results.json> --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

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

const FOUND = new Set(['confirmed_complete', 'confirmed_partial', 'complete_prior_found', 'only_partial_exists']);
let aIns = 0, aSkip = 0, cIns = 0, cSkip = 0, badRows = 0;

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
        priors: r.prior
          ? [{
              english_title: r.prior,
              completeness: r.result === 'confirmed_complete' || r.result === 'complete_prior_found'
                ? 'complete'
                : r.result === 'confirmed_partial' || r.result === 'only_partial_exists'
                  ? 'partial'
                  : 'unknown',
              source_url: r.evidence_url || undefined,
            }]
          : [],
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
    if (APPLY) {
      await registry.insertOne({
        ...t,
        pub_year: String(t.pub_year),
        author_normalized: (t.author ?? '').toLowerCase(),
        source: 'claude_subagent_verify',
        source_language_provenance: `ft-verify-${runDate}`,
        imported_at: new Date(),
      });
    }
    cIns++;
  }
}

console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — ${rows.length} results from ${file}`);
console.log(`  Sink A (attempts ledger): +${aIns} inserted, ${aSkip} already present`);
console.log(`  Sink C (translation_catalogs): +${cIns} inserted, ${cSkip} deduped`);
if (badRows) console.log(`  WARNING: ${badRows} malformed rows/registry entries skipped`);
console.log('  Sink B (verdict) deliberately untouched — run derive-ft-verdict-from-attempts.ts; the public flag stays behind the reconcile.');
await c.close();
