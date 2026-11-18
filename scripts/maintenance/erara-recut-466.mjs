#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/shift-repairs-5803-driver.mjs — the same driver shape (one book at a time, child
//   processes, a jsonl row a book, resumable) for the 151 books the Clef screen found. It maps text with a paid model
//   call a page and skips held books; the unread e-rara books have no text to map and are all held.
// scripts/maintenance/repair-bulk-jp2-offset.mjs — does the image write (used here as a child, with --unread); it
//   does not touch the book's cover, which names a stored page image and so shows the next leaf after a re-cut.
// scripts/maintenance/backfill-cover-selection.mjs — picks a cover by scoring OCR; an unread book has none.
/**
 * Re-cut the UNREAD e-rara books whose stored images sit one leaf off their rows (v3#466). One book at a time.
 *
 * What a reader gets: the book opens on its own first leaf instead of e-rara's PDF cover sheet, its last leaf is there,
 * and the first-read lane (which the image-set gate keeps off a shifted book) can read it.
 *
 * Per book:
 *   1. plan (no write): the book is unread by scripts/lib/erara-recut-plan.mjs unreadRecutRefusal, and the image-set
 *      gate finds every sampled page shifted. Anything else is recorded as skipped, with the reason.
 *   2. images: repair-bulk-jp2-offset.mjs --source erara_pdf --unread --apply. It keeps the old objects as versions,
 *      writes each row from its own IIIF canvas, purges the image URLs and checks the result by dHash.
 *   3. the book must now carry archive_metadata.jp2_offset_repaired with post verdict aligned. If not, the run STOPS:
 *      a half-cut book is what this repair exists to remove, and the next one is not started on top of it.
 *   4. cover: a cover that is one of the book's own page images moves one row earlier (the leaf that was chosen), through
 *      cover-write.mjs buildCoverUpdate; book fields built from the page images are cleared so they are made again.
 *   5. one book_events row (image_set_recut) and one jsonl row.
 *
 * Usage:
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/erara-recut-466.mjs \
 *     --out <results.jsonl> (--book <id> … | --from-file <ids.txt>) [--limit N] [--concurrency 4] [--apply] [--no-purge]
 *   … --verify (--book <id> … | --from-file <ids.txt>)   read-only: are the stored images their own canvases now?
 *   Without --apply it stops after step 1 and records the plan. Resumable: a book with a row in --out is not redone.
 * Exit 0: every book planned or done. Exit 3: the run stopped at a book whose re-cut did not verify.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { imageSetVerdict, IMAGE_SET_PAGE_PROJECTION } from '../lib/image-set-gate.mjs';
import { hashBuffer } from '../lib/page-alignment.mjs';
import { unreadRecutRefusal, coverAfterRecut, BOOK_IMAGE_DERIVED_UNSET } from '../lib/erara-recut-plan.mjs';
import { buildCoverUpdate } from '../lib/cover-write.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const OUT = flag('out');
const APPLY = args.includes('--apply');
const NO_PURGE = args.includes('--no-purge');
const LIMIT = Number(flag('limit', 'Infinity'));
const CONCURRENCY = flag('concurrency', '4');
const ISSUE = 466;
const ENV = flag('env-file', '/root/sourcelibrary/.env.production.local');
let ids = args.reduce((a, x, i) => (x === '--book' ? [...a, args[i + 1]] : a), []);
if (flag('from-file')) ids = ids.concat(fs.readFileSync(flag('from-file'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean));
// A re-cut that is not purged leaves the old leaf at the public URL for up to a day, and the lanes read through that
// URL: a book marked repaired but served stale is read from the wrong leaf. So there is no unpurged apply.
if (APPLY && NO_PURGE) { console.error('[REFUSE] --apply with --no-purge: the lanes would read stale images from the edge. Run where the Cloudflare purge credentials are (main).'); process.exit(1); }
if ((!OUT && !args.includes('--verify')) || !ids.length) { console.error('usage: --out <jsonl> (--book <id> … | --from-file <ids.txt>) [--limit N] [--apply] [--no-purge]'); process.exit(1); }

const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.applied === APPLY).map((r) => r.book_id) : []);
const row = (r) => { fs.appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), applied: APPLY, ...r }) + '\n'); console.log(`  ${r.book_id} ${r.outcome}${r.why ? `: ${r.why}` : ''}`); };

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const BOOK_PROJECTION = { id: 1, title: 1, visible: 1, thumbnail: 1, thumbnail_source: 1, cover_page: 1, pages_ocr: 1, pages_translated: 1, archive_metadata: 1, summary: 1, chapters: 1, index: 1, reading_summary: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold.reason': 1 };
// Whole page documents, no projection: the plan refuses on any key it does not know, so it must see every key. An
// unread book's pages are small; a book with text is refused after this one load.
const loadPages = (bookId) => db.collection('pages').find({ book_id: bookId }).sort({ page_number: 1 }).toArray();

// --verify (read-only): compare each book's stored images with their own canvases WITHOUT trusting the repaired marker
// (book = null), through cache-busted URLs so the edge cannot answer with the pre-repair object. Exit 3 unless every
// book comes back aligned.
if (args.includes('--verify')) {
  const bust = (u) => (u.startsWith('https://images.sourcelibrary.org/') ? `${u}${u.includes('?') ? '&' : '?'}_v=${Date.now()}` : u);
  const hashUrl = async (u) => { const r = await fetch(bust(u), { signal: AbortSignal.timeout(45_000) }); if (!r.ok) throw new Error(`http ${r.status}`); return hashBuffer(Buffer.from(await r.arrayBuffer())); };
  let bad = 0;
  for (const id of ids) {
    const pages = await db.collection('pages').find({ book_id: id }, { projection: IMAGE_SET_PAGE_PROJECTION }).toArray();
    const v = await imageSetVerdict(pages, null, { hashUrl });
    if (v.verdict !== 'aligned') bad++;
    console.log(`  ${id} ${v.verdict} ${JSON.stringify(v.writers.erara_pdf?.votes ?? null)}`);
  }
  await client.close();
  console.log(bad ? `${bad} of ${ids.length} book(s) NOT aligned` : `all ${ids.length} book(s) aligned`);
  process.exit(bad ? 3 : 0);
}

let n = 0, stopped = false;
for (const id of ids) {
  if (n >= LIMIT) break;
  if (done.has(id)) continue;
  n++;
  const book = await db.collection('books').findOne({ id }, { projection: BOOK_PROJECTION });
  const pages = book ? await loadPages(id) : [];
  const events = book ? await db.collection('book_events').find({ book_id: id, type: { $in: ['text_shift_repair', 'text_shift_repair_undo'] } }).toArray() : [];

  // 1. plan
  const refusal = unreadRecutRefusal({ book, pages, events });
  if (refusal) { row({ book_id: id, outcome: 'skipped', why: refusal }); continue; }
  const set = await imageSetVerdict(pages, null);
  const votes = set.writers.erara_pdf?.votes;
  if (set.verdict !== 'shifted' || !votes || votes.shift !== votes.checked || votes.checked < 3) { row({ book_id: id, outcome: 'skipped', why: `image set is ${set.verdict} (${JSON.stringify(votes ?? null)}), not shifted on every sampled page` }); continue; }
  const cover = coverAfterRecut(book, pages);
  const plan = { pages: pages.length, hold: book.pipeline_auto?.hold?.reason ?? null, votes, cover: cover ? { from: cover.from, to: cover.to } : null };
  if (!APPLY) { row({ book_id: id, outcome: 'planned', title: (book.title || '').slice(0, 70), ...plan }); continue; }

  // 2. images
  const r = spawnSync(process.execPath, [`--env-file=${ENV}`, 'scripts/maintenance/repair-bulk-jp2-offset.mjs', '--source', 'erara_pdf', '--book', id, '--unread', '--samples', '5', '--concurrency', CONCURRENCY, '--apply', ...(NO_PURGE ? ['--no-purge'] : [])], { encoding: 'utf8', timeout: 3 * 3600_000, maxBuffer: 64 << 20 });
  const log = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-12).join('\n');

  // 3. verified, or stop
  const after = await db.collection('books').findOne({ id }, { projection: { archive_metadata: 1 } });
  const ok = r.status === 0 && after?.archive_metadata?.jp2_offset_repaired === true && after.archive_metadata.jp2_offset_post_verdict === 'aligned';
  if (!ok) {
    row({ book_id: id, outcome: 'STOPPED', why: 're-cut did not verify', exit: r.status, post_verdict: after?.archive_metadata?.jp2_offset_post_verdict ?? null, log });
    stopped = true;
    break;
  }

  // 4. cover and the book fields built from the page images
  const now = new Date();
  const fresh = await loadPages(id);
  const to = cover && fresh.find((p) => p.page_number === cover.to);
  const coverSet = to ? buildCoverUpdate(to, { source: book.thumbnail_source ?? 'erara-recut-466', method: 'erara-recut-466', actor: 'script', detail: `the chosen leaf moved from row ${cover.from} to row ${cover.to} when the images were re-cut (v3#${ISSUE})` }) : null;
  await db.collection('books').updateOne({ id }, {
    ...(coverSet ? { $set: { ...coverSet, updated_at: now } } : { $set: { updated_at: now } }),
    $unset: Object.fromEntries(BOOK_IMAGE_DERIVED_UNSET.map((f) => [f, ''])),
  });

  // 5. the record
  await db.collection('book_events').insertOne({
    book_id: id, type: 'image_set_recut', at: now, source: 'erara-recut-466',
    details: { issue: ISSUE, pages: pages.length, class: 'unread', before_votes: votes, post_verdict: 'aligned', cover: plan.cover, cleared: BOOK_IMAGE_DERIVED_UNSET },
  });
  let rerender = null;
  const secret = process.env.REVALIDATE_SECRET || process.env.CRON_SECRET;
  if (!NO_PURGE && secret) {
    const rr = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${id}`, { method: 'POST', headers: { 'x-revalidate-secret': secret } }).catch((e) => ({ ok: false, status: e.message }));
    rerender = rr.ok ? 'ok' : `failed (${rr.status})`;
  }
  row({ book_id: id, outcome: 'recut', title: (book.title || '').slice(0, 70), ...plan, rerender, log: log.split('\n').slice(-5).join(' | ') });
}
await client.close();
console.log(stopped ? 'STOPPED at a book that did not verify: read its row before running again.' : `done: ${n} book(s) ${APPLY ? 'processed' : 'planned'}`);
process.exit(stopped ? 3 : 0);
