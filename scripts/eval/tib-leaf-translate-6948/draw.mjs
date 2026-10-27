#!/usr/bin/env node
// PRIOR ART: scripts/eval/opus-tib-sa-6948/ (frame.mjs, sample.mjs pickBlock/CANON, audit.mjs: the 10-24 frame, block
// draw and blind image-grounded audit, all reused unchanged here); scripts/eval/tib-concept-opus-6948/prep.mjs on job
// tib-concept-opus-6948's branch (the full-resolution strips claude-translate.mjs --images-dir attaches; not yet on
// main, so its 20-line cutter is repeated below, same geometry). Neither draws from the Kangyur CANON stratum with the
// 10-24 bad pages paired in, nor meters a 300-page batch.
/**
 * draw.mjs — job tib-leaf-translate-6948 (#6948): does Opus translating from the LEAF (image + Yigdzin transcription)
 * rescue the Kangyur two-leaf frames the 10-24 text-only gate failed on (CANON 19/40 bad)? Files under $JOB_SCRATCH
 * only; no database write.
 *
 *   stage1  --frame=frame-bo.jsonl --canon40=canon40-state.json   → $S/s1/draw.json, ids.json
 *           20 blocks of up to 10 consecutive frame pages, one book each, seed 6948. 5 blocks hold a 10-24 bad CANON
 *           page (drawn by seed from those whose OCR is unchanged since 10-24) at a random position; that page is the
 *           audited one, so before/after is paired. 15 blocks come from other CANON books, a random block and a
 *           random audited page in it (FRESH: the unbiased estimate).
 *   stage2  --frame=... --exclude=s1/draw.json                    → $S/s2/draw.json, ids.json
 *           30 blocks of 10 from 30 further CANON books, seed 69482; 20 of them (seeded) get one audited page.
 *   strips  --ids=F --out=DIR   each page's image cut into overlapping full-resolution strips DIR/<id>/t<k>.jpg.
 *   items   --draw=D --reads=DIR --controls=N --seed=K            → audit-items.json, control-items.json (audit.mjs)
 *
 * Book exclusions (both stages): any book with a Flash-corrected page (ocr.pipeline tib-correct-6560: the correction
 * job's volumes, so the text is not the uncorrected Yigdzin one), and job tib-concept-opus-6948's six books.
 */
import fs from 'node:fs';
import path from 'node:path';
import { rng, shuffle, readJsonl, byBook, CANON } from '../opus-tib-sa-6948/sample.mjs';

const S = process.env.JOB_SCRATCH;
const CMD = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const CONCEPT_BOOKS = new Set(['6a37c28763d3f620b49ff2dc', '6a37d704d07939943b23ea3f', '6a37d770d07939943b246079', '6a37d788d07939943b247f88', '6a37ca2c06d55b107dad49a4', '6a37ca5206d55b107dad83c3']);

/** Runs of consecutive page numbers within one book's frame pages. */
const runsOf = (ps) => { const out = []; for (const p of ps) { const l = out.at(-1)?.at(-1); if (l && l.page_number + 1 === p.page_number) out.at(-1).push(p); else out.push([p]); } return out; };
/** A block of up to n consecutive frame pages containing page index k, k at a random position where the run allows. */
function blockAround(ps, k, r, n = 10) {
  const run = runsOf(ps).find((x) => x.includes(ps[k]));
  const i = run.indexOf(ps[k]);
  const lo = Math.max(0, i - n + 1), hi = Math.min(i, run.length - n);
  const start = hi >= lo ? lo + Math.floor(r() * (hi - lo + 1)) : 0;
  return run.slice(start, start + n);
}

async function canonFrame() {
  const { MongoClient } = await import('mongodb');
  const rows = readJsonl(arg('frame')).filter((x) => CANON.test((x.title || '').trim()) && !CONCEPT_BOOKS.has(x.book_id));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const corrected = new Set(await c.db('bookstore').collection('pages').distinct('book_id', { 'ocr.pipeline': 'tib-correct-6560' }));
  await c.close();
  const kept = rows.filter((x) => !corrected.has(x.book_id));
  console.error(`CANON frame: ${rows.length} pages; ${rows.length - kept.length} dropped in ${corrected.size} books with Flash-corrected pages; ${kept.length} pages in ${new Set(kept.map((x) => x.book_id)).size} books`);
  return byBook(kept);
}
const save = (dir, blocks, meta) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'draw.json'), JSON.stringify({ ...meta, at: new Date().toISOString(), blocks }, null, 1));
  fs.writeFileSync(path.join(dir, 'ids.json'), JSON.stringify(blocks.flatMap((b) => b.pages.map((p) => p.id))));
  console.log(blocks.map((b) => `${b.kind} ${b.title.slice(0, 34)} p.${b.pages[0].n}-${b.pages.at(-1).n}${b.audit_page_id ? ` audit p.${b.pages.find((p) => p.id === b.audit_page_id).n}` : ''}`).join('\n'));
  console.log(`${blocks.length} blocks, ${blocks.reduce((s, b) => s + b.pages.length, 0)} pages`);
};
const asBlock = (kind, ps, audit, extra = {}) => ({ kind, book_id: ps[0].book_id, title: ps[0].title, hold: ps[0].hold, pages: ps.map((p) => ({ id: p.page_id, n: p.page_number })), audit_page_id: audit?.page_id || null, ...extra });

if (CMD === 'stage1') {
  const r = rng(6948);
  const frame = await canonFrame();
  const c40 = JSON.parse(fs.readFileSync(arg('canon40'), 'utf8'));
  const bad = shuffle(c40.filter((x) => x.verdict === 'bad' && x.same_ocr && frame.has(x.book)).sort((a, b) => a.uid.localeCompare(b.uid)), r);
  const blocks = [];
  for (const x of bad) {
    if (blocks.length === 5) break;
    const ps = frame.get(x.book); const k = ps.findIndex((p) => p.page_number === x.n);
    if (k < 0) continue;
    const b = blockAround(ps, k, r);
    if (b.length < 5) continue;
    blocks.push(asBlock('PAIRED-BAD', b, ps[k], { uid_1024: x.uid }));
  }
  const used = new Set(blocks.map((b) => b.book_id));
  for (const id of shuffle([...frame.keys()].sort(), r)) {
    if (blocks.length === 20) break;
    if (used.has(id)) continue;
    const ps = frame.get(id);
    const paired = ps.map((_, i) => i).filter((i) => ps[i - 1]?.page_number === ps[i].page_number - 1 || ps[i + 1]?.page_number === ps[i].page_number + 1);
    if (!paired.length) continue;
    const k = paired[Math.floor(r() * paired.length)];
    const b = blockAround(ps, k, r);
    blocks.push(asBlock('FRESH', b, b[Math.floor(r() * b.length)]));
    used.add(id);
  }
  save(path.join(S, 's1'), blocks, { seed: 6948, frame_books: frame.size });
}

if (CMD === 'stage2') {
  const r = rng(69482);
  const frame = await canonFrame();
  const excl = new Set(JSON.parse(fs.readFileSync(arg('exclude'), 'utf8')).blocks.map((b) => b.book_id));
  const blocks = [];
  for (const id of shuffle([...frame.keys()].sort(), r)) {
    if (blocks.length === 30) break;
    if (excl.has(id)) continue;
    const ps = frame.get(id);
    const full = runsOf(ps).filter((x) => x.length >= 10);
    if (!full.length) continue;
    const starts = full.flatMap((run) => run.slice(0, run.length - 9).map((_, i) => run.slice(i, i + 10)));
    blocks.push(asBlock('BATCH', starts[Math.floor(r() * starts.length)], null));
  }
  shuffle(blocks.map((_, i) => i), r).slice(0, 20).forEach((i) => { const b = blocks[i]; b.audit_page_id = b.pages[Math.floor(r() * b.pages.length)].id; });
  save(path.join(S, 's2'), blocks, { seed: 69482, frame_books: frame.size, excluded_stage1_books: excl.size });
}

if (CMD === 'strips') {
  const sharp = (await import('sharp')).default;
  const { MongoClient } = await import('mongodb');
  const { fetchImage } = await import('../opus-tib-sa-6948/audit.mjs');
  const ids = JSON.parse(fs.readFileSync(arg('ids'), 'utf8')), OUT = arg('out');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = await c.db('bookstore').collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, photo: 1, photo_original: 1, archived_photo: 1 } }).toArray();
  await c.close();
  let made = 0, failed = 0;
  const one = async (p) => {
    const out = path.join(OUT, p.id);
    if (fs.existsSync(path.join(out, 't1.jpg'))) return;
    const raw = path.join(S, 'images', p.id, 'raw.img');   // the cache audit.mjs packet reads
    fs.mkdirSync(path.dirname(raw), { recursive: true });
    if (!(await fetchImage(p, raw))) { failed++; console.log(`  ${p.id}: no image`); return; }
    const { width: W, height: H } = await sharp(raw, { limitInputPixels: false }).rotate().metadata();
    // Strips of aspect <= 1.8, 6% overlap, each <= 1568 px: a two-leaf frame (4752 x 3168) becomes one or two strips.
    const cols = Math.max(1, Math.ceil(W / H / 1.8)), tw = Math.ceil(W / cols), ox = cols > 1 ? Math.round(tw * 0.06) : 0;
    fs.mkdirSync(out, { recursive: true });
    for (let k = 0; k < cols; k++) {
      const left = Math.max(0, k * tw - ox), width = Math.min(W - left, tw + 2 * ox);
      await sharp(raw, { limitInputPixels: false }).rotate().extract({ left, top: 0, width, height: H }).resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(path.join(out, `t${k + 1}.jpg`));
    }
    made++;
  };
  for (let i = 0; i < pages.length; i += 6) await Promise.all(pages.slice(i, i + 6).map((p) => one(p).catch((e) => { failed++; console.log(`  ${p.id}: ${e.message}`); })));
  console.log(`strips made for ${made} pages, ${failed} failed, ${pages.length - made - failed} cached`);
}

// One audit item per block (its audited page) and N controls planted on copies of other read pages, one per block,
// two-thirds reversals; uids opaque and shuffled.
if (CMD === 'items') {
  const r = rng(Number(arg('seed')));
  const { blocks } = JSON.parse(fs.readFileSync(arg('draw'), 'utf8'));
  const R = arg('reads'), dir = path.dirname(arg('draw'));
  const ok = (id) => { try { return JSON.parse(fs.readFileSync(path.join(R, `${id}.meta.json`), 'utf8')).exit === 0; } catch { return false; } };
  const len = (id) => fs.readFileSync(path.join(R, `${id}.txt`), 'utf8').length;
  const items = [], missing = [];
  shuffle(blocks.filter((b) => b.audit_page_id), r).forEach((b) => { if (ok(b.audit_page_id)) items.push({ uid: `a${String(items.length + 1).padStart(3, '0')}`, page_id: b.audit_page_id, lang: 'bo', read_dir: R, arm: 'leaf-pc10', stratum: b.kind, book_id: b.book_id }); else missing.push(b.audit_page_id); });
  const n = Number(arg('controls') || 6), controls = [];
  for (const b of shuffle([...blocks], r)) {
    if (controls.length === n) break;
    const spare = shuffle(b.pages.filter((p) => p.id !== b.audit_page_id && ok(p.id) && len(p.id) > 400), r)[0];
    if (spare) controls.push({ uid: `c${controls.length + 1}`, page_id: spare.id, lang: 'bo', read_dir: R, kind: controls.length < Math.round(n * 2 / 3) ? 'reversal' : 'invention' });
  }
  fs.writeFileSync(path.join(dir, 'audit-items.json'), JSON.stringify(items, null, 1));
  fs.writeFileSync(path.join(dir, 'control-items.json'), JSON.stringify(controls, null, 1));
  console.log(`${items.length} audit items, ${missing.length} audited pages not read (${missing.join(',')}); controls ${controls.map((c) => `${c.uid}:${c.kind}`).join(' ')}`);
}
