#!/usr/bin/env node
// PRIOR ART: scripts/ft-search/held.mjs settles a badged book when ONE search finds a prior for THAT book;
// recheck-credits.mjs rechecks a credit against its own book. Neither looks across the editions of one work: a work
// where one edition is badged "first" and another already carries a complete credit (#7598). The 2026-10-29 pass
// (~/ft-batches/2026-10-29-workconflicts, 191 books) was done by hand; this is that pass as a step of the chain.
//
// Works whose editions disagree: one book is badged first, a sibling with the same work_id carries a complete credit.
// One Sonnet `claude -p` per badged book decides whether the sibling's translation covers THIS book's text.
//
//   node scripts/ft-search/work-conflicts.mjs <dir> [--since ISO] [--limit N]    # prepare: work-conflicts.json + <id>.prompt + ids.txt
//   CLAUDE_CONFIG_DIR=~/.claude-team scripts/ft-search/run-batch.sh <dir> 4        # NO_POSTRUN is written, so it only searches
//   node scripts/ft-search/work-conflicts.mjs apply <dir> [--apply]                # dry run, then write
//
// --since limits the check to works touched since then (a credit verified_at or a badge decided_at at or after it),
// which is how the nightly chain calls it. A book already checked against the same credit url is not asked again.
// Apply, per verdict:
//   covers_part       → the sibling's translation is added to THIS book as a partial credit, only if the book has none
//                       (book_events prior_translation_partial_credited, with the model's note in detail). The badge stays.
//   covers_all        → badge removal is HELD: a book_events row (ft_change_held_for_review) plus <dir>/work-conflicts-held.json.
//                       held-review.mjs applies it once approved.
//   different_content / unclear → nothing changes.
// Every answered book gets a book_events row (work_conflict_checked), which is also what stops a re-ask.
import { MongoClient } from 'mongodb';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { heldEvent, insertHeld, parseAnswer } from './ledger-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = process.argv[2] === 'apply' ? 'apply' : 'prepare';
const DIR = MODE === 'apply' ? process.argv[3] : process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!DIR || DIR.startsWith('--')) { console.error('usage: work-conflicts.mjs <dir> [--since ISO] [--limit N] | apply <dir> [--apply]'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
const BY = 'ft-work-conflicts (#7598)';
const NOW = new Date();

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const books = db.collection('books');
const events = db.collection('book_events');

if (MODE === 'prepare') {
  const since = arg('--since', null);
  const limit = parseInt(arg('--limit', '0'), 10);
  const proj = { id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, language: 1, work_id: 1, prior_translation: 1, first_translation: 1 };
  const credited = await books.find({ work_id: { $type: 'string' }, 'prior_translation.scope': 'complete', 'prior_translation.url': { $type: 'string' } }, { projection: proj }).toArray();
  const byWork = new Map();
  for (const b of credited) (byWork.get(b.work_id) || byWork.set(b.work_id, []).get(b.work_id)).push(b);
  const badged = byWork.size ? await books.find({ work_id: { $in: [...byWork.keys()] }, is_first_translation: true, prior_translation: { $exists: false } }, { projection: proj }).toArray() : [];
  const checked = new Set((await events.find({ type: 'work_conflict_checked', book_id: { $in: badged.map((b) => b.id) } }, { projection: { book_id: 1, 'detail.credit_url': 1 } }).toArray()).map((e) => `${e.book_id}|${e.detail?.credit_url}`));
  const pairs = [];
  for (const b of badged) {
    // The sibling to cite: earliest-year complete credit, not this book itself.
    const other = (byWork.get(b.work_id) || []).filter((o) => o.id !== b.id).sort((x, y) => (x.prior_translation.year ?? 9999) - (y.prior_translation.year ?? 9999))[0];
    if (!other) continue;
    if (checked.has(`${b.id}|${other.prior_translation.url}`)) continue;
    if (since && !(String(other.prior_translation.verified_at || '') >= since || (b.first_translation?.decided_at && new Date(b.first_translation.decided_at) >= new Date(since)))) continue;
    pairs.push({ book: b, other });
  }
  const list = limit ? pairs.slice(0, limit) : pairs;
  mkdirSync(DIR, { recursive: true });
  const t = (b) => b.display_title || b.title || '';
  for (const { book: b, other: o } of list) {
    const p = o.prior_translation;
    // Wording of ~/ft-batches/2026-10-29-workconflicts/*.prompt (the by-hand pass), unchanged.
    writeFileSync(`${DIR}/${b.id}.prompt`, `Source Library marks this book "First English translation" (no earlier published English translation of all its text). Another book in our library that we group as the same work is credited with an earlier English translation. Decide whether that translation covers THIS book.
THIS book: ${t(b)} | author: ${b.author || 'Anonymous'} | date: ${b.published || b.year || ''} | language: ${b.language || ''} | id ${b.id}.
First read it: curl -s https://sourcelibrary.org/api/books/${b.id} | head -c 4000
The other book: ${t(o)}${o.published || o.year ? ` (${o.published || o.year})` : ''}, id ${o.id}. Its credit: ${(p.translators || []).join(', ')}, "${p.work_title || ''}"${p.year ? ` (${p.year})` : ''}${p.publisher ? `, ${p.publisher}` : ''}, scope ${p.scope}. Link: ${p.url}
Note: ${(p.evidence || '').slice(0, 600)}
Work out what THIS book contains (it may be a different volume, a different text grouped under the same work, a commentary, a translation into another language, or the same text). Open the link and search if needed (at most 4 searches).
Verdicts: covers_all (the translation renders all the text THIS book contains: the badge is wrong), covers_part (it renders part of it), different_content (this book's text is not what the translation renders: the badge can stand), unclear.
Report only URLs you actually opened.
Answer with ONLY a JSON object: {"id":"${b.id}","verdict":"covers_all|covers_part|different_content|unclear","this_book_contains":"...","translation_covers":"...","note":"one sentence"}
`);
  }
  writeFileSync(`${DIR}/work-conflicts.json`, JSON.stringify(list.map(({ book: b, other: o }) => ({ book_id: b.id, work_id: b.work_id, other_id: o.id, credit: o.prior_translation })), null, 1));
  writeFileSync(`${DIR}/ids.txt`, list.map((x) => x.book.id).join('\n') + (list.length ? '\n' : ''));
  writeFileSync(`${DIR}/NO_POSTRUN`, 'work-conflicts dir: run-batch.sh stops after the searches\n'); // never parse/ingest these answers as a batch
  console.log(`work conflicts: ${badged.length} badged books share a work with a complete credit; ${list.length} to check${since ? ` (touched since ${since})` : ''}; prompts in ${DIR}`);
} else {
  const conflicts = JSON.parse(readFileSync(`${DIR}/work-conflicts.json`, 'utf8'));
  const stats = {}; const inc = (k) => (stats[k] = (stats[k] || 0) + 1);
  const log = []; const heldFile = []; const heldRows = []; const evs = [];
  for (const x of conflicts) {
    const f = `${DIR}/${x.book_id}.json`;
    const o = existsSync(f) ? parseAnswer(readFileSync(f, 'utf8')) : null;
    if (!o) { inc('no_answer'); continue; }
    const b = await books.findOne({ id: x.book_id }, { projection: { id: 1, is_first_translation: 1, prior_translation: 1 } });
    if (!b?.is_first_translation) { inc('badge_already_gone'); continue; }
    const v = o.verdict;
    inc(v);
    const detail = { verdict: v, this_book_contains: o.this_book_contains || '', translation_covers: o.translation_covers || '', note: o.note || '', other_id: x.other_id, credit_url: x.credit.url };
    log.push({ book_id: x.book_id, ...detail });
    evs.push({ book_id: x.book_id, type: 'work_conflict_checked', at: NOW, by: BY, detail });
    if (v === 'covers_part') {
      if (b.prior_translation) { inc('covers_part_book_already_credited'); continue; }
      inc('covers_part_credit_added');
      if (APPLY) {
        await books.updateOne({ _id: b._id, prior_translation: { $exists: false } }, { $set: { prior_translation: { ...Object.fromEntries(Object.entries(x.credit).filter(([k]) => k !== 'source_attempt_id')), credited_via_work: x.other_id, scope: 'partial', verified_at: NOW.toISOString(), evidence: `Same work as ${x.other_id}. ${o.note || ''} This book contains: ${o.this_book_contains || ''}. The translation covers: ${o.translation_covers || ''}`.trim() } } });
        evs.push({ book_id: x.book_id, type: 'prior_translation_partial_credited', at: NOW, by: BY, detail });
      }
    } else if (v === 'covers_all') {
      inc('badge_removal_held');
      heldFile.push({ book_id: x.book_id, url: `https://sourcelibrary.org/book/${x.book_id}`, ...detail });
      heldRows.push(heldEvent({ book_id: x.book_id, change: 'remove_first_badge', by: BY, reason: `${o.note || ''} (this book: ${o.this_book_contains || ''}; translation: ${o.translation_covers || ''})`.trim(),
        current: { is_first_translation: true }, proposed: { is_first_translation: false, prior_translation: { ...x.credit, scope: 'complete' } } }));
    }
  }
  if (APPLY) {
    if (evs.length) await events.insertMany(evs, { ordered: false });
    if (heldRows.length) stats.held_events_inserted = await insertHeld(events, heldRows);
    writeFileSync(`${DIR}/work-conflicts-held.json`, JSON.stringify(heldFile, null, 1));
  }
  writeFileSync(`${DIR}/work-conflicts-log${APPLY ? '' : '-dryrun'}.json`, JSON.stringify(log, null, 1));
  console.log(APPLY ? 'APPLIED' : 'DRY RUN', JSON.stringify(stats)); // one line: run-batch.sh greps it into the ntfy page
}
await c.close();
