#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/spot-check/register.mjs (turns a run's reviews into per-FINDING rows in findings.json, never
 * per-book verdicts, never Mongo) and curation-shelf.mjs (copies curation verdicts into a private collection's
 * highlighted_books, where they are copy, not a record). Nothing wrote one verdict row per book per check (#6174).
 *
 * backfill-book-checks — one `book_checks` row per book per existing check, each pointing at its evidence file (#6174).
 * Every row goes through recordBookCheck() (scripts/lib/book-checks.mjs). Reads Mongo for book identity and page
 * provenance; writes only `book_checks`, and only with --apply.
 *
 *   node --env-file=.env.production.local scripts/maintenance/backfill-book-checks.mjs                # dry run: counts
 *   node --env-file=.env.production.local scripts/maintenance/backfill-book-checks.mjs --apply
 *     [--reruns-ref origin/qa/script-run-reviewers-6174]   read reruns-6174/S1, S2 from a ref while #6190 is unmerged
 *     [--ops-dir /root/ops-eternity-refresh]              a checkout of the private ops repo, for the #5914 month-0 draw
 *
 * Sources (method):
 *   overview-2026-10-07*\/reviews/*.json                     shelf-overview, the reviewer's fit_to_show
 *   overview-2026-10-07-eternity2/reruns-6174/{S1,S2}/*.json  shelf-overview, separate run ids
 *   curation-2026-10-06-eternity/shelf.json                   curation-check, the tier; pages from the note
 *   sprint-2026-10-07-r1/results.json                         fortnightly-spot-check, derived verdict
 *   ops rights-screen/2026-10-06-canon-shelves/spot30/result*.json   fortnightly-spot-check month 0, derived verdict
 *   books with hidden_reason broken_text_*                   hide-broken-text, grounded on the latest in-repo check
 *
 * checked_at is the author time of the commit that added the evidence file: an upper bound on when it was read
 * (frame.checked_at_source = 'commit'). Text provenance: from the packet where the run froze one (model ids as read;
 * the packet's text compared with the page's text now, and the page's *_updated_at added only when they are equal);
 * otherwise reconstructed from
 * the page record, and only when the page's text predates checked_at — else the model ids are null with the reason.
 * Rights notes (rights_flag, rights_note) are never copied: this record is not where rights suspicions live.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildBookCheck, recordBookCheck, ensureBookCheckIndexes, provenanceFromPage, readMethod } from '../lib/book-checks.mjs';
import { seriousPage, seriousClasses, FIT, derivedFortnightly, pageRecords, packetProvenance } from '../eval/spot-check/check-rows.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const RERUNS_REF = opt('reruns-ref');
const OPS = opt('ops-dir', '/root/ops-eternity-refresh');
const ROOT = 'scripts/eval/results/spot-check';
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }

const V = Object.fromEntries(['shelf-overview', 'curation-check', 'fortnightly-spot-check', 'hide-broken-text'].map((m) => [m, readMethod(m).version]));
const OPUS = { kind: 'model', model: 'opus', image_opened: true };
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

function addedAt(path, { cwd, ref } = {}) {
  const out = execFileSync('git', ['log', ...(ref ? [ref] : []), '--diff-filter=A', '--format=%aI', '-1', '--', path], { encoding: 'utf8', cwd }).trim();
  if (!out) throw new Error(`no commit adds ${path}${ref ? ` on ${ref}` : ''}`);
  return new Date(out);
}
const showAt = (ref, path) => JSON.parse(execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', maxBuffer: 64 << 20 }));

// ── candidates: { source, book_id, checked_at, method_id, run_id, frame, pages_read, reader, verdict, …, packetPages }
const cands = [];
const skipped = [];

// 1. shelf-overview runs (and the #6174 reruns of eternity2)
for (const dir of readdirSync(ROOT).filter((d) => d.startsWith('overview-2026-10-07')).sort()) {
  const log = json(join(ROOT, dir, 'draw-log.json'));
  const packets = new Map();
  for (const f of readdirSync(join(ROOT, dir, 'packets'))) for (const b of json(join(ROOT, dir, 'packets', f))) packets.set(b.book_id, b);
  const runs = [{ run_id: dir, files: readdirSync(join(ROOT, dir, 'reviews')).map((f) => join(ROOT, dir, 'reviews', f)), read: json, at: (p) => addedAt(p) }];
  const rr = join(ROOT, dir, 'reruns-6174');
  for (const arm of ['S1', 'S2']) {
    const p = join(rr, arm);
    if (existsSync(p)) runs.push({ run_id: `${dir}/reruns-6174/${arm}`, files: readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => join(p, f)), read: json, at: (x) => addedAt(x) });
    else if (RERUNS_REF && dir === 'overview-2026-10-07-eternity2') {
      const files = execFileSync('git', ['ls-tree', '--name-only', `${RERUNS_REF}:${p}`], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.json')).map((f) => join(p, f));
      runs.push({ run_id: `${dir}/reruns-6174/${arm}`, files, read: (x) => showAt(RERUNS_REF, x), at: (x) => addedAt(x, { ref: RERUNS_REF }) });
    }
  }
  for (const run of runs) {
    for (const file of run.files) {
      const at = run.at(file);
      for (const b of run.read(file)) {
        const verdict = FIT[b.fit_to_show];
        if (!verdict) { skipped.push(`${run.run_id} ${b.book_id}: no fit_to_show`); continue; }
        const pk = packets.get(b.book_id);
        cands.push({ source: run.run_id.includes('reruns') ? 'overview-rerun' : 'overview', book_id: b.book_id, checked_at: at,
          method_id: 'shelf-overview', run_id: run.run_id,
          frame: { stratum: pk?.stratum ?? null, seed: log.seed, draw: dir, checked_at_source: 'commit' },
          pages_read: b.pages.map((p) => p.page_number), reader: OPUS, verdict, verdict_source: 'reader',
          classes: seriousClasses(b.pages), note: b.reader_summary ?? b.book_verdict, evidence_path: file,
          packetPages: pk?.pages, serious: b.pages.some(seriousPage) });
      }
    }
  }
}

// 2. curation-2026-10-06-eternity: the tier; pages named in the note
{
  const file = join(ROOT, 'curation-2026-10-06-eternity', 'shelf.json');
  const at = addedAt(file);
  const READER = {
    'reviewer by eye': OPUS,
    'read from image': { kind: 'model', role: 'session', image_opened: true },
    'earlier session': { kind: 'model', role: 'earlier session' },
  };
  for (const b of json(file)) {
    const pages = [...new Set([...b.note.matchAll(/\?page=(\d+)/g), ...b.note.matchAll(/\bpp?\.\s?(\d+)/g)].map((m) => Number(m[1])))].sort((x, y) => x - y);
    if (!pages.length) { skipped.push(`curation ${b.book_id}: note names no page`); continue; }
    const r = READER[b.read_by];
    if (!r) { skipped.push(`curation ${b.book_id}: unknown read_by ${b.read_by}`); continue; }
    const reader = { ...r, image_opened: r.image_opened ?? (/image/i.test(b.note) ? true : 'unrecorded') };
    cands.push({ source: 'curation', book_id: b.book_id, checked_at: at, method_id: 'curation-check', run_id: 'curation-2026-10-06-eternity',
      frame: { tradition: b.tradition, rank: b.rank, pages_read_source: 'note', checked_at_source: 'commit' },
      pages_read: pages, reader, verdict: { 1: 'show', 2: 'caveat', 3: 'fix' }[b.tier], verdict_source: 'reader',
      note: b.note, evidence_path: file, serious: b.tier === 3 });
  }
}

// 3. sprint-2026-10-07-r1: REVIEWER.md schema, no book verdict → the fortnightly rule
{
  const dir = join(ROOT, 'sprint-2026-10-07-r1');
  const file = join(dir, 'results.json');
  const at = addedAt(file);
  const sample = new Map(json(join(dir, 'sample.json')).map((b) => [b.book_id, b]));
  for (const b of json(file)) {
    cands.push({ source: 'sprint-r1', book_id: b.book_id, checked_at: at, method_id: 'fortnightly-spot-check', run_id: 'sprint-2026-10-07-r1',
      frame: { draw: 'sprint-2026-10-07-r1', checked_at_source: 'commit' },
      pages_read: b.pages.map((p) => p.page_number), reader: OPUS, verdict: derivedFortnightly(b), verdict_source: 'derived:fortnightly-v1',
      classes: seriousClasses(b.pages), note: b.book_verdict, evidence_path: file, packetPages: sample.get(b.book_id)?.pages,
      serious: b.pages.some(seriousPage) });
  }
}

// 4. #5914 month 0, from the private ops repo: no packets, no notes copied (the folder is a rights screen)
{
  const rel = 'rights-screen/2026-10-06-canon-shelves/spot30';
  const dir = join(OPS, rel);
  if (!existsSync(dir)) skipped.push(`month-0: ${dir} not found (pass --ops-dir)`);
  else for (const f of readdirSync(dir).filter((x) => /^result\d+\.json$/.test(x)).sort()) {
    const at = addedAt(join(rel, f), { cwd: OPS });
    for (const b of json(join(dir, f))) {
      const pages = b.pages.map((p) => ({ ...p, page_number: Number(p.page_number ?? p.n) }));
      cands.push({ source: 'month-0', book_id: b.book_id, checked_at: at, method_id: 'fortnightly-spot-check', run_id: 'fortnightly-2026-10-06-month0',
        frame: { draw: 'canon-shelves month 0', seed: 1791290001, checked_at_source: 'commit' },
        pages_read: pages.map((p) => p.page_number), reader: OPUS, verdict: derivedFortnightly({ ...b, pages }), verdict_source: 'derived:fortnightly-v1',
        classes: seriousClasses(pages), evidence_path: `ops:${rel}/${f}`, serious: pages.some(seriousPage) });
    }
  }
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');

// Book identity: rows key on books.id; a few reviews may carry a re-minted _id (book-deletion-and-identity.md).
const ids = [...new Set(cands.map((c) => c.book_id))];
const oids = ids.filter((x) => ObjectId.isValid(x) && /^[0-9a-f]{24}$/i.test(x)).map((x) => new ObjectId(x));
const books = await db.collection('books').find({ $or: [{ id: { $in: ids } }, { _id: { $in: [...ids, ...oids] } }] }, { projection: { id: 1, hidden_reason: 1, hidden_at: 1 } }).toArray();
const canon = new Map();
for (const b of books) { canon.set(b.id, b.id); canon.set(String(b._id), b.id); }
for (const c of cands) {
  if (!canon.has(c.book_id)) { c.drop = 'book not in books (deleted?)'; continue; }
  c.book_id = canon.get(c.book_id);
}

// 5. hides: books hidden as broken_text_*, grounded on the latest in-repo check of the book that found it broken
const hidden = await db.collection('books').find({ hidden_reason: { $regex: '^broken_text_' } }, { projection: { id: 1, hidden_reason: 1, hidden_at: 1 } }).toArray();
for (const h of hidden) {
  const own = cands.filter((c) => !c.drop && c.book_id === h.id && c.source !== 'overview-rerun');
  const pick = (xs) => xs.sort((a, b) => b.checked_at - a.checked_at)[0];
  const g = pick(own.filter((c) => c.verdict === 'fix')) ?? pick(own.filter((c) => c.serious));
  if (!g) { skipped.push(`hide ${h.id} (${h.hidden_reason}): no in-repo check found it broken`); continue; }
  cands.push({ source: 'hide', book_id: h.id, checked_at: h.hidden_at ?? g.checked_at, method_id: 'hide-broken-text', run_id: h.hidden_reason,
    frame: { source_run_id: g.run_id, source_method_id: g.method_id, hidden_reason: h.hidden_reason, checked_at_source: h.hidden_at ? 'hidden_at' : 'source check' },
    pages_read: g.pages_read, reader: g.reader, verdict: 'fix', verdict_source: `hide:${h.hidden_reason}`, classes: g.classes,
    evidence_path: g.evidence_path, packetPages: g.packetPages });
}

// Provenance. One query per book over the union of its pages read.
const want = new Map();
for (const c of cands.filter((x) => !x.drop)) { const s = want.get(c.book_id) ?? new Set(); c.pages_read.forEach((n) => s.add(n)); want.set(c.book_id, s); }
const pageRec = new Map();
for (const [bookId, nums] of want) pageRec.set(bookId, await pageRecords(db, bookId, nums, { withText: true }));
const provenance = (c) => packetProvenance({ pagesRead: c.pages_read, packetPages: c.packetPages, now: pageRec.get(c.book_id), checkedAt: c.checked_at, provenanceFromPage });

// Build every row first, then write. A source row the helper refuses (a tier outside 1–3, a page with no number) is
// listed as skipped with the helper's reason, never written and never fatal to the rest.
const rows = [];
for (const c of cands) {
  if (c.drop) { skipped.push(`${c.source} ${c.book_id}: ${c.drop}`); continue; }
  const { source, packetPages, serious, drop, ...input } = c;
  try {
    rows.push({ source, row: buildBookCheck({ ...input, method_version: V[c.method_id], text_provenance: provenance(c) }) });
  } catch (e) { skipped.push(`${source} ${c.book_id}: ${e.message}`); }
}

const tally = {};
for (const { source, row } of rows) {
  const t = (tally[source] ??= { rows: 0, books: new Set(), show: 0, caveat: 0, fix: 0, pages: 0, prov_unknown: 0, prov_changed: 0 });
  t.rows++; t.books.add(row.book_id); t[row.verdict]++; t.pages += row.pages_read.length;
  t.prov_unknown += row.text_provenance.filter((e) => e.ocr_model === null).length;
  t.prov_changed += row.text_provenance.filter((e) => e.changed_since_check).length;
}
console.log('source            rows  books  show caveat  fix  pages  prov:no-ocr-model  prov:changed-since');
for (const [s, t] of Object.entries(tally)) console.log(`${s.padEnd(16)} ${String(t.rows).padStart(5)} ${String(t.books.size).padStart(6)} ${String(t.show).padStart(5)} ${String(t.caveat).padStart(6)} ${String(t.fix).padStart(4)} ${String(t.pages).padStart(6)} ${String(t.prov_unknown).padStart(18)} ${String(t.prov_changed).padStart(19)}`);
console.log(`total ${rows.length} rows over ${new Set(rows.map((r) => r.row.book_id)).size} books; skipped ${skipped.length}`);
for (const s of skipped) console.log(`  skip ${s}`);

if (APPLY) {
  await ensureBookCheckIndexes(db);
  let ins = 0, dup = 0;
  for (const { row } of rows) {
    const { recorded_at, recorded_by, ...input } = row;
    const r = await recordBookCheck(db, input);
    r.inserted ? ins++ : dup++;
  }
  console.log(`book_checks: ${ins} inserted, ${dup} already present`);
} else console.log('[DRY RUN] pass --apply to write');
await client.close();
