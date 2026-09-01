#!/usr/bin/env node
/**
 * apply-tibetan-container-verdicts.mjs — write graded verdicts for the Tibetan
 * work-identity resolution (#2318/#3026), the DEMOTE side.
 *
 * Two demote reasons, distinct verdicts:
 *   - miscellany_container / collected_works → verdict `not_applicable`. A thor bu
 *     / lettered-volume / monastery liturgical bundle is not a single work, so a
 *     first-translation claim never applied. NOT a "someone beat us" defeat — the
 *     content itself (multiple distinct texts under one cover) is the evidence.
 *   - already-translated canonical work → verdict `not_first` with its prior.
 *
 * Writes book.first_translation (verdict) + a claude_subagent_verify provenance
 * attempt (result:none for na/container is wrong — use result 'na'/'found').
 * Does NOT touch is_first_translation; the --ids-scoped reconcile flips the flag.
 *
 * Dry-run by default. --apply writes. --in <classification.jsonl> --ids <demote-ids.txt>
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const IN = getArg('--in', null);
const IDS = getArg('--ids', null);
if (!IN || !IDS || !process.env.MONGODB_URI) { console.error('need --in <classification.jsonl> --ids <ids.txt> and MONGODB_URI'); process.exit(1); }

const nowIso = new Date().toISOString();
const attemptId = (bid) => 'a_' + createHash('sha1').update(`${bid}|tibetan-workid|na`).digest('hex').slice(0, 20);

const demoteIds = new Set(readFileSync(IDS, 'utf8').trim().split('\n').map(s => s.trim()).filter(Boolean));
const cls = new Map();
for (const line of readFileSync(IN, 'utf8').trim().split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  cls.set(r.book_id, r);
}

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const books = db.collection('books');
const attempts = db.collection('first_translation_attempts');

const stats = { na: 0, nf: 0, notFound: 0, wrote: 0, skippedNoClass: 0 };
for (const bid of demoteIds) {
  const r = cls.get(bid);
  if (!r) { stats.skippedNoClass++; continue; }
  const verdict = r.ft_verdict === 'not_first' ? 'not_first' : 'not_applicable';
  const or = [{ id: String(bid) }];
  if (/^[0-9a-f]{24}$/.test(String(bid))) or.push({ _id: new ObjectId(String(bid)) });
  const book = await books.findOne({ $or: or }, { projection: { _id: 1, id: 1, work_id: 1 } });
  if (!book) { stats.notFound++; continue; }
  const aid = attemptId(String(book.id || book._id));
  const ft = {
    verdict,
    evidence_strength: r.confidence === 'high' ? 'strong' : 'moderate',
    our_completeness: 'unknown',
    match_key: 'none',
    ...(verdict === 'not_first' ? { prior_relationship: 'same_text' } : {}),
    resolver: 'tier2_agent',
    best_attempt_id: aid,
    resolved_at: nowIso,
  };
  const attemptDoc = {
    attempt_id: aid, book_id: String(book.id || book._id), work_id: book.work_id || null,
    date: nowIso, method: 'claude_subagent_verify', match_key: 'none',
    sources_checked: r.sources || [], queries: [],
    result: verdict === 'not_first' ? 'found' : 'na',
    evidence_strength: ft.evidence_strength,
    model: 'claude-sonnet (tibetan work-identity #2318, content-verified)',
    notes: `[tibetan-workid ${r.classification || verdict}] ${(r.reasoning || '').slice(0, 500)}`,
    _src: 'tibetan-workid-resolution',
    ...(r.prior ? { priors: [{ english_title: r.prior.work_title, translator: (r.prior.translators || [])[0], pub_year: r.prior.year, publisher: r.prior.publisher, source_url: r.prior.url }] } : {}),
  };
  if (verdict === 'not_first') stats.nf++; else stats.na++;
  if (APPLY) {
    await attempts.updateOne({ attempt_id: aid }, { $set: attemptDoc }, { upsert: true });
    await books.updateOne({ _id: book._id }, { $set: { first_translation: ft } });
    stats.wrote++;
  }
}

console.log(`not_applicable: ${stats.na} | not_first: ${stats.nf} | notFound: ${stats.notFound} | no-classification: ${stats.skippedNoClass}`);
if (!APPLY) console.log(`\nDRY-RUN. Would write ${stats.na + stats.nf} verdicts. Re-run --apply, then reconcile-first-translation-flag.ts [RETIRED #4536: the badge is card-governed now — propose a Translation Card edit instead] --ids=<ids> --apply`);
else console.log(`\nAPPLIED. Wrote ${stats.wrote} verdicts + attempts. NOW: reconcile-first-translation-flag.ts --ids=<ids> --apply`);
await c.close();
