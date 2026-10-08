#!/usr/bin/env node
/**
 * Move a book's TEXT one page over a named run of pages, where a full-book Clef
 * offset map shows the run is a clean constant ±1 shift against its images (#5803).
 *
 * PRIOR ART: scripts/maintenance/repair-erara-text-shift.mjs — whole-book left shift
 *   driven by a census file on Derek's laptop, no page range, no right shift, no mirror
 *   re-sync. scripts/maintenance/repair-bulkjp2-text-shift.mjs — gated on the bulk_jp2
 *   dHash verdict and archive_metadata.source; the books here are e-rara/own-scan books
 *   whose IMAGES are right and whose text was attached one page off by the batch
 *   write-back, so neither gate fits. Both share the pure transform reused below:
 *   scripts/lib/text-shift.mjs computeTextShiftMoves().
 *
 * Direction, in the map's terms (scripts/eval/jev/clef-book-offset-map.mjs):
 *   --dir left   offset +1 over the run: image N matches text N+1 → text p(N+1) → p(N);
 *                the LAST page of the run is cleared (its text was never produced).
 *   --dir right  offset −1: image N matches text N−1 → text p(N−1) → p(N); the FIRST
 *                page of the run is cleared. Done by mirroring page numbers through
 *                the same transform, so there is one shift implementation, not two.
 * Moves every SHIFT_FIELDS field (ocr, translation and their derivatives) together:
 * the translation was made from the text beside it, so it travels with it.
 *
 * Guards (fail closed): --map must show the run as the chosen offset with NO page
 * scoring offset 0 inside it and ≥ 80% of scored pages agreeing; book with
 * hidden_reason refused; --adjudicated pages (checked by eye) leave the gate but are recorded; (#3099); split pages refused; a human-edited ocr/translation
 * in the run refused; idempotent per (book, run) via book_events; each page write is
 * conditional on the ocr it was planned from (a concurrent re-OCR → skip, not clobber).
 *
 * Writes: page_revisions snapshot of every replaced ocr/translation FIRST (source tag,
 * issue, full field under `meta`), then the pages, then pages_ocr/pages_translated,
 * a book_events row, the Supabase `pages` mirror + page_translations snippet
 * (resyncMirrors), and the page_translations EMBEDDING vectors permuted with their
 * text (free; no re-embed). A JSON backup of the pre-write fields goes to --backup-dir.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-text-shift-run.mjs \
 *     --book <id> --from A --to B --dir left --map <map.jsonl> --issue 5803 [--apply]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { computeTextShiftMoves, SHIFT_FIELDS } from '../lib/text-shift.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { isHumanEditedTranslation, resyncMirrors } from '../lib/translation-text-repair.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const BOOK = flag('book'), FROM = Number(flag('from')), TO = Number(flag('to'));
const DIR = flag('dir'), MAP = flag('map'), ISSUE = Number(flag('issue', '5803'));
const SOURCE = flag('source', `shift-repair-clef-${ISSUE}`);
const BACKUP_DIR = flag('backup-dir', 'scripts/output/text-shift-backups');
const APPLY = args.includes('--apply');
// Pages whose map row disagrees but which a human adjudicated (blank leaves, formula repeats,
// garbled OCR of a facing-page strip). Excluded from the gate, recorded on the book_event.
const ADJ = flag('adjudicated') ? flag('adjudicated').split(',').map(Number) : [];
const ADJ_WHY = flag('adjudicated-why', '');
if (ADJ.length && !ADJ_WHY) { console.error('--adjudicated needs --adjudicated-why "<how each was checked>"'); process.exit(1); }
if (!BOOK || !Number.isFinite(FROM) || !Number.isFinite(TO) || !['left', 'right'].includes(DIR) || !MAP) {
  console.error('usage: --book ID --from A --to B --dir left|right --map <offset-map.jsonl> [--issue N] [--apply]'); process.exit(1);
}
const WANT = DIR === 'left' ? 1 : -1;
const inRun = (n) => n >= FROM && n <= TO;

// ── Gate 1: the offset map must show a clean constant run ──
const map = fs.readFileSync(MAP, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => inRun(r.page) && !ADJ.includes(r.page));
const scored = map.filter((r) => typeof r.offset === 'number');
const agree = scored.filter((r) => r.offset === WANT).length;
const zero = scored.filter((r) => r.offset === 0).map((r) => r.page);
const other = scored.filter((r) => r.offset !== WANT && r.offset !== 0).map((r) => r.page);
console.log(`map ${FROM}-${TO}: ${ADJ.length} adjudicated, ${map.length} rows, ${scored.length} scored, ${agree} at offset ${WANT}, zero=[${zero}], other=[${other}], unscored=${map.length - scored.length}`);
if (zero.length || other.length || !scored.length || agree / scored.length < 0.8) {
  console.log('[REFUSE] the run is not a clean constant shift in the map'); process.exit(2);
}

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
try {
  const book = await db.collection('books').findOne({ id: BOOK }, { projection: { id: 1, title: 1, hidden_reason: 1 } });
  if (!book) throw new Error('book not found');
  if (book.hidden_reason) { console.log(`[REFUSE] hidden_reason=${book.hidden_reason}`); process.exit(2); }
  const done = await db.collection('book_events').findOne({ book_id: BOOK, type: 'text_shift_repair', 'details.run': `${FROM}-${TO}` });
  if (done) { console.log('[SKIP] this run is already repaired (book_events)'); process.exit(0); }

  const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $gte: 1 } }).sort({ page_number: 1 }).toArray();
  const run = pages.filter((p) => inRun(p.page_number));
  if (run.length !== TO - FROM + 1) throw new Error(`run has ${run.length} pages, expected ${TO - FROM + 1} (gap in page numbers)`);
  if (run.some((p) => p.split_side)) { console.log('[REFUSE] split pages in the run'); process.exit(2); }
  const human = run.filter((p) => isHumanEditedTranslation(p.translation) || p.ocr?.source === 'manual' || p.ocr?.edited_by);
  if (human.length) { console.log(`[REFUSE] human-edited text on pages ${human.map((p) => p.page_number)}`); process.exit(2); }

  // ── The transform: one implementation; the right shift mirrors page numbers through it ──
  const sign = DIR === 'left' ? 1 : -1;
  const mirrored = pages.map((p) => ({ ...p, page_number: sign * p.page_number }));
  const moves = computeTextShiftMoves(mirrored, { verdict: 'shift+1', isTarget: (p) => inRun(sign * p.page_number) })
    .map((m) => ({ ...m, page_number: sign * m.page_number, src_page_number: m.src_page_number == null ? null : sign * m.src_page_number }));
  const byNum = new Map(pages.map((p) => [p.page_number, p]));
  const cleared = moves.filter((m) => m.cleared);
  const textOf = (p) => String(p?.ocr?.data || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
  console.log(`${book.title?.slice(0, 70)}\n  ${moves.length} moves, dir ${DIR}; cleared: ${cleared.map((m) => m.page_number)} (had text: ${cleared.filter((m) => byNum.get(m.page_number).ocr?.data).length}, translation: ${cleared.filter((m) => byNum.get(m.page_number).translation?.data).length})`);
  for (const m of [moves[0], moves[1], moves[moves.length - 1]].filter(Boolean)) {
    console.log(`  p${m.page_number} ← p${m.src_page_number ?? '∅'}: "${textOf(byNum.get(m.src_page_number))}"`);
  }
  if (!APPLY) { console.log('[DRY RUN] no writes — pass --apply'); process.exit(0); }

  // ── Backup + revisions FIRST ──
  const now = new Date();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(BACKUP_DIR, `${BOOK}-${FROM}-${TO}-${now.toISOString().replace(/[:.]/g, '')}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(run.map((p) => ({ _id: String(p._id), id: p.id, page_number: p.page_number, ...Object.fromEntries(SHIFT_FIELDS.map((f) => [f, p[f]])) }))));
  const revisions = [];
  for (const p of run) {
    for (const f of ['ocr', 'translation']) {
      if (!p[f]?.data) continue;
      const { data, ...meta } = p[f];
      revisions.push({
        id: randomBytes(6).toString('hex'), page_id: p.id, book_id: BOOK, field: f, data,
        model: p[f].model ?? null, language: p[f].language ?? null, prompt_version: p[f].prompt_version ?? null,
        source: SOURCE, reason: `text shift ${DIR} over ${FROM}-${TO}: this text belongs to the ${DIR === 'left' ? 'previous' : 'next'} page's image`,
        issue: ISSUE, edited_by: null, job_id: null, original_date: p[f].updated_at ?? null, created_at: now, meta,
      });
    }
  }
  if (revisions.length) await db.collection('page_revisions').insertMany(revisions);

  // ── Pages, each conditional on the ocr it was planned from ──
  const ops = moves.map((m) => {
    const dst = byNum.get(m.page_number);
    const update = { $set: { ...m.set, updated_at: now, text_shift_repaired_at: now } };
    if (m.unset.length) update.$unset = Object.fromEntries(m.unset.map((f) => [f, '']));
    return { updateOne: { filter: { _id: dst._id, 'ocr.updated_at': dst.ocr?.updated_at ?? null }, update } };
  });
  const res = await db.collection('pages').bulkWrite(ops, { ordered: true });
  console.log(`  pages written: ${res.modifiedCount}/${ops.length}; revisions ${revisions.length}; backup ${backupFile}`);
  if (res.modifiedCount !== ops.length) console.log('  [WARN] some pages changed under us — inspect before purging');

  await recountBook(db, BOOK, { reason: 'repair-text-shift-run', now });
  await db.collection('book_events').insertOne({
    book_id: BOOK, type: 'text_shift_repair', at: now, source: 'repair-text-shift-run',
    details: { run: `${FROM}-${TO}`, dir: DIR, pages: moves.length, cleared: cleared.map((m) => m.page_number), revisions: revisions.length, revision_source: SOURCE, map: MAP, adjudicated: ADJ, adjudicated_why: ADJ_WHY || undefined, issue: ISSUE, backup: backupFile },
  });

  // ── Supabase: pages mirror + snippet (resyncMirrors), then permute embedding vectors ──
  const ids = run.map((p) => p.id);
  console.log('  mirrors:', JSON.stringify(await resyncMirrors(db, ids)));
  if (process.env.SUPABASE_DB_URL) {
    const { default: pg } = await import('pg');
    const sb = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await sb.connect();
    try {
      const old = new Map((await sb.query('SELECT page_id, embedding, mongo_updated_at FROM page_translations WHERE page_id = ANY($1)', [ids])).rows.map((r) => [r.page_id, r]));
      let moved = 0, nulled = 0;
      for (const m of moves) {
        const dstId = byNum.get(m.page_number).id;
        if (!old.has(dstId)) continue;
        const src = m.src_page_number == null ? null : old.get(byNum.get(m.src_page_number).id);
        if (src) { await sb.query('UPDATE page_translations SET embedding = $1 WHERE page_id = $2', [src.embedding, dstId]); moved++; }
        else { await sb.query("UPDATE page_translations SET embedding = NULL, translation = '' WHERE page_id = $1", [dstId]); nulled++; }
      }
      console.log(`  page_translations embeddings: ${moved} permuted, ${nulled} cleared (no source row)`);
    } finally { await sb.end(); }
  }
  console.log('[OK] applied — re-run the offset map, eye 5 leaves, purge the book on Cloudflare');
} finally { await client.close(); }
