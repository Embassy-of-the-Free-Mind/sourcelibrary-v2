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
// Every new credit is also appended to its work's card in work_translation_history (the works ledger; entry source
// 'ft_fresh_search', evidence_grade moderate, verified false; deduped on citation_url or title+year; existing entries
// and the card's status are never touched; a work with no card gets one as 'under_review', which renders nothing).
// A search's structured metadata_issue (any kind but none/other) is written as a book_events row.
// Idempotent: a book that already has a fresh-search row is not written twice.
// One search per work (#7598): <dir>/siblings.json (written by select-batch.mjs when propagation is on) maps a
// representative to sibling volumes. A rep's none_found is applied to each sibling by the same rules, with its own
// attempt row ("inherited from <rep attempt_id>"). A rep with a credit, a partial or an unclear answer gives its
// siblings NOTHING: they stay eligible and are searched later. --no-propagate skips this; a GATE dir is refused.
//
//   set -a; source .env.production.local; set +a
//   node scripts/ft-search/ingest.mjs <dir>            # dry run, prints tallies
//   node scripts/ft-search/ingest.mjs <dir> --apply    # writes; ingest-log.json lists every action
import { MongoClient, ObjectId } from 'mongodb';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { entryFromCredit, ledgerOp, LEDGER } from './ledger-lib.mjs';

const DIR = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!DIR) { console.error('Missing <dir>'); process.exit(1); }
if (existsSync(`${DIR}/GATE`)) { console.error('GATE dir: the propagation gate is read-only, never ingested'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const NOW = new Date();
const METHOD = 'claude_subagent_verify';
const BY = 'ft-fresh-search';
// Not a citation: booksellers, reading-list sites, and our own pages.
const BAD_HOSTS = /(homabooks|harvard\.com|sunriverbooks|page158|chaucersbooks|greenapplebooks|cityofasylum|pbfa\.org|goodreads|perlego|scribd|stpaulcenter|amazon\.|abebooks|bookshop\.org|ebay\.|biblio\.com|sourcelibrary\.org)/i;
const ENGLISH = /english/i;

const recs = readFileSync(`${DIR}/results.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const SIBLINGS = existsSync(`${DIR}/siblings.json`) && !process.argv.includes('--no-propagate') ? JSON.parse(readFileSync(`${DIR}/siblings.json`, 'utf8')) : {};
const http = Object.fromEntries(readFileSync(`${DIR}/urlcheck.txt`, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split(' ')));

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const books = db.collection('books');
const attempts = db.collection('first_translation_attempts');

// Bulk lookups: one round trip each instead of one per book.
const ids = [...recs.map((r) => r._book), ...Object.values(SIBLINGS).flat()];
const oids = ids.filter((i) => /^[0-9a-f]{24}$/.test(i)).map((i) => new ObjectId(i));
const bookDocs = await books.find(
  { $or: [{ id: { $in: ids } }, { _id: { $in: oids } }] },
  { projection: { id: 1, is_first_translation: 1, prior_translation: 1, pages_translated: 1, visible: 1, first_translation: 1, language: 1, original_language: 1, work_id: 1 } },
).toArray();
const byKey = new Map();
for (const b of bookDocs) { byKey.set(String(b._id), b); if (b.id) byKey.set(b.id, b); }
// --research: the books were searched before on purpose (select-batch --ids); skip only a repeat of THIS run's attempt.
const RESEARCH = process.argv.includes('--research');
const already = new Set(RESEARCH
  ? await attempts.distinct('attempt_id', { method: METHOD, book_id: { $in: bookDocs.map((b) => b.id || String(b._id)) } })
  : await attempts.distinct('book_id', { method: METHOD, book_id: { $in: bookDocs.map((b) => b.id || String(b._id)) } }));

const stats = {};
const inc = (k) => (stats[k] = (stats[k] || 0) + 1);
const log = [];
const attemptInserts = [];
const bookOps = [];
const events = [];
const creditsForLedger = []; // { work_id, credit, attempt_id, book_id }

// inheritedFrom: the representative's attempt_id when r is a rep's answer applied to a sibling volume.
function handle(r, inheritedFrom = null) {
  const b = byKey.get(r._book);
  if (!b) { inc('book_not_found'); return null; }
  const bookId = b.id || String(b._id);
  if (already.has(RESEARCH ? `${bookId}:${METHOD}:${r._date}` : bookId)) { inc('already_ingested'); return null; }
  const p = r.prior || {};
  const url = (p.url || '').trim();
  const linkOk = /^https?:\/\//.test(url) && ['200', '202'].includes(http[r._book]) && !BAD_HOSTS.test(url);
  const result = r.verdict === 'prior_translation_found' ? 'found' : r.verdict === 'none_found' ? 'not_found' : 'inconclusive';
  const attempt_id = `${bookId}:${METHOD}:${r._date}`;
  attemptInserts.push({
    attempt_id, book_id: bookId, date: r._date, method: METHOD, model: r._model, match_key: 'author_title',
    result, evidence_strength: result === 'found' && linkOk ? 'strong' : 'weak',
    queries: r.queries || [], sources_checked: [inheritedFrom ? 'inherited_from_sibling_search' : 'web_search'],
    priors: result === 'found' && (p.title || p.translator)
      ? [{ english_title: p.title || '', translator: p.translator || '', pub_year: String(p.year || ''), publisher: p.publisher || '', completeness: 'complete', source_url: url }]
      : [],
    notes: inheritedFrom
      ? `Inherited from ${inheritedFrom} (one search per work, #7598): the representative volume of the same work_id and title was searched and nothing was found; verdict ${r.verdict}. Card: ${r.card || ''}`
      : `Fresh web search (Sonnet, claude -p, lean), #7598; verdict ${r.verdict}; work identified: ${r.work_identified || ''}. Card: ${r.card || ''}`,
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
        // Since 2026-10-29 the prompt asks for both sides of the coverage comparison; keep them so a recheck can read them.
        ...(p.book_contains ? { book_contains: p.book_contains } : {}), ...(p.translation_covers ? { translation_covers: p.translation_covers } : {}),
        ...(Number.isInteger(yr) ? { year: yr } : {}), ...(p.publisher ? { publisher: p.publisher } : {}),
      };
      action = 'prior_credit';
      creditsForLedger.push({ work_id: b.work_id, credit: set.prior_translation, attempt_id, book_id: bookId });
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
  // The search reports a wrong author/date/language it notices; collected for a by-hand fix, never written here.
  // Structured since 2026-10-29: {kind, right_value}; an older free-text string counts as reported.
  const mi = r.metadata_issue;
  const miReported = typeof mi === 'string' ? mi.trim() : mi && mi.kind && mi.kind !== 'none';
  if (miReported && !inheritedFrom) inc('metadata_issue_reported');
  log.push({ book_id: bookId, verdict: r.verdict, action, url: url || null, ...(inheritedFrom ? { inherited_from: inheritedFrom } : {}), ...(miReported && !inheritedFrom ? { metadata_issue: mi } : {}) });
  if (miReported && !inheritedFrom && typeof mi === 'object' && !['none', 'other'].includes(mi.kind)) {
    events.push({ book_id: bookId, type: 'metadata_issue_reported', at: NOW, by: BY, attempt_id, detail: { kind: mi.kind, right_value: mi.right_value || '' } });
    inc('metadata_issue_event');
  }
  if (Object.keys(set).length) {
    bookOps.push({ updateOne: { filter: { _id: b._id }, update: { $set: set } } });
    events.push({ book_id: bookId, type: action === 'prior_credit' ? 'prior_translation_credited' : 'first_translation_search_recorded', at: NOW, by: BY, detail: { action, attempt_id, url: url || null, ...(inheritedFrom ? { inherited_from: inheritedFrom } : {}) } });
  }
  return attempt_id;
}

for (const r of recs) {
  const attemptId = handle(r);
  // Only a repeat-free none_found travels; a credit, a partial or an unclear answer leaves the siblings eligible.
  if (!attemptId || r.verdict !== 'none_found') continue;
  for (const sib of SIBLINGS[r._book] || []) {
    const sr = handle({ ...r, _book: sib, prior: null, metadata_issue: null, card: `Searched for an earlier English translation of this work (via another volume of it); none found.` }, attemptId);
    if (sr) inc('sibling_inherited');
  }
}

// Works ledger: one card per work. Read the cards once, decide each append against the card as it will stand.
const ledgerOps = [];
const ledgerLog = [];
const ledgerWorks = [...new Set(creditsForLedger.map((x) => x.work_id).filter(Boolean))];
const cards = new Map((await db.collection(LEDGER).find({ _id: { $in: ledgerWorks } }, { projection: { entries: 1, status: 1 } }).toArray()).map((d) => [d._id, d]));
const contradictions = [];
for (const x of creditsForLedger) {
  if (!x.work_id) { inc('ledger_no_work_id'); continue; }
  const entry = entryFromCredit(x.credit, x.attempt_id);
  const doc = cards.get(x.work_id) || null;
  const { action, op } = ledgerOp(x.work_id, doc, entry, NOW);
  inc(`ledger_${action}`);
  ledgerLog.push({ work_id: x.work_id, book_id: x.book_id, action, status: doc?.status ?? null });
  if (!op) continue;
  ledgerOps.push(op);
  cards.set(x.work_id, { ...(doc || { _id: x.work_id, status: 'under_review' }), entries: [...(doc?.entries || []), entry] });
  // Not changed here: a card still saying no_prior_known now holds an entry. Listed for review.
  if (doc?.status === 'no_prior_known') contradictions.push({ work_id: x.work_id, book_id: x.book_id, entry });
}
if (contradictions.length) { stats.ledger_card_says_no_prior_known = contradictions.length; writeFileSync(`${DIR}/ledger-contradictions.json`, JSON.stringify(contradictions, null, 1)); }
writeFileSync(`${DIR}/ledger-log${APPLY ? '' : '-dryrun'}.json`, JSON.stringify(ledgerLog, null, 1));

if (APPLY) {
  if (attemptInserts.length) stats.attempts_inserted = (await attempts.insertMany(attemptInserts, { ordered: false })).insertedCount;
  if (bookOps.length) stats.books_modified = (await books.bulkWrite(bookOps, { ordered: false })).modifiedCount;
  if (events.length) await db.collection('book_events').insertMany(events, { ordered: false });
  if (ledgerOps.length) {
    const r = await db.collection(LEDGER).bulkWrite(ledgerOps, { ordered: true });
    stats.ledger_writes = r.modifiedCount + r.upsertedCount;
  }
}
writeFileSync(`${DIR}/ingest-log${APPLY ? '' : '-dryrun'}.json`, JSON.stringify(log, null, 1));
console.log(APPLY ? 'APPLIED' : 'DRY RUN', JSON.stringify(stats)); // one line: run-batch.sh greps it into the ntfy page
await c.close();
