#!/usr/bin/env node
// PRIOR ART: scripts/eval/opus-tib-sa-6948/ (frame.mjs, sample.mjs, audit.mjs: the 10-24 frame, block draw and blind
// image-grounded audit, reused here; audit.mjs's fetchImage is imported). Neither cuts images for a TRANSLATOR: the
// 10-24 reads were text-only, and most of its bad pages were OCR errors a text-only reader cannot see. This adds the
// six-book frame, the pilot / fresh-check draws and the strips claude-translate.mjs --images-dir attaches.
/**
 * prep.mjs — job tib-concept-opus-6948 (#6948): six held Tibetan books for the conceptual histories, translated by
 * Opus (claude -p) with each leaf's image attached. Writes files under $JOB_SCRATCH only; no database write.
 *
 *   frame        $JOB_SCRATCH/frame.jsonl: per book, the pages whose OCR is the Yigdzin read (bdrc-yigdzin-v1, pipelines
 *                reocr_bdrc_4523 / tib_gutter_vllm_6871), non-empty, translatable, with no English. Asserts every page
 *                of the six books has no English (the brief: never overwrite; there are none).
 *   pilot        $JOB_SCRATCH/pilot/ids.json: 30 Bardo Thödol pages, three blocks of 10 consecutive frame pages, one
 *                block in each third of the frame, seed 6948; a block is placed over reocr_bdrc_4523 pages if none fell there.
 *   fresh        --exclude=F1,F2 $JOB_SCRATCH/fresh/items.json: 20 pages across the six books for the step-4 check,
 *                books weighted by frame size, at least one per book, never a pilot page, seed 69484.
 *   images       --ids=F: each page's image (audit.mjs fetchImage, cached in $JOB_SCRATCH/images/<id>/raw.img, the same
 *                cache the audit packet reads) cut into overlapping full-resolution strips: $JOB_SCRATCH/strips/<id>/t<k>.jpg.
 *                A pecha leaf is 4-5 times wider than tall (8704 x 1824 px here), so one reduced image would make its
 *                lines ~60 px tall; strips of aspect <= 1.8 keep them at 100+ px.
 *   ids          --book=ID [--exclude=F]: the book's frame page ids (page order) not in F, for claude-translate.mjs.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tib-concept-opus-6948/prep.mjs frame
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchImage } from '../opus-tib-sa-6948/audit.mjs';
import { rng, shuffle, readJsonl } from '../opus-tib-sa-6948/sample.mjs';

const S = process.env.JOB_SCRATCH;
const CMD = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
export const BOOKS = [
  ['6a37c28763d3f620b49ff2dc', 'Bardo Thödol (bar do thos grol chen mo)'],
  ['6a37d704d07939943b23ea3f', "'das log dkar chag"],
  ['6a37d770d07939943b246079', "Dolpopa / Tāranātha: rgyud bla ma commentary, dus 'khor chos 'byung"],
  ['6a37d788d07939943b247f88', 'Tibetan minor sciences, miscellaneous works'],
  ['6a37ca2c06d55b107dad49a4', "Kongtrul, lus mchod sbyin gyi zin bris (chöd notes)"],
  ['6a37ca5206d55b107dad83c3', "nag po chen po khro bo bcu'i gtor bzlog gi cho ga (Mahākāla)"],
];
const YIGDZIN = new Set(['reocr_bdrc_4523', 'tib_gutter_vllm_6871']);
const hasEnglish = (p) => !!String(p.translation?.data || '').trim();

if (CMD === 'frame') {
  const { MongoClient } = await import('mongodb');
  const { isTranslatablePage } = await import('../../lib/translate-core.mjs');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const rows = [], summary = [];
  for (const [id, title] of BOOKS) {
    const ps = await db.collection('pages').find({ book_id: id }, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, 'translation.data': 1, withheld: 1 } }).toArray();
    const english = ps.filter(hasEnglish).length;
    if (english) { console.error(`${id}: ${english} pages already have English; this job never overwrites. Stopping.`); process.exit(3); }
    const tally = { book_id: id, title, pages: ps.length, yigdzin: 0, other_ocr: 0, no_ocr: 0, not_translatable: 0, withheld: 0, frame: 0, by_pipeline: {} };
    for (const p of ps.sort((a, b) => a.page_number - b.page_number)) {
      if (!String(p.ocr?.data || '').trim()) { tally.no_ocr++; continue; }
      if (!(p.ocr?.model === 'bdrc-yigdzin-v1' && YIGDZIN.has(p.ocr?.pipeline))) { tally.other_ocr++; continue; }
      tally.yigdzin++;
      if (p.withheld) { tally.withheld++; continue; }
      if (!isTranslatablePage(p).ok) { tally.not_translatable++; continue; }
      tally.frame++; tally.by_pipeline[p.ocr.pipeline] = (tally.by_pipeline[p.ocr.pipeline] || 0) + 1;
      rows.push({ book_id: id, page_id: p.id, page_number: p.page_number, pipeline: p.ocr.pipeline, ocr_chars: p.ocr.data.length });
    }
    summary.push(tally);
  }
  await c.close();
  fs.writeFileSync(`${S}/frame.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify({ at: new Date().toISOString(), frame_pages: rows.length, books: summary }, null, 1));
}

/** Runs of consecutive page numbers. */
const runsOf = (rows) => { const out = []; for (const r of rows) { const l = out.at(-1)?.at(-1); if (l && l.page_number + 1 === r.page_number) out.at(-1).push(r); else out.push([r]); } return out; };

if (CMD === 'pilot') {
  const r = rng(6948);
  const bardo = readJsonl(`${S}/frame.jsonl`).filter((x) => x.book_id === BOOKS[0][0]);
  // Every start of a 10-page consecutive window, grouped by the third of the frame it starts in.
  const starts = runsOf(bardo).flatMap((run) => run.slice(0, Math.max(0, run.length - 9)).map((x, i) => run.slice(i, i + 10)));
  const third = (w) => Math.min(2, Math.floor(3 * bardo.indexOf(w[0]) / bardo.length));
  const blocks = [0, 1, 2].map((t) => { const c = starts.filter((w) => third(w) === t); return c[Math.floor(r() * c.length)]; });
  if (!blocks.some((b) => b.some((x) => x.pipeline === 'reocr_bdrc_4523'))) {
    const reocr = starts.filter((w) => w.some((x) => x.pipeline === 'reocr_bdrc_4523') && !blocks.some((b) => b.some((x) => w.includes(x))));
    if (reocr.length) blocks[Math.floor(r() * 3)] = reocr[Math.floor(r() * reocr.length)];
  }
  blocks.sort((a, b) => a[0].page_number - b[0].page_number);
  fs.mkdirSync(`${S}/pilot`, { recursive: true });
  fs.writeFileSync(`${S}/pilot/ids.json`, JSON.stringify(blocks.flat().map((x) => x.page_id)));
  fs.writeFileSync(`${S}/pilot/draw.json`, JSON.stringify({ seed: 6948, frame_pages: bardo.length, blocks: blocks.map((b) => ({ pages: b.map((x) => x.page_number), pipelines: [...new Set(b.map((x) => x.pipeline))] })) }, null, 1));
  console.log(fs.readFileSync(`${S}/pilot/draw.json`, 'utf8'));
}

if (CMD === 'fresh') {
  const r = rng(69484);
  const excl = new Set((arg('exclude') || '').split(',').filter(Boolean).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
  const frame = readJsonl(`${S}/frame.jsonl`).filter((x) => !excl.has(x.page_id));
  const by = new Map(BOOKS.map(([id]) => [id, shuffle(frame.filter((x) => x.book_id === id), r)]));
  const picked = [...by.values()].filter((xs) => xs.length).map((xs) => xs.shift());
  const pool = shuffle([...by.values()].flat(), r);
  while (picked.length < 20 && pool.length) picked.push(pool.shift());
  fs.mkdirSync(`${S}/fresh`, { recursive: true });
  fs.writeFileSync(`${S}/fresh/items.json`, JSON.stringify(picked, null, 1));
  console.log(picked.map((x) => `${x.book_id.slice(-4)}:${x.page_number}`).join(' '));
}

if (CMD === 'images') {
  const sharp = (await import('sharp')).default;
  const { MongoClient } = await import('mongodb');
  const ids = JSON.parse(fs.readFileSync(arg('ids'), 'utf8'));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = await c.db('bookstore').collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, photo: 1, photo_original: 1, archived_photo: 1 } }).toArray();
  await c.close();
  let made = 0, failed = 0;
  const one = async (p) => {
    const out = path.join(S, 'strips', p.id);
    if (fs.existsSync(path.join(out, 't1.jpg'))) return;
    const raw = path.join(S, 'images', p.id, 'raw.img');
    fs.mkdirSync(path.dirname(raw), { recursive: true });
    if (!(await fetchImage(p, raw))) { failed++; console.log(`  ${p.id}: no image`); return; }
    const { width: W, height: H } = await sharp(raw, { limitInputPixels: false }).rotate().metadata();
    const cols = Math.max(1, Math.ceil(W / H / 1.8));
    const tw = Math.ceil(W / cols), ox = cols > 1 ? Math.round(tw * 0.06) : 0;
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

// --ids=F (page ids audited, in order) --reads=DIR[,DIR...] --tag=pilot|fresh --controls=N  →  $S/<tag>/audit-items.json
// and $S/<tag>/control-items.json for audit.mjs (packet / plant). Every read page is audited; the controls are planted
// on copies of N of them (two-thirds reversals), one per block of ten where possible, seeded. uids are opaque.
if (CMD === 'audit-items') {
  const tag = arg('tag'), r = rng(tag === 'pilot' ? 69481 : 69485);
  const dirs = arg('reads').split(',');
  const ids = JSON.parse(fs.readFileSync(arg('ids'), 'utf8')).map((x) => x.page_id || x);
  const dirOf = (id) => dirs.find((d) => { try { return JSON.parse(fs.readFileSync(path.join(d, `${id}.meta.json`), 'utf8')).exit === 0; } catch { return false; } });
  const items = [], missing = [];
  shuffle([...ids], r).forEach((id) => { const d = dirOf(id); if (d) items.push({ uid: `a${String(items.length + 1).padStart(3, '0')}`, page_id: id, lang: 'bo', read_dir: d }); else missing.push(id); });
  const n = Number(arg('controls') || 6);
  const long = shuffle(items.filter((x) => fs.readFileSync(path.join(x.read_dir, `${x.page_id}.txt`), 'utf8').length > 400), r);
  const blockOf = (id) => Math.floor(ids.indexOf(id) / 10);
  const picked = [], seen = new Set();
  for (const x of long) if (picked.length < n && !seen.has(blockOf(x.page_id))) { seen.add(blockOf(x.page_id)); picked.push(x); if (seen.size === Math.ceil(ids.length / 10)) seen.clear(); }
  const controls = picked.map((x, i) => ({ uid: `c${i + 1}`, page_id: x.page_id, lang: 'bo', read_dir: x.read_dir, kind: i < Math.round(n * 2 / 3) ? 'reversal' : 'invention' }));
  fs.writeFileSync(`${S}/${tag}/audit-items.json`, JSON.stringify(items, null, 1));
  fs.writeFileSync(`${S}/${tag}/control-items.json`, JSON.stringify(controls, null, 1));
  console.log(`${items.length} audit items, ${missing.length} not read (${missing.join(',')}); controls ${controls.map((c) => `${c.uid}:${c.kind}`).join(' ')}`);
}

if (CMD === 'ids') {
  const excl = new Set(arg('exclude') ? JSON.parse(fs.readFileSync(arg('exclude'), 'utf8')) : []);
  const ids = readJsonl(`${S}/frame.jsonl`).filter((x) => x.book_id === arg('book') && !excl.has(x.page_id)).map((x) => x.page_id);
  process.stdout.write(JSON.stringify(ids));
}
