#!/usr/bin/env node
/**
 * PRIOR ART: score.mjs (validates results.json and prints the series row: one number per run, no per-finding rows);
 * ops quality-sprint/2026-10-06-round0/findings-issue-6048.md (round 0's register, written by hand as prose). Nothing
 * turned a run's reviews into finding ROWS that can be clustered across rounds, which is what #6056 step 3–4 needs.
 *
 * register — one row per moderate-or-serious finding of a spot-check run, with its lane, and the cross-round cluster
 * table (#6056).
 *
 *   node scripts/eval/spot-check/register.mjs --dir scripts/eval/results/spot-check/sprint-2026-10-07-r1 [--forms forms.json]
 *   node scripts/eval/spot-check/register.mjs --cluster [--root scripts/eval/results/spot-check]
 *
 * Row: round, frame, book, page, url, list (ocr|tr|other), class, severity, note, lane {ocr_model, tr_model, language, form}.
 * `form` (MS | print | photo-of-print …) is not stored on books; the round passes it in --forms ({book_id: form}),
 * read off the images by whoever registers the round. Reviewer verdicts are copied, never edited.
 * --cluster reads findings.json in every sprint- run dir and lists, per class (serious only), instances and distinct books;
 * a class with ≥ 3 instances in ≥ 2 books is a general candidate.
 *
 * --dir also records one `book_checks` row per reviewed book (#6174, method fortnightly-spot-check) when MONGODB_URI is
 * set: the verdict derived by the method's rule (REVIEWER.md asks for none), the sample's model ids as the text read,
 * and the book's share of its packet's `claude -p` cost when run-reviewers.sh launched it. --no-record skips it.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { recordBookCheck, ensureBookCheckIndexes, provenanceFromPage, readMethod } from '../../lib/book-checks.mjs';
import { seriousClasses, derivedFortnightly, pageRecords, packetProvenance, runCost, checkedAtOf } from './check-rows.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

if (args.includes('--cluster')) {
  const root = opt('root', 'scripts/eval/results/spot-check');
  const rows = readdirSync(root).filter((d) => d.startsWith('sprint-') && existsSync(join(root, d, 'findings.json')))
    .flatMap((d) => JSON.parse(readFileSync(join(root, d, 'findings.json'), 'utf8')));
  // The unit is the BOOK: one garbled book can produce ten instances of a class (round 1: the Cremona Zohar made
  // most of O6's eleven), so a class is a general candidate only when ≥ 3 DISTINCT books carry it. Forms and frames
  // are counted per book, and frames are never pooled into one rate (canon ≠ public).
  const by = new Map();
  for (const r of rows.filter((r) => r.severity === 'serious')) {
    const c = by.get(r.class) || { class: r.class, n: 0, books: new Map(), example: r.url };
    c.n++; c.books.set(r.book_id, { form: r.lane.form, frame: r.frame ?? 'unrecorded' });
    by.set(r.class, c);
  }
  const tally = (c, k) => [...c.books.values()].reduce((m, b) => ({ ...m, [b[k]]: (m[b[k]] || 0) + 1 }), {});
  const out = [...by.values()].sort((a, b) => b.books.size - a.books.size || b.n - a.n).map((c) => ({ class: c.class, books: c.books.size, serious: c.n,
    candidate: c.books.size >= 3, forms: tally(c, 'form'), frames: tally(c, 'frame'), example: c.example }));
  writeFileSync(join(root, 'sprint-clusters.json'), JSON.stringify({ rounds: new Set(rows.map((r) => r.round)).size, rows: rows.length, rule: '≥3 distinct books', classes: out }, null, 2));
  for (const c of out) console.log(`${c.candidate ? '*' : ' '} ${String(c.class).padEnd(18)} ${String(c.books).padStart(2)} books (${c.serious} serious)  forms ${JSON.stringify(c.forms)} frames ${JSON.stringify(c.frames)}`);
  process.exit(0);
}

const dir = opt('dir');
if (!dir) { console.error('--dir <run dir> or --cluster'); process.exit(1); }
const sample = JSON.parse(readFileSync(join(dir, 'sample.json'), 'utf8'));
const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
const forms = opt('forms') ? JSON.parse(readFileSync(opt('forms'), 'utf8')) : {};
const round = dir.split('/').filter(Boolean).pop();
const frame = existsSync(join(dir, 'draw-log.json')) ? JSON.parse(readFileSync(join(dir, 'draw-log.json'), 'utf8')).frame : 'unrecorded';
const sampleBooks = sample.books || sample;
const rows = [];
for (const book of results) {
  const s = sampleBooks.find((b) => b.book_id === book.book_id);
  for (const page of book.pages) {
    const sp = s?.pages.find((p) => p.page_number === page.page_number) || {};
    const lane = { ocr_model: sp.ocr_model ?? null, tr_model: sp.translation_model ?? null, language: s?.book?.language ?? null, form: forms[book.book_id] ?? 'unrecorded' };
    for (const [list, errs] of [['ocr', page.ocr_errors], ['tr', page.tr_errors], ['other', page.other]]) {
      for (const e of errs || []) {
        if (e.severity === 'minor') continue;
        rows.push({ round, frame, book_id: book.book_id, title: book.title, page: page.page_number,
          url: `https://sourcelibrary.org/book/${book.book_id}?page=${page.page_number}`, list, class: e.class ?? 'unclassed', severity: e.severity,
          note: e.problem ?? e.note, lane });
      }
    }
  }
}
writeFileSync(join(dir, 'findings.json'), JSON.stringify(rows, null, 2));
console.log(`${round}: ${rows.length} findings (${rows.filter((r) => r.severity === 'serious').length} serious) → ${join(dir, 'findings.json')}`);

// ── the record (#6174) ──
if (args.includes('--no-record')) process.exit(0);
if (!process.env.MONGODB_URI) { console.error('book_checks: MONGODB_URI not set, no rows recorded (run with --env-file, or pass --no-record)'); process.exit(0); }
const { MongoClient } = await import('mongodb');
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
await ensureBookCheckIndexes(db);
const version = readMethod('fortnightly-spot-check').version;
// Which packet each book was reviewed in, for its share of that packet's cost.
const packetOf = new Map(), packetSize = new Map();
if (existsSync(join(dir, 'reviews'))) for (const f of readdirSync(join(dir, 'reviews')).filter((x) => x.endsWith('.json'))) {
  const books = JSON.parse(readFileSync(join(dir, 'reviews', f), 'utf8'));
  for (const b of books) packetOf.set(b.book_id, f.replace(/\.json$/, ''));
  packetSize.set(f.replace(/\.json$/, ''), books.length);
}
const checkedAt = checkedAtOf(join(dir, 'results.json'));
let ins = 0, dup = 0, skip = 0;
for (const book of results) {
  const pagesRead = book.pages.map((p) => p.page_number);
  const now = await pageRecords(db, book.book_id, pagesRead, { withText: true });
  const pk = packetOf.get(book.book_id);
  const cost = pk ? runCost(dir, pk) : null;
  let r;
  try { r = await recordBookCheck(db, {
    book_id: book.book_id, checked_at: checkedAt, method_id: 'fortnightly-spot-check', method_version: version, run_id: round,
    frame: { draw: round, frame, checked_at_source: 'results.json (git add or mtime)' },
    pages_read: pagesRead, reader: { kind: 'model', model: cost?.model ?? 'opus', image_opened: true },
    verdict: derivedFortnightly(book), verdict_source: 'derived:fortnightly-v1', classes: seriousClasses(book.pages), note: book.book_verdict,
    evidence_path: join(dir, 'results.json'),
    text_provenance: packetProvenance({ pagesRead, packetPages: sampleBooks.find((b) => b.book_id === book.book_id)?.pages, now, checkedAt, provenanceFromPage }),
    ...(cost ? { subscription_usd_eq: +(cost.usd / packetSize.get(pk)).toFixed(4) } : {}),
  }); } catch (e) { console.error(`book_checks: ${book.book_id} refused — ${e.message}`); skip++; continue; }
  r.inserted ? ins++ : dup++;
}
console.log(`book_checks: ${ins} recorded, ${dup} already present, ${skip} refused (see above)`);
await client.close();
