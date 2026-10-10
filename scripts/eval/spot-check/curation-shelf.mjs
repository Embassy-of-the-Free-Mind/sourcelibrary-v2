#!/usr/bin/env node
/**
 * PRIOR ART: overview-draw.mjs / overview-score.mjs / .claude/skills/shelf-overview (PR #6079) are the shelf read:
 * a random draw per stratum, scored into rates. This is the other half of the same toolset, for the run that
 * overview-score.mjs refuses (`overview-draw.mjs --picked`): books chosen by hand, whose result is a worklist and
 * not a number. It keeps the reviewers' verdicts where the person deciding what to show will open them: the
 * `highlighted_books` of a PRIVATE collection. Ported from the session scripts `merge.mjs` and `update.mjs`
 * (ops `quality-sprint/2026-10-06-eternity-shelf/`), which did this once with the slug and directory hardcoded.
 * src/app/api/collections/* edits a collection's fields one request at a time and re-ranks nothing.
 *
 * curation-shelf — merge curation verdicts (CURATION-ADDENDUM.md format) into a private collection (#5918).
 *
 *   node --env-file=.env.production.local scripts/eval/spot-check/curation-shelf.mjs --slug eternity-spot-check --list
 *   node --env-file=.env.production.local scripts/eval/spot-check/curation-shelf.mjs --slug <slug> --verdicts <dir or file>...            # dry run
 *   node --env-file=.env.production.local scripts/eval/spot-check/curation-shelf.mjs --slug <slug> --verdicts <dir or file>... --apply
 *
 * A verdict is { book_id, tier: 1 | 2 | 3, title, note, interest }: 1 show, 2 show with care, 3 fix first or do not
 * show. A book already on the shelf is updated, a new one is added, and nothing is removed. The shelf is re-ranked
 * by tier, keeping the earlier order inside a tier.
 *
 * WRITES `collections` with --apply, and only a collection with `visible: false`: a public collection page shows
 * `highlighted_books` to readers, and reviewer notes are not copy. It never touches `books`. Hiding a book is
 * scripts/maintenance/hide-named-books.mjs.
 */
import { MongoClient } from 'mongodb';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const SLUG = opt('slug'), APPLY = args.includes('--apply'), LIST = args.includes('--list');
if (!SLUG) { console.error('usage: curation-shelf.mjs --slug <collection slug> (--list | --verdicts <dir or file>... [--apply])'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }

const sources = [];
for (let i = args.indexOf('--verdicts') + 1; i > 0 && i < args.length && !args[i].startsWith('--'); i++) sources.push(args[i]);
const files = sources.flatMap((s) => (statSync(s).isDirectory() ? readdirSync(s).filter((f) => f.endsWith('.json')).map((f) => join(s, f)) : [s]));
const verdicts = files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
for (const v of verdicts) {
  if (!v.book_id || ![1, 2, 3].includes(v.tier) || !v.note) throw new Error(`bad verdict (needs book_id, tier 1-3, note): ${JSON.stringify(v).slice(0, 160)}`);
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const coll = client.db('bookstore').collection('collections');
const col = await coll.findOne({ slug: SLUG });
if (!col) { console.error(`no collection with slug ${SLUG}`); process.exit(1); }
const books = [...(col.highlighted_books || [])];
const tiers = (list) => list.reduce((m, h) => { m[h.tier] = (m[h.tier] || 0) + 1; return m; }, {});

if (LIST) {
  for (const h of books) console.log(h.rank, h.tier, h.book_id, '|', h.title, '|', (h.note || '').slice(0, 90));
  console.log(`${books.length} books, by tier ${JSON.stringify(tiers(books))}, visible=${col.visible}`);
} else {
  const byId = new Map(books.map((h) => [h.book_id, h]));
  let added = 0, updated = 0;
  for (const v of verdicts) {
    const entry = { book_id: v.book_id, tier: v.tier, title: v.title, note: v.note, ...(v.interest ? { interest: v.interest } : {}) };
    if (byId.has(v.book_id)) { Object.assign(byId.get(v.book_id), entry); updated++; }
    else { books.push(entry); byId.set(v.book_id, entry); added++; }
  }
  books.sort((a, b) => (a.tier - b.tier) || ((a.rank ?? 999) - (b.rank ?? 999)));
  books.forEach((h, i) => { h.rank = i + 1; });
  console.log(`files ${files.length}, verdicts ${verdicts.length}, added ${added}, updated ${updated}, shelf ${books.length}, by tier ${JSON.stringify(tiers(books))}`);
  if (!APPLY) console.log('Dry run. Re-run with --apply.');
  else if (col.visible !== false) { console.error(`REFUSED: collection ${SLUG} is not private (visible=${col.visible}); reviewer notes would be shown to readers.`); process.exitCode = 1; }
  else {
    const r = await coll.updateOne({ _id: col._id, visible: false }, { $set: { highlighted_books: books, book_count: books.length, total_book_count: books.length, updated_at: new Date() } });
    console.log(`matched ${r.matchedCount}, modified ${r.modifiedCount}`);
  }
}
await client.close();
