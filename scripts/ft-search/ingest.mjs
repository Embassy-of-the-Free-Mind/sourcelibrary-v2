#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/ingest-prior-translations.mjs writes credits only and refuses anything
// that would change a badge, which is the retired card-review rule (#7598). This is the new system's
// single writer: credit OR first badge, from one fresh search, spot-checked after rather than gated before.
//
// Ingest a parsed batch (results.jsonl + urlcheck.txt from parse-results.py) into the library (#7598).
// Every searched book gets one first_translation_attempts row. Then, per book:
//   prior found, link loads, unbadged, no credit   → books.prior_translation credit
//   none found, visible, translated, not English,
//     unbadged                                      → first badge (first_no_prior, weak evidence: the page
//                                                     states the search, it does not assert a negative)
//   none found, already badged                      → the search becomes its evidence
//   prior found on a badged book                    → HELD (same-work check first; see the skill)
// Idempotent: a book that already has a fresh-search row is not written twice.
//
//   set -a; source .env.production.local; set +a
//   node scripts/ft-search/ingest.mjs <dir>            # dry run, prints tallies
//   node scripts/ft-search/ingest.mjs <dir> --apply    # writes; ingest-log.json lists every action
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!DIR) { console.error('Missing <dir>'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const NOW = new Date();
const METHOD = 'claude_subagent_verify';
const BY = 'ft-fresh-search';
// Not a citation: booksellers, reading-list sites, and our own pages.
const BAD_HOSTS = /(homabooks|harvard\.com|sunriverbooks|page158|chaucersbooks|greenapplebooks|cityofasylum|pbfa\.org|goodreads|perlego|scribd|stpaulcenter|amazon\.|abebooks|bookshop\.org|ebay\.|biblio\.com|sourcelibrary\.org)/i;
const ENGLISH = /english/i;

const recs = readFileSync(`${DIR}/results.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const http = Object.fromEntries(readFileSync(`${DIR}/urlcheck.txt`, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split(' ')));

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const books = db.collection('books');
const attempts = db.collection('first_translation_attempts');

// Bulk lookups: one round trip each instead of one per book.
const ids = recs.map((r) => r._book);
const oids = ids.filter((i) => /^[0-9a-f]{24}$/.test(i)).map((i) => new ObjectId(i));
const bookDocs = await books.find(
  { $or: [{ id: { $in: ids } }, { _id: { $in: oids } }] },
  { projection: { id: 1, is_first_translation: 1, prior_translation: 1, pages_translated: 1, visible: 1, first_translation: 1, language: 1, original_language: 1 } },
).toArray();
const byKey = new Map();
for (const b of bookDocs) { byKey.set(String(b._id), b); if (b.id) byKey.set(b.id, b); }
const already = new Set(await attempts.distinct('book_id', { method: METHOD, book_id: { $in: bookDocs.map((b) => b.id || String(b._id)) } }));

const stats = {};
const inc = (k) => (stats[k] = (stats[k] || 0) + 1);
const log = [];
const attemptInserts = [];
const bookOps = [];
const events = [];

for (const r of recs) {
  const b = byKey.get(r._book);
  if (!b) { inc('book_not_found'); continue; }
  const bookId = b.id || String(b._id);
  if (already.has(bookId)) { inc('already_ingested'); continue; }
  const p = r.prior || {};
  const url = (p.url || '').trim();
  const linkOk = /^https?:\/\//.test(url) && ['200', '202'].includes(http[r._book]) && !BAD_HOSTS.test(url);
  const result = r.verdict === 'prior_translation_found' ? 'found' : r.verdict === 'none_found' ? 'not_found' : 'inconclusive';
  const attempt_id = `${bookId}:${METHOD}:${r._date}`;
  attemptInserts.push({
    attempt_id, book_id: bookId, date: r._date, method: METHOD, model: r._model, match_key: 'author_title',
    result, evidence_strength: result === 'found' && linkOk ? 'strong' : 'weak',
    queries: r.queries || [], sources_checked: ['web_search'],
    priors: result === 'found' && (p.title || p.translator)
      ? [{ english_title: p.title || '', translator: p.translator || '', pub_year: String(p.year || ''), publisher: p.publisher || '', completeness: 'complete', source_url: url }]
      : [],
    notes: `Fresh web search (Sonnet, claude -p, lean), #7598; verdict ${r.verdict}; work identified: ${r.work_identified || ''}. Card: ${r.card || ''}`,
  });

  let action = 'attempt_only';
  const set = {};
  if (r.verdict === 'prior_translation_found' && linkOk) {
    if (b.prior_translation) action = 'prior_kept_existing_credit';
    else if (b.is_first_translation) action = 'prior_conflicts_badge_held';
    else {
      const yr = parseInt(String(p.year).match(/\d{3,4}/)?.[0] ?? '', 10);
      set.prior_translation = {
        work_title: p.title, translators: p.translator ? [p.translator] : [], scope: 'complete', url,
        verification_method: 'other', verified_at: NOW.toISOString(), evidence: r.card || '', source_attempt_id: attempt_id,
        ...(Number.isInteger(yr) ? { year: yr } : {}), ...(p.publisher ? { publisher: p.publisher } : {}),
      };
      action = 'prior_credit';
    }
  } else if (r.verdict === 'prior_translation_found') action = 'prior_link_rejected';
  else if (r.verdict === 'none_found') {
    if (b.is_first_translation) {
      action = 'first_confirmed_search_added';
      if (!b.first_translation?.best_attempt_id) set['first_translation.best_attempt_id'] = attempt_id;
    } else if (ENGLISH.test(`${b.language ?? ''} ${b.original_language ?? ''}`)) action = 'none_found_english_book';
    else if ((b.pages_translated ?? 0) > 0 && b.visible) {
      set.is_first_translation = true;
      set.first_translation = { verdict: 'first_no_prior', evidence_strength: 'weak', best_attempt_id: attempt_id, decided_at: NOW, decided_by: BY };
      action = 'first_new_badge';
    } else action = 'none_found_not_translated_or_hidden';
  }
  inc(action);
  log.push({ book_id: bookId, verdict: r.verdict, action, url: url || null });
  if (Object.keys(set).length) {
    bookOps.push({ updateOne: { filter: { _id: b._id }, update: { $set: set } } });
    events.push({ book_id: bookId, type: action === 'prior_credit' ? 'prior_translation_credited' : 'first_translation_search_recorded', at: NOW, by: BY, detail: { action, attempt_id, url: url || null } });
  }
}

if (APPLY) {
  if (attemptInserts.length) stats.attempts_inserted = (await attempts.insertMany(attemptInserts, { ordered: false })).insertedCount;
  if (bookOps.length) stats.books_modified = (await books.bulkWrite(bookOps, { ordered: false })).modifiedCount;
  if (events.length) await db.collection('book_events').insertMany(events, { ordered: false });
}
writeFileSync(`${DIR}/ingest-log${APPLY ? '' : '-dryrun'}.json`, JSON.stringify(log, null, 1));
console.log(APPLY ? 'APPLIED' : 'DRY RUN', stats);
await c.close();
