#!/usr/bin/env node
/**
 * Re-point a book's TEXT onto the leaves it was read from, when the text is off its
 * images by an offset that differs between stretches of the book (#7949).
 *
 * PRIOR ART: scripts/maintenance/repair-text-shift-run.mjs moves text by exactly ±1 over
 *   one run, gated on a Clef offset map; the Huser Paracelsus (69bd9d546120d54bd0375241)
 *   is −1 over leaves 1–79 and −3 after, and has no Clef map. repair-erara-text-shift.mjs
 *   is whole-book +1 from a laptop census file. This script reuses their write path
 *   (page_revisions first, backup, conditional writes, recount, book_events, mirrors,
 *   embedding permutation) and the shared field list SHIFT_FIELDS.
 *
 * Gate (fail closed): the move plan is SIMULATED and the result is read against the IIIF
 * canvas labels (scripts/lib/canvas-label-alignment.mjs). The script refuses unless the
 * book scores `shifted` before and at least --min-aligned (default 0.95) of scored pages
 * land at offset 0 after. A wrong segment spec therefore cannot be written.
 * A book the labels cannot score (ordinal labels, or an unreachable manifest) is refused
 * unless --by-eye names the opened slots that showed the moved text, one near each end of
 * every segment; the gate used is recorded on the book_events row.
 * Also refused: human-edited text in scope, split pages, a book already repaired
 * (book_events text_shift_repair with the same spec).
 *
 * Writes (only with --apply): page_revisions snapshot of every replaced ocr/translation,
 * a JSON backup, the pages (each conditional on the ocr it was planned from), page
 * counts, a book_events row, the Supabase pages mirror + page_translations text, and the
 * page_translations embedding vectors permuted with their text. Cleared pages (leaves
 * never read) are listed so they can be queued for OCR.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-text-offset-segments.mjs \
 *     --book <id> --segments "1-79:+1,80-4162:+3" --issue 7949 [--apply] [--no-purge]
 *
 * After the write it asks the site to re-render the book (POST /api/admin/revalidate-book/<id>,
 * which also purges the book's landing URLs from Cloudflare), so readers stop getting the
 * pre-repair text from a cached render (#8277). --apply refuses to start without
 * CRON_SECRET or REVALIDATE_SECRET unless --no-purge is given.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { computeSegmentMoves, parseSegments, SHIFT_FIELDS } from '../lib/text-shift.mjs';
import { labelNumber, ordinalLabels, slotOffsets, bookVerdict, offsetRuns } from '../lib/canvas-label-alignment.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { isHumanEditedTranslation, resyncMirrors } from '../lib/translation-text-repair.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const BOOK = flag('book'), SPEC = flag('segments'), ISSUE = Number(flag('issue', '7949'));
const MIN_ALIGNED = Number(flag('min-aligned', '0.95'));
const SOURCE = flag('source', `shift-repair-segments-${ISSUE}`);
const BACKUP_DIR = flag('backup-dir', 'scripts/output/text-shift-backups');
const APPLY = args.includes('--apply');
const NO_PURGE = args.includes('--no-purge');
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET || process.env.CRON_SECRET;
if (APPLY && !NO_PURGE && !REVALIDATE_SECRET) {
  console.error('[REFUSE] no CRON_SECRET / REVALIDATE_SECRET to re-render the book after the repair (#8277) — run with the production env, or pass --no-purge');
  process.exit(1);
}
// Finish only the Supabase step of a repair already written to Mongo (e.g. it ran without
// SUPABASE_DB_URL). Valid only while page_translations is untouched: moves are recomputed from
// the spec, and each row's embedding is permuted from the row of the slot its text came from.
const MIRRORS_ONLY = args.includes('--mirrors-only');
// Re-point KNOWN shortlinks (seen in analytics_events) to the slot their text moved to, as
// split-swap.mjs does for #7605. A code is (book, page number) and nothing else, so a code minted
// AFTER the repair for the same number is also redirected: the trade taken on #7605. Unknown codes
// cannot be found and are not touched.
const SHORTLINKS_ONLY = args.includes('--shortlinks-only');
// Books the label gate cannot score (e-rara ordinal labels, or a manifest this box cannot fetch:
// e-rara answers 403 to clawdbot): the slots whose image was OPENED and showed the text this move
// puts on them. Each segment needs one in its first third and one in its last third. Used only when
// the labels cannot score; a book they can score is still gated on them.
const BY_EYE = flag('by-eye') ? flag('by-eye').split(',').map(Number) : null;
if (!BOOK || !SPEC) { console.error('usage: --book ID --segments "A-B:+d,C-D:+e" [--issue N] [--by-eye S1,S2] [--apply]'); process.exit(1); }
const segments = parseSegments(SPEC);
if (BY_EYE) {
  for (const s of segments) {
    const third = (s.to - s.from) / 3;
    const ok = BY_EYE.some((n) => n >= s.from && n <= s.from + third) && BY_EYE.some((n) => n <= s.to && n >= s.to - third);
    if (!ok) { console.log(`[REFUSE] --by-eye needs an opened slot in the first and last third of ${s.from}-${s.to}`); process.exit(2); }
  }
}


async function redirectKnownShortlinks(pages, moves, repairedAt) {
  const byNum = new Map(pages.map((p) => [p.page_number, p]));
  // Where did the text that sat on slot N go? To the target whose source was N.
  const movedTo = new Map(moves.filter((m) => m.src_page_number != null).map((m) => [m.src_page_number, m.page_number]));
  const seen = await db.collection('analytics_events').aggregate([
    { $match: { event: 'shortlink_visit', book_id: BOOK, created_at: { $lt: repairedAt } } },
    { $group: { _id: '$code', page_number: { $first: '$page_number' } } },
  ]).toArray();
  let written = 0;
  const unmapped = [];
  if (seen.length) await db.collection('shortlink_redirects').createIndex({ code: 1 }, { unique: true });
  for (const c of seen) {
    const to = movedTo.get(c.page_number);
    if (to == null || to === c.page_number) { if (to == null) unmapped.push(c._id); continue; }
    await db.collection('shortlink_redirects').updateOne(
      { code: c._id },
      { $set: { code: c._id, book_id: BOOK, page_number: c.page_number, page_id: byNum.get(to).id, to_page_number: to, reason: `text re-pointed by leaf offset #${ISSUE}`, created_at: new Date() } },
      { upsert: true },
    );
    written++;
  }
  console.log(`  shortlinks: ${seen.length} known codes, ${written} redirected, unmapped (text on no page): ${unmapped.join(' ') || 'none'}`);
}

async function syncMirrors(pages, moves) {
  const byNum = new Map(pages.map((p) => [p.page_number, p]));
  const ids = moves.map((m) => byNum.get(m.page_number).id);
  console.log('  mirrors:', JSON.stringify(await resyncMirrors(db, ids)));
  if (!process.env.SUPABASE_DB_URL) return;
  const { default: pg } = await import('pg');
  const sb = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await sb.connect();
  try {
    const all = pages.map((p) => p.id);
    const old = new Map((await sb.query('SELECT page_id, embedding FROM page_translations WHERE page_id = ANY($1)', [all])).rows.map((r) => [r.page_id, r]));
    let moved = 0, nulled = 0;
    for (const m of moves) {
      const dstId = byNum.get(m.page_number).id;
      const src = m.src_page_number == null ? null : old.get(byNum.get(m.src_page_number).id);
      if (src) { await sb.query('UPDATE page_translations SET embedding = $1 WHERE page_id = $2', [src.embedding, dstId]); moved++; }
      else if (old.has(dstId)) { await sb.query("UPDATE page_translations SET embedding = NULL, translation = '' WHERE page_id = $1", [dstId]); nulled++; }
    }
    console.log(`  page_translations embeddings: ${moved} permuted, ${nulled} cleared`);
  } finally { await sb.end(); }
}

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
try {
  const book = await db.collection('books').findOne({ id: BOOK }, { projection: { id: 1, title: 1, image_source: 1 } });
  if (!book) throw new Error('book not found');
  const manifest = book.image_source?.iiif_manifest;
  // No manifest (most Internet Archive books): only the by-eye gate can pass (#5803).
  if (!manifest && !BY_EYE) { console.log('[REFUSE] no IIIF manifest to gate on (pass --by-eye with the opened slots)'); process.exit(2); }
  const done = await db.collection('book_events').findOne({ book_id: BOOK, type: 'text_shift_repair', 'details.segments': SPEC });
  if (done && !MIRRORS_ONLY && !SHORTLINKS_ONLY) { console.log('[SKIP] already repaired with this spec (book_events)'); process.exit(0); }
  if (SHORTLINKS_ONLY) {
    if (!done) { console.log('[REFUSE] --shortlinks-only needs a recorded repair with this spec'); process.exit(2); }
    const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $gte: 1 } }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();
    await redirectKnownShortlinks(pages, computeSegmentMoves(pages, segments), done.at);
    process.exit(0);
  }
  if (MIRRORS_ONLY) {
    if (!done) { console.log('[REFUSE] --mirrors-only needs a recorded repair with this spec'); process.exit(2); }
    if (done.details?.mirrors_synced_at) { console.log('[SKIP] mirrors already synced'); process.exit(0); }
    if (!process.env.SUPABASE_DB_URL) { console.log('[REFUSE] SUPABASE_DB_URL unset'); process.exit(2); }
    const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $gte: 1 } }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();
    const moves = computeSegmentMoves(pages, segments);
    await syncMirrors(pages, moves);
    await db.collection('book_events').updateOne({ _id: done._id }, { $set: { 'details.mirrors_synced_at': new Date() } });
    process.exit(0);
  }

  let labels = null;
  if (!manifest) console.log('  no IIIF manifest: gating by eye');
  else try {
    const mj = await (await fetch(manifest, { signal: AbortSignal.timeout(60000) })).json();
    labels = (mj.sequences?.[0]?.canvases ?? mj.items ?? []).map((c) => labelNumber(c.label));
    // Ordinal labels (every IA manifest) are not printed numbers: the labels cannot score this book.
    if (ordinalLabels(labels)) { console.log('  manifest labels are canvas ordinals, not printed numbers: the labels cannot score'); labels = null; }
  } catch (e) {
    if (!BY_EYE) throw e;
    console.log(`  manifest unreadable here (${e.message.slice(0, 60)}): gating by eye`);
  }

  const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $gte: 1 } }).sort({ page_number: 1 }).toArray();
  if (labels && labels.length !== pages.length) { console.log(`[REFUSE] manifest has ${labels.length} canvases, book has ${pages.length} pages`); process.exit(2); }
  labels ??= [];
  if (pages.some((p) => p.split_side)) { console.log('[REFUSE] split pages in the book'); process.exit(2); }

  const moves = computeSegmentMoves(pages, segments);
  const byNum = new Map(pages.map((p) => [p.page_number, p]));
  const scope = moves.map((m) => byNum.get(m.page_number));
  const human = scope.filter((p) => isHumanEditedTranslation(p.translation) || p.ocr?.source === 'manual' || p.ocr?.edited_by);
  if (human.length) { console.log(`[REFUSE] human-edited text on pages ${human.map((p) => p.page_number).slice(0, 20)}`); process.exit(2); }

  // ── Gate: before must be shifted, simulated after must be aligned ──
  const before = bookVerdict(slotOffsets(pages, labels));
  const after = pages.map((p) => ({ ...p }));
  const afterBy = new Map(after.map((p) => [p.page_number, p]));
  for (const m of moves) {
    const p = afterBy.get(m.page_number);
    Object.assign(p, m.set);
    for (const f of m.unset) delete p[f];
  }
  const afterRows = slotOffsets(after, labels);
  const afterV = bookVerdict(afterRows);
  const zeroShare = (afterV.histogram?.[0] ?? 0) / (afterV.scored || 1);
  console.log(`${book.title?.slice(0, 70)}`);
  console.log(`  before: ${before.verdict} k=${before.offset} share=${before.share?.toFixed(3)} scored=${before.scored}`);
  console.log(`  after (simulated): ${afterV.verdict} offset-0 share=${zeroShare.toFixed(3)} scored=${afterV.scored} ${JSON.stringify(afterV.histogram)}`);
  const residual = offsetRuns(afterRows).filter((r) => r.offset !== 0 && r.scored >= 3);
  if (residual.length) console.log(`  residual non-zero runs after the move (read by eye): ${residual.map((r) => `${r.from}-${r.to}:${r.offset}(${r.scored})`).join(' ')}`);
  const gate = BY_EYE && before.verdict === 'unscored' ? { by: 'eye', slots: BY_EYE } : { by: 'labels' };
  if (gate.by === 'eye') console.log(`  gate: labels cannot score this book; by eye at slots ${BY_EYE.join(',')}`);
  else if (before.verdict !== 'shifted' || zeroShare < MIN_ALIGNED) { console.log(`[REFUSE] gate: need before=shifted and after offset-0 share >= ${MIN_ALIGNED}`); process.exit(2); }

  const cleared = moves.filter((m) => m.cleared).map((m) => m.page_number);
  // Text whose slot is overwritten (a move target) and which no move carries elsewhere. Slots outside every segment keep their text.
  const targets = new Set(moves.map((m) => m.page_number));
  const sources = new Set(moves.map((m) => m.src_page_number));
  const orphaned = [...targets].filter((n) => byNum.get(n).ocr?.data && !sources.has(n));
  const textOf = (p) => String(p?.ocr?.data || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
  console.log(`  ${moves.length} moves; cleared (never read, queue OCR): ${cleared}; text left on no page (snapshotted): ${orphaned}`);
  for (const s of segments) {
    const m = moves.find((x) => x.page_number === s.from);
    if (m) console.log(`  p${m.page_number} ← p${m.src_page_number ?? '∅'}: "${textOf(byNum.get(m.src_page_number))}"`);
  }
  if (!APPLY) { console.log('[DRY RUN] no writes — pass --apply'); process.exit(0); }

  // ── Backup + revisions FIRST ──
  const now = new Date();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(BACKUP_DIR, `${BOOK}-segments-${now.toISOString().replace(/[:.]/g, '')}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(scope.map((p) => ({ _id: String(p._id), id: p.id, page_number: p.page_number, ...Object.fromEntries(SHIFT_FIELDS.map((f) => [f, p[f]])) }))));
  const revisions = [];
  for (const p of scope) {
    for (const f of ['ocr', 'translation']) {
      if (!p[f]?.data) continue;
      const { data, ...meta } = p[f];
      revisions.push({
        id: randomBytes(6).toString('hex'), page_id: p.id, book_id: BOOK, field: f, data,
        model: p[f].model ?? null, language: p[f].language ?? null, prompt_version: p[f].prompt_version ?? null,
        source: SOURCE, reason: `text re-pointed by leaf offset (${SPEC}): this text was read from another leaf`,
        issue: ISSUE, edited_by: null, job_id: null, original_date: p[f].updated_at ?? null, created_at: now, meta,
      });
    }
  }
  for (let i = 0; i < revisions.length; i += 1000) await db.collection('page_revisions').insertMany(revisions.slice(i, i + 1000));

  const unflagged = [];
  const ops = moves.map((m) => {
    const dst = byNum.get(m.page_number);
    const update = { $set: { ...m.set, updated_at: now, text_shift_repaired_at: now } };
    if (m.unset.length) update.$unset = Object.fromEntries(m.unset.map((f) => [f, '']));
    // The #3368 flag says "this text was read from a shifted image". A page that now holds the text of
    // its own leaf no longer is that (#5803); a cleared page keeps it, since it still needs a read.
    if (m.src_page_number != null && dst.needs_reocr_reason === 'jp2-offset-repair-#3368') {
      update.$unset = { ...(update.$unset || {}), needs_reocr: '', needs_reocr_reason: '' };
      unflagged.push(m.page_number);
    }
    return { updateOne: { filter: { _id: dst._id, 'ocr.updated_at': dst.ocr?.updated_at ?? null }, update } };
  });
  const res = await db.collection('pages').bulkWrite(ops, { ordered: true });
  console.log(`  pages written: ${res.modifiedCount}/${ops.length}; revisions ${revisions.length}; backup ${backupFile}`);
  if (res.modifiedCount !== ops.length) console.log('  [WARN] some pages changed under us — inspect before purging');

  await recountBook(db, BOOK, { reason: 'repair-text-offset-segments', now });
  await db.collection('book_events').insertOne({
    book_id: BOOK, type: 'text_shift_repair', at: now, source: 'repair-text-offset-segments',
    details: { segments: SPEC, gate, pages: moves.length, cleared, orphaned, needs_reocr_cleared: unflagged, revisions: revisions.length, revision_source: SOURCE, before, after: { histogram: afterV.histogram, zero_share: zeroShare }, issue: ISSUE, backup: backupFile },
  });

  await redirectKnownShortlinks(pages, moves, now);
  await syncMirrors(pages, moves);
  if (process.env.SUPABASE_DB_URL) await db.collection('book_events').updateOne({ book_id: BOOK, type: 'text_shift_repair', 'details.segments': SPEC }, { $set: { 'details.mirrors_synced_at': new Date() } });
  if (!process.env.SUPABASE_DB_URL) console.log('  [WARN] mirrors NOT synced: re-run from the main checkout under secret-lover with --mirrors-only');
  if (!NO_PURGE) {
    // Re-render + Cloudflare purge of the book's landing URLs, as shift-repairs-5803-driver.mjs does.
    const r = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${BOOK}`, { method: 'POST', headers: { 'x-revalidate-secret': REVALIDATE_SECRET } }).catch((e) => ({ ok: false, status: e.message }));
    console.log(r.ok ? '  book re-rendered and its landing URLs purged' : `  [WARN] revalidate-book failed (${r.status}) — readers may see the old text until the cache expires; re-run that POST by hand`);
  }
  console.log('[OK] applied — re-run scripts/audit/canvas-label-alignment.mjs --book, eye 5 leaves');
} finally { await client.close(); }
