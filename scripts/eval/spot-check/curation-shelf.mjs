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
 *     [--run <run dir>] [--meta <run-reviewers out_dir>/meta] [--no-record] [--print-rows]
 *
 * A verdict is { book_id, tier: 1 | 2 | 3, title, note, interest }: 1 show, 2 show with care, 3 fix first or do not
 * show. A book already on the shelf is updated, a new one is added, and nothing is removed. The shelf is re-ranked
 * by tier, keeping the earlier order inside a tier.
 *
 * WRITES `collections` with --apply, and only a collection with `visible: false`: a public collection page shows
 * `highlighted_books` to readers, and reviewer notes are not copy. It never touches `books`. Hiding a book is
 * scripts/maintenance/hide-named-books.mjs.
 *
 * With --apply it also records one `book_checks` row per verdict (#6174, method curation-check): the reviewer's tier,
 * the two pages of the run's packet, the text those pages held (the packet's frozen text against the page's text now),
 * who could see them, and the book's share of its packet's `claude -p` cost (--meta; default <run dir>/meta). The run
 * dir is the `overview-draw.mjs --picked` output: --run, or the parent of a `--verdicts <run dir>/verdicts`. Verdicts
 * outside a run dir are not recorded, and the script says so. A dry run counts what would be recorded (--print-rows:
 * each row as JSON). Rows are
 * write-once per {book, method, run}: a re-run never doubles one and a corrected verdict needs a new run. The row is
 * written whether or not the shelf was: it records the read, not the shelf.
 * book_checks is READ BY THE READER (src/lib/book-warnings.ts, #6199): a `fix` row puts a book-level warning on the
 * book, linked to /book/<id>/checks, until a later review reads those pages clean or their text changes. The script
 * prints how many it wrote.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { buildBookCheck, recordBookCheck, ensureBookCheckIndexes, provenanceFromPage, readMethod, pageExposure } from '../../lib/book-checks.mjs';
import { curationCheck, pageRecords, packetProvenance, runCost, checkedAtOf } from './check-rows.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const SLUG = opt('slug'), APPLY = args.includes('--apply'), LIST = args.includes('--list');
if (!SLUG) { console.error('usage: curation-shelf.mjs --slug <collection slug> (--list | --verdicts <dir or file>... [--apply])'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }

const sources = [];
for (let i = args.indexOf('--verdicts') + 1; i > 0 && i < args.length && !args[i].startsWith('--'); i++) sources.push(args[i]);
const files = sources.flatMap((s) => (statSync(s).isDirectory() ? readdirSync(s).filter((f) => f.endsWith('.json')).map((f) => join(s, f)) : [s]));
const byFile = files.map((f) => ({ file: f, verdicts: JSON.parse(readFileSync(f, 'utf8')) }));
const verdicts = byFile.flatMap((x) => x.verdicts);
for (const v of verdicts) {
  if (!v.book_id || ![1, 2, 3].includes(v.tier) || !v.note) throw new Error(`bad verdict (needs book_id, tier 1-3, note): ${JSON.stringify(v).slice(0, 160)}`);
}

// The run the verdicts belong to: --run, or the parent of a `<run dir>/verdicts` source. A run dir has draw-log.json.
const isRun = (d) => existsSync(join(d, 'draw-log.json'));
const runOf = (s) => { const d = statSync(s).isDirectory() ? resolve(s) : dirname(resolve(s)); return basename(d) === 'verdicts' ? dirname(d) : null; };
const RUNS = opt('run') ? [opt('run')] : [...new Set(sources.map(runOf).filter((d) => d && isRun(d)))];
if (RUNS.length > 1) { console.error(`verdicts from ${RUNS.length} runs (${RUNS.join(', ')}): merge one run at a time, so each row names its own run.`); process.exit(1); }
const RUN = RUNS[0];

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
  await recordChecks(client.db('bookstore'));
}
await client.close();

// ── the record (#6174) ──
async function recordChecks(db) {
  if (args.includes('--no-record')) return;
  if (!RUN) { console.error('book_checks: these verdicts are not in a run dir (<run dir>/verdicts, or pass --run) — NO rows recorded'); return; }
  if (!isRun(RUN)) { console.error(`book_checks: ${RUN} has no draw-log.json — NO rows recorded`); process.exitCode = 1; return; }
  const log = JSON.parse(readFileSync(join(RUN, 'draw-log.json'), 'utf8'));
  if (log.mode !== 'picked') { console.error(`book_checks: ${RUN} is not a --picked run (mode ${log.mode}); its rows are overview-score.mjs's — NO rows recorded`); process.exitCode = 1; return; }
  const runId = basename(resolve(RUN));
  const version = readMethod('curation-check').version;
  const metaDir = opt('meta') ?? join(RUN, 'meta');
  const packets = new Map();
  const pdir = join(RUN, 'packets');
  for (const f of existsSync(pdir) ? readdirSync(pdir).filter((x) => x.endsWith('.json')) : []) for (const b of JSON.parse(readFileSync(join(pdir, f), 'utf8'))) packets.set(b.book_id, b);

  // Rows key on books.id; a verdict may carry a re-minted _id (book-deletion-and-identity.md).
  const ids = [...new Set(verdicts.map((v) => String(v.book_id)))];
  const canon = new Map();
  const oids = ids.filter((x) => /^[0-9a-f]{24}$/i.test(x)).map((x) => new ObjectId(x));
  for (const b of await db.collection('books').find({ $or: [{ id: { $in: ids } }, { _id: { $in: [...ids, ...oids] } }] }, { projection: { id: 1 } }).toArray()) { canon.set(b.id, b.id); canon.set(String(b._id), b.id); }

  if (APPLY) await ensureBookCheckIndexes(db);
  const n = { ins: 0, dup: 0, skip: 0, show: 0, caveat: 0, fix: 0 };
  for (const { file, verdicts: vs } of byFile) {
    const checkedAt = checkedAtOf(file);
    const cost = runCost(metaDir, basename(file, '.json'));
    for (const v of vs) {
      const bookId = canon.get(String(v.book_id));
      const packet = packets.get(v.book_id) ?? packets.get(bookId);
      const c = bookId ? curationCheck({ verdict: { ...v, book_id: bookId }, file, runId, checkedAt, packet, cost, booksInFile: vs.length,
        frame: { tradition: packet?.stratum ?? basename(file, '.json'), draw: runId, checked_at_source: 'verdicts file (git add or mtime)' } }) : { skip: 'book not in books' };
      if (c.skip) { console.error(`book_checks: ${v.book_id} not recorded — ${c.skip}`); n.skip++; continue; }
      const pagesRead = c.input.pages_read;
      const now = await pageRecords(db, bookId, pagesRead, { withText: true });
      const input = { ...c.input, method_version: version, exposure: await pageExposure(db, bookId, pagesRead),
        text_provenance: packetProvenance({ pagesRead, packetPages: packet?.pages, now, checkedAt, provenanceFromPage }) };
      try {
        if (APPLY) { (await recordBookCheck(db, input)).inserted ? (n.ins++, n[input.verdict]++) : n.dup++; }
        else {
          const row = buildBookCheck(input);
          if (args.includes('--print-rows')) console.log(JSON.stringify(row));
          (await db.collection('book_checks').countDocuments({ book_id: bookId, method_id: 'curation-check', run_id: runId }, { limit: 1 })) ? n.dup++ : (n.ins++, n[input.verdict]++);
        }
      } catch (e) { console.error(`book_checks: ${v.book_id} refused — ${e.message}`); n.skip++; }
    }
  }
  console.log(`book_checks (${runId}, curation-check v${version}): ${n.ins} ${APPLY ? 'recorded' : 'would be recorded'} (show ${n.show}, caveat ${n.caveat}, fix ${n.fix}), ${n.dup} already present, ${n.skip} not recorded (see above)`);
  if (n.fix) console.log(`  ${n.fix} fix row(s): the reader ${APPLY ? 'now shows' : 'will show'} a book-level warning on those books (src/lib/book-warnings.ts).`);
}
