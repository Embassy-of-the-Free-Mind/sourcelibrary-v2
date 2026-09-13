#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/dehyphenate-ia-ocr.mjs (same population — `ocr.source: 'ia_djvu'`
 * pages driven from `book_events` — same write discipline: revision first, exact-text match on the
 * update, one sweep_log row per book; it rewrites the text IN PLACE, this one replaces it with a
 * different leaf); scripts/maintenance/repair-bulkjp2-text-shift.mjs (#3368 — moves MODEL text one
 * page along for books whose OCR was read from shifted images; refuses IA text and cannot know the
 * per-book leaf offset); scripts/import/ia-ocr-ingest.mjs (the writer whose offset this undoes).
 *
 * repair-ia-ocr-leaf-offset — re-point Internet Archive OCR pages written at a non-zero leaf offset
 * to the leaf at offset 0, i.e. their own IIIF leaf (#4790).
 *
 * WHY. The Archive's `_djvu.xml` OBJECT sequence and the IIIF `/page/n<k>` index skip the same
 * scandata-excluded leaves, so the correct offset is 0 for every book. The ingester's offset search
 * (2026-09-12) fitted the XML to reference pages that had been OCR'd from #3368 bulk-archived images
 * — images that do NOT skip those leaves — and wrote 51,851 pages in 236 books at −1/−2/−3: each
 * carries the neighbouring leaf's text. Established on #4790 with three independent hand checks.
 *
 * WHICH BOOKS — only CLASS A (Derek, 2026-09-13: "do it. then fix"):
 *   image side ALIGNED with IIIF (dHash, or IIIF-archived, or no excluded leaf before the written
 *   pages) AND text offset ≠ 0. There the reader sees the wrong text NOW and the fix is visible.
 *   CLASS C (images #3368-shifted AND text at a compensating offset) is REFUSED: text and image agree
 *   on screen today; re-pointing the text alone would make a provenance error visible. Those wait for
 *   the image repair and must be done together. Ambiguous / unknown image verdicts count as CLASS C.
 *   The class comes from the joined rows of scripts/audit/ia-ocr-leaf-drift.mjs (`--from`).
 *
 * WHAT IT WRITES, per page with `ocr.source === 'ia_djvu'` (never model text): `ocr.data` ← leaf at
 * offset 0 from the leaves cache, dehyphenated exactly as the ingester does; `ocr.source_url` ← the
 * new leaf; `ocr.agreement_ref.offset` ← 0 with `repaired_from_offset`; `ocr.updated_at`. The current
 * text is saved to `page_revisions` first (`reason: 'ia_ocr_leaf_repair'`). The update matches the
 * exact current text, so a page another job rewrote in between is skipped and counted. A page whose
 * offset-0 leaf carries no words (< 20 tokens) is NOT rewritten: it is counted as `empty_target` and
 * listed — the text there is still wrong, but clearing it is a separate decision (`--clear-empty`).
 * Idempotent: a second run changes 0 pages. One sweep_log row and one book_events row per book.
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-ia-ocr-leaf-offset.mjs --from <leaf-drift joined.jsonl>            # counts per class
 *   node scripts/maintenance/repair-ia-ocr-leaf-offset.mjs --from <joined.jsonl> --apply --progress <file.jsonl>
 * Options: --book <id> (one book, must still be CLASS A)  --limit N  --cache /root/sl-ia-cache  --clear-empty
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { dehyphenateLineBreaks } from '../lib/dehyphenate.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';

const arg = (k, d) => { const eq = process.argv.find((a) => a.startsWith(`${k}=`)); if (eq) return eq.slice(k.length + 1); const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply'), CLEAR_EMPTY = process.argv.includes('--clear-empty');
const FROM = arg('--from', null), BOOK = arg('--book', null), LIMIT = +arg('--limit', 1000000), CACHE = arg('--cache', '/root/sl-ia-cache'), PROGRESS = arg('--progress', null);
const SOURCE = 'ia_djvu', SWEEP = 'ia-ocr-leaf-repair-2026-09', REASON = 'ia_ocr_leaf_repair';
if (!FROM) { console.error('--from <joined.jsonl> is required (scripts/audit/ia-ocr-leaf-drift.mjs → join)'); process.exit(2); }

const tokens = (s) => (s || '').replace(/<[^>]+>/g, ' ').normalize('NFC').toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const leafIndex = (p) => { const m = String(p.photo || p.archived_photo || '').match(/\/page\/n(\d+)\//); return m ? +m[1] : (p.page_number || 1) - 1; };
function loadLeaves(iaId) { const j = path.join(CACHE, `${iaId}.leaves.json`); if (!fs.existsSync(j)) return null; return JSON.parse(fs.readFileSync(j, 'utf8')).map(dehyphenateLineBreaks); }

/** CLASS from a joined row: A = repair, C = hold (agree on screen / cannot classify), B = not ours, OK = nothing to do. */
function classOf(r) {
  if (r.offset === 0) return r.cls?.includes('SHIFTED') ? 'B' : 'OK';
  if (r.cls?.includes('SHIFTED') || r.cls?.includes('ambiguous') || r.cls?.includes('no scandata')) return 'C';
  return 'A'; // iiif-archived, images ALIGNED, or no excluded leaf before the written pages
}

const rows = fs.readFileSync(FROM, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byClass = { A: [], B: [], C: [], OK: [] }; for (const r of rows) byClass[classOf(r)].push(r);
console.log(`classes from ${FROM}: A (repair) ${byClass.A.length} books / ${byClass.A.reduce((s, r) => s + r.written, 0)} written pages | C (hold) ${byClass.C.length} / ${byClass.C.reduce((s, r) => s + r.written, 0)} | B (image repair) ${byClass.B.length} / ${byClass.B.reduce((s, r) => s + r.written, 0)} | OK ${byClass.OK.length}`);
const targets = (BOOK ? byClass.A.filter((r) => r.book_id === BOOK) : byClass.A).slice(0, LIMIT);
if (BOOK && !targets.length) { console.error(`${BOOK} is not CLASS A — refusing`); process.exit(2); }
const done = new Set(PROGRESS && fs.existsSync(PROGRESS) ? fs.readFileSync(PROGRESS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book_id) : []);
const totals = { books: 0, pages_ia: 0, pages_changed: 0, pages_unchanged: 0, empty_target: 0, not_matched: 0, revisions: 0, skipped_hidden: 0, no_leaves: 0 };
const emptyList = [];

await withMongo(async (db) => {
  const P = db.collection('pages'), B = db.collection('books');
  for (const r of targets) {
    if (done.has(r.book_id)) continue;
    const b = await B.findOne({ id: r.book_id }, { projection: { id: 1, _id: 1, title: 1, hidden_reason: 1, ia_identifier: 1, image_source: 1, pages_count: 1, pages_ocr: 1 } });
    if (!b) continue;
    if (b.hidden_reason) { totals.skipped_hidden++; console.log(`  ${b.id} hidden_reason set — skip`); continue; }
    const iaId = b.ia_identifier || b.image_source?.identifier; const leaves = iaId ? loadLeaves(iaId) : null;
    if (!leaves) { totals.no_leaves++; console.log(`  ${b.id} no leaves cache — skip`); continue; }
    const pages = await P.find({ book_id: b.id, 'ocr.source': SOURCE }, { projection: { id: 1, page_number: 1, photo: 1, archived_photo: 1, 'ocr.data': 1, 'ocr.agreement_ref': 1 } }).sort({ page_number: 1 }).toArray();
    const changes = [], empties = []; let unchanged = 0;
    for (const p of pages) {
      const k = leafIndex(p); const target = k >= 0 && k < leaves.length ? leaves[k] : '';
      if (tokens(target).length < 20) { empties.push({ page_id: p.id, page_number: p.page_number, leaf: k }); continue; }
      if (norm(target) === norm(p.ocr?.data)) { unchanged++; continue; }
      changes.push({ p, k, target });
    }
    totals.books++; totals.pages_ia += pages.length; totals.pages_unchanged += unchanged; totals.empty_target += empties.length;
    for (const e of empties) emptyList.push({ book_id: b.id, ...e });
    const fromOffset = r.offset;
    console.log(`  ${b.id} ${(b.title || '').slice(0, 44).padEnd(44)} offset ${fromOffset} → 0 | ia pages ${pages.length} | change ${changes.length} | unchanged ${unchanged} | empty target ${empties.length}`);
    if (!APPLY) { totals.pages_changed += changes.length; continue; }
    const now = new Date();
    const rev = await saveRevisionsBeforeOverwrite(db, changes.map((c) => c.p.id), 'ocr', { reason: REASON });
    let modified = 0;
    if (changes.length) {
      const res = await P.bulkWrite(changes.map((c) => ({ updateOne: {
        filter: { _id: c.p._id, 'ocr.source': SOURCE, 'ocr.data': c.p.ocr.data },
        update: { $set: { 'ocr.data': c.target, 'ocr.source_url': `https://archive.org/download/${iaId}/${iaId}_djvu.xml#leaf=${c.k}`, 'ocr.agreement_ref.offset': 0, 'ocr.agreement_ref.repaired_from_offset': fromOffset, 'ocr.agreement_ref.repaired_at': now, 'ocr.updated_at': now, updated_at: now } },
      } })), { ordered: false });
      modified = res.modifiedCount;
    }
    let cleared = 0;
    if (CLEAR_EMPTY && empties.length) {
      await saveRevisionsBeforeOverwrite(db, empties.map((e) => e.page_id), 'ocr', { reason: `${REASON}_clear` });
      const res = await P.bulkWrite(empties.map((e) => ({ updateOne: { filter: { id: e.page_id, 'ocr.source': SOURCE }, update: { $set: { ocr: null, updated_at: now } } } })), { ordered: false });
      cleared = res.modifiedCount;
      const [counts] = await P.aggregate(buildVisiblePageCountPipeline(b.id)).toArray();
      if (counts) await B.updateOne({ _id: b._id }, { $set: { pages_count: counts.total, pages_ocr: counts.with_ocr, pages_translated: counts.with_translation, updated_at: now } });
    }
    totals.pages_changed += modified; totals.not_matched += changes.length - modified; totals.revisions += rev;
    const detail = { from_offset: fromOffset, pages_ia: pages.length, pages_changed: modified, unchanged, not_matched: changes.length - modified, empty_target: empties.length, cleared, revisions: rev };
    await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'repointed-offset-0', detail });
    await db.collection('book_events').insertOne({ book_id: b.id, type: 'ia_ocr_leaf_repair', at: now, source: 'repair-ia-ocr-leaf-offset', details: { ia_identifier: iaId, ...detail, issue: 4790 } });
    if (PROGRESS) fs.appendFileSync(PROGRESS, JSON.stringify({ book_id: b.id, at: now.toISOString(), ...detail }) + '\n');
  }
}, { timeoutMs: 4 * 60 * 60 * 1000 });
if (emptyList.length) { const f = (PROGRESS || FROM).replace(/\.jsonl$/, '') + '.empty-targets.jsonl'; fs.writeFileSync(f, emptyList.map((e) => JSON.stringify(e)).join('\n') + '\n'); console.log(`empty-target pages listed in ${f}`); }
console.log(JSON.stringify({ ...totals, applied: APPLY, class_C_held_books: byClass.C.length, class_C_held_pages: byClass.C.reduce((s, r) => s + r.written, 0), class_B_books: byClass.B.length }));
