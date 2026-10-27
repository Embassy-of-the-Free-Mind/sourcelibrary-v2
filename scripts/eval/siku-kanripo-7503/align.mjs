#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-skqs-5568-kanripo.mjs (workInfo, pbPages, best, fold — imported; its `drift` mode
// aligns whole pilot volumes from local OCR files, this one reads the stored Paddle text from Mongo and adds CER
// and the image-sequence flags); scripts/eval/paddle-table-6388/align.mjs (trusts the stored ocr.qa_screen leaf;
// here the alignment is recomputed for every page so the screen itself is checked); ground-truth-5935/lib.mjs
// (bodyText, bodyCer — imported).
//
// #7503: every page of the 20-book Siku pilot (results/draw.json on the job-siku-pilot-7503 branch) against its
// Kanripo WYG leaf. Per page: matched <pb>, Dice, runner-up, body CER (glyph variants folded). Per book: sequence
// flags (out-of-order leaf, two pages on one leaf, unaligned runs, skipped/extra leaves) and the R2 key scope.
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/siku-kanripo-7503/align.mjs \
//     --draw=DRAW.json --pages=PAGE-IDS.json --out=DIR --dir=KANRIPO_CACHE
// READ-ONLY on Mongo. GitHub reads are cached under --dir.
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { workInfo, pbPages, best, fold, juanRange } from '../zh-skqs-5568-kanripo.mjs';
import { bodyText, bodyCer } from '../ground-truth-5935/lib.mjs';
import { isBookScopedUrl } from '../../lib/r2-key.mjs';

const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const DRAW = JSON.parse(fs.readFileSync(arg('draw'), 'utf8'));
const PILOT = new Set(JSON.parse(fs.readFileSync(arg('pages'), 'utf8')));
const OUT = arg('out');
fs.mkdirSync(OUT, { recursive: true });
const THRESH = 0.6;      // the #5568 leaf rule
const MIN_CHARS = 20;    // below this a page is a cover, plate or blank (no alignment attempted)
const EDGE = 40;         // reference slack either side of the leaf: Kanripo breaks a column or so off the scan

const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] });
const db = c.db('bookstore');
const rows = [], books = [];
for (const d of DRAW.books) {
  const b = await db.collection('books').findOne({ $or: [{ id: d.book_id }, { _id: d.book_id }] }, { projection: { id: 1, title: 1, work_id: 1, pages_count: 1 } });
  const krId = String(b.work_id || '').replace(/^kr:/, '');
  const w = krId ? await workInfo(krId) : { repo: false };
  const ps = await db.collection('pages').find({ book_id: d.book_id }, { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.qa_screen': 1, archived_photo: 1, display_photo: 1, thumbnail_blob: 1, photo: 1 } }).sort({ page_number: 1 }).toArray();
  const jr = juanRange(b.title);
  const bookRow = { book_id: d.book_id, title: b.title, work: krId || null, witness: w.witness || null, witness_sha: w.witness_sha || null, repo_licence: w.repo_licence ?? null, licence_file: w.licence_file ?? null, readme_licence_line: w.readme_licence_line ?? null, readme_witness: w.readme_witness ?? null, juan_title: jr, pages: ps.length };
  if (!w.witness) { books.push({ ...bookRow, status: 'no-kanripo' }); for (const p of ps) rows.push({ book_id: d.book_id, pn: p.page_number, page_id: p.id, pilot: PILOT.has(p.id), status: 'no-kanripo' }); continue; }
  // Whole work: the title's juan number does not reliably name the Kanripo file (#5568 drift).
  const pbs = await pbPages(krId, w.witness, w.juan_files);
  let last = null;
  const seq = [];
  for (const p of ps) {
    const body = bodyText(p.ocr?.data || '');
    const Q = fold(body);
    const r = { book_id: d.book_id, pn: p.page_number, page_id: p.id, pilot: PILOT.has(p.id), ocr_source: p.ocr?.source || null, chars: [...Q].length,
      key_scoped: [p.archived_photo, p.display_photo, p.thumbnail_blob].filter(Boolean).every((u) => !/images\.sourcelibrary\.org/.test(u) || isBookScopedUrl(u, d.book_id)),
      archived_photo: p.archived_photo || null, screen_pb: p.ocr?.qa_screen?.pb || null, screen_dice: p.ocr?.qa_screen?.dice ?? null };
    if (r.chars < MIN_CHARS) { r.status = 'short'; seq.push(r); continue; }
    let m = last != null ? best(Q, pbs, Math.max(0, last - 6), Math.min(pbs.length, last + 12)) : null;
    if (!m || m.dice < THRESH) { const full = best(Q, pbs); if (!m || full.dice > m.dice) m = full; }
    const pb = pbs[m.i];
    Object.assign(r, { pb: pb.pb, idx: m.i, juan: pb.juan, dice: +m.dice.toFixed(3), runner_up: +m.second.toFixed(3), status: m.dice >= THRESH ? 'aligned' : 'unaligned' });
    if (r.status === 'unaligned') r.body_head = body.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (r.status === 'aligned') {
      last = m.i;
      const W = (pbs[m.i - 1]?.text || '').slice(-EDGE) + pb.text + (pbs[m.i + 1]?.text || '').slice(0, EDGE);
      const s = bodyCer(Q, W, { expected: [...pb.text].length, ops: true });
      Object.assign(r, { k_chars: [...pb.text].length, cer: +s.cer.toFixed(4), edits: s.d, omitted: s.omitted,
        subs: s.runs.filter((x) => x.ours && x.ref).reduce((a, x) => a + Math.max([...x.ours].length, [...x.ref].length), 0),
        runs: s.runs.slice(0, 40).map((x) => [x.ours, x.ref]) });
    }
    seq.push(r);
  }
  // ── sequence flags ──
  const al = seq.filter((r) => r.status === 'aligned');
  // longest non-decreasing run of idx (patience LIS on idx, ties allowed as their own duplicate flag)
  const tails = [], prevOf = new Array(al.length), tailIdx = [];
  al.forEach((r, k) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < r.idx) lo = mid + 1; else hi = mid; }
    tails[lo] = r.idx; tailIdx[lo] = k; prevOf[k] = lo ? tailIdx[lo - 1] : -1;
  });
  const inLis = new Set(); for (let k = tailIdx[tails.length - 1]; k >= 0 && k !== undefined; k = prevOf[k]) inLis.add(k);
  const flags = [];
  al.forEach((r, k) => { if (!inLis.has(k)) { r.flag_out_of_sequence = true; flags.push({ kind: 'out-of-sequence', pn: r.pn, pb: r.pb, dice: r.dice }); } });
  const byIdx = new Map(); for (const r of al) byIdx.set(r.idx, [...(byIdx.get(r.idx) || []), r]);
  for (const [, rs] of byIdx) if (rs.length > 1) { for (const r of rs) r.flag_duplicate_leaf = true; flags.push({ kind: 'same-leaf', pns: rs.map((r) => r.pn), pb: rs[0].pb, dice: rs.map((r) => r.dice) }); }
  // gaps between consecutive in-sequence pages: leaves skipped (missing image) or pages with no leaf (extra image)
  const lis = al.filter((_, k) => inLis.has(k));
  for (let k = 1; k < lis.length; k++) {
    const a = lis[k - 1], z = lis[k], dIdx = z.idx - a.idx, dPn = z.pn - a.pn;
    if (dIdx > dPn) flags.push({ kind: 'leaves-skipped', after_pn: a.pn, before_pn: z.pn, leaves_skipped: dIdx - dPn, from_pb: a.pb, to_pb: z.pb });
    else if (dIdx < dPn && dIdx >= 1) {
      const between = seq.filter((r) => r.pn > a.pn && r.pn < z.pn);
      if (between.some((r) => r.status === 'unaligned' || (r.status === 'aligned' && !r.flag_out_of_sequence))) flags.push({ kind: 'extra-pages', after_pn: a.pn, before_pn: z.pn, extra: dPn - dIdx, between: between.map((r) => `${r.pn}:${r.status}`) });
    }
  }
  // runs of unaligned text pages (≥ 2 in a row; a single one is reported per page)
  let run = [];
  const flush = () => { if (run.length) flags.push({ kind: run.length >= 2 ? 'unaligned-run' : 'unaligned-page', pns: run.map((r) => r.pn), dice: run.map((r) => r.dice), chars: run.map((r) => r.chars) }); run = []; };
  for (const r of seq) { if (r.status === 'unaligned') run.push(r); else if (r.status === 'aligned') flush(); }
  flush();
  for (const r of seq.filter((x) => !x.key_scoped)) flags.push({ kind: 'key-not-book-scoped', pn: r.pn, url: r.archived_photo });
  // first aligned leaf vs the title's juan
  const juans = [...new Set(al.map((r) => r.juan))].sort((x, y) => x - y);
  books.push({ ...bookRow, status: 'done', pb_pages_in_work: pbs.length, aligned: al.length, unaligned: seq.filter((r) => r.status === 'unaligned').length, short: seq.filter((r) => r.status === 'short').length,
    juans_aligned: juans, first_pb: al[0]?.pb, last_pb: al.at(-1)?.pb,
    screen_agrees: seq.filter((r) => r.screen_pb && r.pb && r.status === 'aligned').filter((r) => r.screen_pb === r.pb).length,
    screen_compared: seq.filter((r) => r.screen_pb && r.pb && r.status === 'aligned').length, flags });
  rows.push(...seq);
  console.log(`${d.book_id} ${krId}/${w.witness} pbs ${pbs.length} | pages ${ps.length} aligned ${al.length} unaligned ${seq.filter((r) => r.status === 'unaligned').length} short ${seq.filter((r) => r.status === 'short').length} | flags ${flags.map((f) => f.kind).join(',') || '-'} | ${b.title}`);
}
await c.close();
fs.writeFileSync(path.join(OUT, 'pages.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'books.json'), JSON.stringify(books, null, 1));
