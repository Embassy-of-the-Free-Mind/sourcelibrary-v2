#!/usr/bin/env node
/**
 * badge-verified-firsts.mjs — write the graded first_translation VERDICT for
 * two-stage-verified new firsts found by the #3026 inverse search, plus their
 * provenance attempt. It does NOT set the public is_first_translation boolean —
 * that stays the single job of reconcile-first-translation-flag.ts (run it
 * after, scoped `--resolver=tier2_agent`, gated on Derek's sign-off).
 *
 * Each input row is a confirmed_first that survived adversarial ft-verify
 * (Stage-2). We write:
 *   Sink A  first_translation_attempts — one claude_subagent_verify row per book
 *           (result:'none' = searched, no prior), with the actual queries+sources.
 *   Sink B  book.first_translation — the graded verdict (first_no_prior /
 *           first_modern / first_complete), resolver tier2_agent, evidence
 *           moderate|strong (never weak → clears canPromoteToFirst).
 *
 * our_completeness:'complete' — our items are complete translations (required so
 * a first_complete verdict actually badges via isFirstByVerdict).
 *
 * Dry-run by default. --apply writes. --limit N caps.
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/badge-verified-firsts.mjs --in <file.jsonl>
 *   node scripts/maintenance/badge-verified-firsts.mjs --in <file.jsonl> --apply
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { appendAttempt } from '../lib/ft-attempt-log.mjs';

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const IN = getArg('--in', null);
const LIMIT = parseInt(getArg('--limit', '0'), 10) || 0;
if (!IN || !process.env.MONGODB_URI) { console.error('need --in <file> and MONGODB_URI'); process.exit(1); }

const TYPE_TO_VERDICT = { no_prior: 'first_no_prior', first_modern: 'first_modern', first_complete: 'first_complete', first_from_source: 'first_from_source' };
const nowIso = new Date().toISOString();

function attemptId(bookId) {
  return 'a_' + createHash('sha1').update(`${bookId}|claude_subagent_verify|3026-inverse`).digest('hex').slice(0, 20);
}

const rows = readFileSync(IN, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const batch = LIMIT ? rows.slice(0, LIMIT) : rows;
console.log(`Loaded ${rows.length} verified firsts${LIMIT ? `, capped to ${batch.length}` : ''}`);

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const books = db.collection('books');

const stats = { matched: 0, notFound: 0, alreadyFirst: 0, wroteVerdict: 0, wroteAttempt: 0, byVerdict: {} };
for (const r of batch) {
  const verdict = TYPE_TO_VERDICT[r.first_type];
  if (!verdict) { console.log('  skip unknown first_type', r.first_type, r.book_id); continue; }
  const or = [{ id: String(r.book_id) }];
  if (/^[0-9a-f]{24}$/.test(String(r.book_id))) or.push({ _id: new ObjectId(String(r.book_id)) });
  const book = await books.findOne({ $or: or }, { projection: { _id: 1, id: 1, title: 1, is_first_translation: 1, first_translation: 1, work_id: 1 } });
  if (!book) { stats.notFound++; console.log('  NOT FOUND', r.book_id, r.title); continue; }
  stats.matched++;
  if (book.is_first_translation === true) stats.alreadyFirst++;

  const aid = attemptId(String(book.id || book._id));
  const ft = {
    verdict,
    evidence_strength: r.confidence === 'high' ? 'strong' : 'moderate',
    our_completeness: 'complete',
    match_key: (book.work_id || r.work_id) ? 'work_id' : 'author_title',
    // first_from_source: the work exists in English from a DIFFERENT source (or
    // is itself a translation, e.g. the Dutch-from-English voyages) — ours is
    // the first translation of THIS text/witness. The relationship records why
    // the existing English does not defeat the claim.
    ...(verdict === 'first_from_source' ? { prior_relationship: 'different_source_language' } : {}),
    resolver: 'tier2_agent',
    best_attempt_id: aid,
    resolved_at: nowIso,
  };
  stats.byVerdict[verdict] = (stats.byVerdict[verdict] || 0) + 1;

  const attemptDoc = {
    attempt_id: aid,
    book_id: String(book.id || book._id),
    work_id: book.work_id || r.work_id || null,
    date: nowIso,
    method: 'claude_subagent_verify',
    match_key: ft.match_key,
    sources_checked: r.sources || [],
    queries: r.queries || [],
    result: 'none',
    evidence_strength: ft.evidence_strength,
    model: 'claude-sonnet (inverse-search #3026, two-stage)',
    notes: `[3026-inverse ${r.first_type}] ${r.reasoning || ''}`,
    _src: '3026-inverse-search',
  };

  if (APPLY) {
    // Append-only ledger: $setOnInsert via appendAttempt — a retry can neither duplicate nor mutate (#3785).
    const wroteAttempt = await appendAttempt(db, attemptDoc);
    await books.updateOne({ _id: book._id }, { $set: { first_translation: ft } });
    if (wroteAttempt) stats.wroteAttempt++;
    stats.wroteVerdict++;
  }
}

console.log(`\nmatched ${stats.matched} / notFound ${stats.notFound} / already-badged-first ${stats.alreadyFirst}`);
console.log('verdicts:', JSON.stringify(stats.byVerdict));
if (!APPLY) console.log(`\nDRY-RUN. Would write ${stats.matched} verdicts + attempts. Re-run --apply, then reconcile-first-translation-flag.ts --apply --resolver=tier2_agent`);
else console.log(`\nAPPLIED. Wrote ${stats.wroteVerdict} verdicts + ${stats.wroteAttempt} attempts. NOW RUN: reconcile-first-translation-flag.ts --apply --resolver=tier2_agent`);
await c.close();
