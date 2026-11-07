#!/usr/bin/env node
// PRIOR ART: scripts/ft-search/held.mjs settles books the search held at ingest (a prior found on a badged book);
// this lists and settles the changes the chain HELD for a human afterwards: credit retractions (recheck-credits.mjs
// --no-retract) and badge removals (work-conflicts.mjs), each stored as a book_events row of type
// ft_change_held_for_review (#7598). The files retractions-held.json / work-conflicts-held.json were the only record.
//
//   set -a; source .env.production.local; set +a
//   node scripts/ft-search/held-review.mjs list [--since 2026-10-29] [--all]     # open ones, with book links; --all adds settled
//   node scripts/ft-search/held-review.mjs apply <eventId>... [--apply]            # approve: make the change (dry run without --apply)
//   node scripts/ft-search/held-review.mjs apply --ids-file <file> [--apply]
//   node scripts/ft-search/held-review.mjs reject <eventId>... [--apply]           # decline: the change is not made, the row is settled
// Approving is the only path to the change. Each apply also writes the book_events row the change normally writes
// (prior_translation_retracted / first_translation_badge_removed), keeping the removed value so it can be restored.
// A change is skipped if the book has moved since it was held (credit gone/different, badge already off).
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'node:fs';
import { HELD_EVENT } from './ledger-lib.mjs';

const [MODE, ...rest] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (!['list', 'apply', 'reject'].includes(MODE)) { console.error('usage: held-review.mjs list [--since D] [--all] | apply|reject <eventId>... [--ids-file f] [--apply]'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
const NOW = new Date();
const BY = 'ft-held-review (#7598)';

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const books = db.collection('books');
const events = db.collection('book_events');

if (MODE === 'list') {
  const since = arg('--since', '1970-01-01');
  const q = { type: HELD_EVENT, at: { $gte: new Date(since) }, ...(process.argv.includes('--all') ? {} : { resolved_at: { $exists: false } }) };
  const rows = await events.find(q).sort({ at: 1 }).toArray();
  const counts = {};
  for (const e of rows) {
    counts[e.detail?.change] = (counts[e.detail?.change] || 0) + 1;
    const cur = e.detail?.current;
    console.log(`${e._id}  ${e.detail?.change}  ${e.resolved_at ? `[${e.resolution}] ` : ''}https://sourcelibrary.org/book/${e.book_id}\n    ${e.detail?.reason || ''}${cur?.url ? `\n    credit: ${cur.url}` : ''}${e.detail?.proposed?.prior_translation?.url ? `\n    prior:  ${e.detail.proposed.prior_translation.url}` : ''}`);
  }
  console.log(`${rows.length} ${process.argv.includes('--all') ? '' : 'open '}held change(s) since ${since}`, counts);
} else {
  const ids = [...rest.filter((x) => /^[0-9a-f]{24}$/.test(x)), ...(arg('--ids-file') ? readFileSync(arg('--ids-file'), 'utf8').split(/\s+/).filter((x) => /^[0-9a-f]{24}$/.test(x)) : [])];
  if (!ids.length) { console.error('no event ids given'); process.exit(1); }
  const stats = {}; const inc = (k) => (stats[k] = (stats[k] || 0) + 1);
  for (const id of ids) {
    const e = await events.findOne({ _id: new ObjectId(id), type: HELD_EVENT });
    if (!e) { inc('not_found'); continue; }
    if (e.resolved_at) { inc('already_settled'); continue; }
    const b = await books.findOne({ id: e.book_id }, { projection: { id: 1, is_first_translation: 1, prior_translation: 1 } });
    let result = MODE === 'reject' ? 'rejected' : null;
    if (MODE === 'apply') {
      const ch = e.detail?.change;
      if (ch === 'retract_credit') {
        if (!b?.prior_translation || b.prior_translation.url !== e.detail.current?.url) result = 'skipped_book_moved';
        else {
          result = 'approved';
          if (APPLY) {
            await books.updateOne({ _id: b._id }, { $unset: { prior_translation: '' } });
            await events.insertOne({ book_id: e.book_id, type: 'prior_translation_retracted', at: NOW, by: BY, detail: { reason: e.detail.reason, retracted: b.prior_translation, held_event: String(e._id) } });
          }
        }
      } else if (ch === 'remove_first_badge') {
        if (!b?.is_first_translation || b.prior_translation) result = 'skipped_book_moved';
        else {
          result = 'approved';
          if (APPLY) {
            await books.updateOne({ _id: b._id }, { $set: { is_first_translation: false, 'first_translation.verdict': 'not_first', 'first_translation.decided_at': NOW, 'first_translation.decided_by': BY, prior_translation: { ...e.detail.proposed.prior_translation, verification_method: 'other', verified_at: NOW.toISOString(), evidence: e.detail.reason } } });
            await events.insertOne({ book_id: e.book_id, type: 'first_translation_badge_removed', at: NOW, by: BY, detail: { reason: e.detail.reason, prior: e.detail.proposed.prior_translation, held_event: String(e._id) } });
          }
        }
      } else result = 'unknown_change';
    }
    inc(result);
    // A skipped or unknown row stays open; an approved or rejected one is settled.
    if (APPLY && ['approved', 'rejected'].includes(result)) await events.updateOne({ _id: e._id }, { $set: { resolved_at: NOW, resolution: result, resolved_by: BY } });
    console.log(`${id} ${e.book_id} ${e.detail?.change} -> ${result}`);
  }
  console.log(APPLY ? 'APPLIED' : 'DRY RUN', stats);
}
await c.close();
