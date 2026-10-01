#!/usr/bin/env node
// PRIOR ART: scripts/eval/nalanda-readiness/sample_tib.mjs and the 2026-10-01 re-draw (Hetzner
// /root/tibetan-eval/redraw-2026-10-01/sample_tib_redraw.mjs) — they DRAW pages to score against Derge; this
// draws FROM those two scored draws, so every proofread page already carries its Derge identity and the
// reader's correction measures the edition-variance gap on the same page. build-gold-annotator.mjs is the
// annotator pattern the correction page follows; it draws books, not pages, so it does not fit here.
//
// Draws the 30-folio proofread set for #4523 (handoff 2026-10-01-tibetan-ocr-C-proofread-set):
//   - only bl-kanjur pages scored in the 09-30 or 10-01 draw, Derge identity in [0.90, 0.97]
//     (ordinary pages, not the tails);
//   - the CURRENT served text must equal the text that was scored (else the Derge number is stale) —
//     mismatches are dropped and counted;
//   - one page per book; 10 frames whose leaf seam is MARKED (exactly one <leaf-break/>) + 20 UNMARKED.
//     By eye, BL Kangyur frames show two leaves x 7 lines whether or not the read carries the marker
//     (seq 1 of the 2026-10 draw, read from image), so the split is marked vs unmarked seam — the
//     handoff's "two-leaf frames" — not one leaf vs two;
//   - seed 20261003.
// Read-only on Mongo. Writes manifest.jsonl with the served text frozen in it.
//
//   node --env-file=<main>/.env.production.local scripts/eval/tibetan-proofread/draw.mjs \
//     --sample-0930 tib-sample-0930.jsonl --sample-1001 tib-sample-1001.jsonl \
//     --scores-1001 scores-1001.jsonl --meta-1001 tib-sample-meta-1001.jsonl
// (the 09-30 scores are in the repo; the other four files live on Hetzner under /root/tibetan-eval/
//  nalanda-2026-09-30/ and redraw-2026-10-01/.)
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const require = createRequire(path.join(process.env.SL_NODE_ROOT || REPO, 'package.json'));
const { MongoClient } = require('mongodb');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const SCORES_0930 = arg('--scores-0930', path.join(REPO, 'scripts/eval/results/nalanda-readiness-2026-09-30/tibetan-derge-scores.jsonl'));
const SAMPLE_0930 = arg('--sample-0930');
const SAMPLE_1001 = arg('--sample-1001');
const SCORES_1001 = arg('--scores-1001');
const META_1001 = arg('--meta-1001');
const OUT = arg('--out', path.join(REPO, 'scripts/eval/results/tibetan-proofread-2026-10/manifest.jsonl'));
const LO = 0.90, HI = 0.97, N_TWO_LEAF = 10, N_SINGLE = 20;

const makeShuffle = (s0) => {
  let seed = s0; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  return { rnd, shuffle };
};
const { shuffle } = makeShuffle(20261003);
const readJsonl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

for (const [k, v] of Object.entries({ SAMPLE_0930, SAMPLE_1001, SCORES_1001, META_1001 })) if (!v) throw new Error(`missing --${k.toLowerCase().replace('_', '-')}`);

// candidates: { id, book_id, page_number, derge_identity, draw, scored_text }
const text0930 = new Map(readJsonl(SAMPLE_0930).map((r) => [r.id, r.text]));
const text1001 = new Map(readJsonl(SAMPLE_1001).map((r) => [r.id, r.text]));
const meta1001 = new Map(readJsonl(META_1001).map((r) => [r.id, r]));
const cands = [];
for (const r of readJsonl(SCORES_0930)) {
  if (r.stratum !== 'bl-kanjur') continue;
  cands.push({ id: r.id, book_id: r.book_id, page_number: r.page, derge_identity: r.derge_identity, derge_vol: r.derge_vol, derge_imgnum: r.derge_imgnum, draw: '2026-09-30', scored_text: text0930.get(r.id) });
}
for (const r of readJsonl(SCORES_1001)) {
  const m = meta1001.get(r.id);
  if (!m || m.stratum !== 'bl-kanjur') continue;
  cands.push({ id: r.id, book_id: m.book_id, page_number: m.page_number, derge_identity: r.identity, derge_vol: r.vol, derge_imgnum: r.imgnum, draw: '2026-10-01', scored_text: text1001.get(r.id) });
}
const inBand = cands.filter((c) => c.derge_identity >= LO && c.derge_identity <= HI);
console.error(`kanjur candidates ${cands.length}; in [${LO}, ${HI}] ${inBand.length}`);

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const pages = await db.collection('pages').find(
  { $or: inBand.map((c) => ({ book_id: c.book_id, page_number: c.page_number })) },
  { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.content_hash': 1, 'ocr.updated_at': 1, display_photo: 1, photo: 1, photo_original: 1, 'archive_metadata.source_url': 1, 'image_metadata.width': 1, 'image_metadata.height': 1, image_width: 1, image_height: 1 } },
).toArray();
const byKey = new Map(pages.map((p) => [`${p.book_id}_${p.page_number}`, p]));
const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(inBand.map((c) => c.book_id))] } }, { projection: { id: 1, title: 1, display_title: 1 } }).toArray()).map((b) => [b.id, b]));

let changed = 0, missing = 0;
const live = [];
for (const c of inBand) {
  const p = byKey.get(c.id);
  if (!p?.ocr?.data) { missing++; continue; }
  if (p.ocr.data !== c.scored_text) { changed++; continue; }
  live.push({ ...c, page: p, leaf_breaks: (p.ocr.data.match(/<leaf-break\/>/g) || []).length });
}
console.error(`live with unchanged served text ${live.length} (text changed since scoring: ${changed}; page/ocr missing: ${missing})`);

// one page per book (a book in both draws contributes one, chosen by the seeded shuffle)
const perBook = new Map();
for (const c of shuffle(live)) if (!perBook.has(c.book_id)) perBook.set(c.book_id, c);
const pool = shuffle([...perBook.values()]);
const twoLeaf = pool.filter((c) => c.leaf_breaks === 1).slice(0, N_TWO_LEAF);
const single = pool.filter((c) => c.leaf_breaks === 0).slice(0, N_SINGLE);
console.error(`books ${perBook.size}; two-leaf available ${pool.filter((c) => c.leaf_breaks === 1).length}, single available ${pool.filter((c) => c.leaf_breaks === 0).length}`);
if (twoLeaf.length < N_TWO_LEAF || single.length < N_SINGLE) throw new Error(`short draw: ${twoLeaf.length} two-leaf, ${single.length} single`);

const picked = shuffle([...twoLeaf, ...single]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const toRow = (seq, stratum, p, b, extra) => {
  const leafBreaks = (p.ocr.data.match(/<leaf-break\/>/g) || []).length;
  return {
    seq,
    stratum,
    id: `${p.book_id}_${p.page_number}`,
    page_id: p.id,
    book_id: p.book_id,
    page_number: p.page_number,
    title: b.display_title || b.title || null,
    reader_url: `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`,
    leaf_seam: leafBreaks === 1 ? 'marked' : 'unmarked',
    leaf_breaks: leafBreaks,
    lines: p.ocr.data.split('\n').filter((l) => l.trim() && !/^<[^>]+>$/.test(l.trim())).length,
    ...extra,
    served_engine: p.ocr.model,
    served_content_hash: p.ocr.content_hash || null,
    served_updated_at: p.ocr.updated_at || null,
    served_text_sha256: sha(p.ocr.data),
    display_photo: p.display_photo || null,
    photo_original: p.photo_original || null,
    // `photo` is our R2 archived copy of the BL master at full resolution (3504–4752 px). The BL IIIF server
    // caps a whole-image request at 1200 px whatever size is asked, so `full_res_url` is the citation link,
    // not a usable download; build-page.mjs reads `archived_photo`.
    archived_photo: p.photo?.includes('/archived/') ? p.photo : null,
    full_res_url: p.archive_metadata?.source_url || null,
    image_width: p.image_metadata?.width || p.image_width || null,
    image_height: p.image_metadata?.height || p.image_height || null,
    served_text: p.ocr.data,
  };
};
const out = picked.map((c, i) => toRow(i + 1, 'kangyur', c.page, books.get(c.book_id) || {},
  { derge_identity: c.derge_identity, derge_vol: c.derge_vol, derge_imgnum: c.derge_imgnum, derge_draw: c.draw }));
console.error(`kangyur: ${out.length} pages from ${new Set(out.map((r) => r.book_id)).size} books; seam marked ${out.filter((r) => r.leaf_seam === 'marked').length}; derge identity median ${out.map((r) => r.derge_identity).sort()[15]}`);

// ---- stratum "mark" (added 2026-10-01, sourcelibrary-e1 / Derek): N_MARK pages whose served verdict is
// MARK_UNRELIABLE (pages.ocr.verdict, stamped by the #4523 verdict runs), one per BL Tibetan book, seed 20261004,
// served text >= 600 chars, books already in the kangyur stratum excluded. Track B (PR #5459) found these pages
// off-index for every reference we hold, so a human read is the only instrument. MEASURED 2026-10-01: 99% of the
// 78,403 such pages serve GEMINI text (the verdict judged the Yigdzin read; Gemini stayed served), so this stratum
// measures what readers see, not Yigdzin.
const N_MARK = 10, MIN_CHARS = 600;
const mark = makeShuffle(20261004);
const srcOf = (b) => b.image_source?.provider || b.image_source?.type || (typeof b.image_source === 'string' ? b.image_source : null);
const tibBooks = await db.collection('books').find({ language: 'Tibetan', visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1, title: 1, display_title: 1, image_source: 1 } }).toArray();
const taken = new Set(out.map((r) => r.book_id));
const blBooks = mark.shuffle(tibBooks.filter((b) => /^bl$/i.test(srcOf(b) || '') && !taken.has(b.id)).sort((x, y) => (x.id < y.id ? -1 : 1)));
const PROJ = { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.content_hash': 1, 'ocr.updated_at': 1, 'ocr.verdict': 1, display_photo: 1, photo: 1, photo_original: 1, 'archive_metadata.source_url': 1, 'image_metadata.width': 1, 'image_metadata.height': 1, image_width: 1, image_height: 1 };
let tried = 0;
for (const b of blBooks) {
  if (out.length >= picked.length + N_MARK) break;
  tried++;
  const cand = (await db.collection('pages').find({ book_id: b.id, 'ocr.verdict.verdict': 'MARK_UNRELIABLE' }, { projection: PROJ }).sort({ page_number: 1 }).toArray())
    .filter((p) => (p.ocr.data || '').length >= MIN_CHARS);
  if (!cand.length) continue;
  const p = cand[Math.floor(mark.rnd() * cand.length)];
  const v = p.ocr.verdict;
  out.push(toRow(out.length + 1, 'mark', p, b, { derge_identity: null, verdict: v.verdict, verdict_rule: v.rule, verdict_agree_wood: v.agree_wood ?? null, verdict_agree_uchan: v.agree_uchan ?? null, verdict_align_src: v.align_src ?? null, verdict_judged_engine: v.judged_engine, verdict_run: v.run }));
}
console.error(`mark: ${out.length - picked.length} pages (books tried ${tried}); served engines ${JSON.stringify(out.filter((r) => r.stratum === 'mark').reduce((m, r) => ({ ...m, [r.served_engine]: (m[r.served_engine] || 0) + 1 }), {}))}`);
if (out.length < picked.length + N_MARK) throw new Error('short mark draw');
await client.close();

fs.writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.error(`wrote ${out.length} pages from ${new Set(out.map((r) => r.book_id)).size} books -> ${path.relative(REPO, OUT)}`);
