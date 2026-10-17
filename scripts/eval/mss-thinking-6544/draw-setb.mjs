// PRIOR ART: scripts/eval/second-reader/draw.mjs (visible+translated frame, latin languages, flagged strata) — this draws handwritten books by book_class incl. hidden, stratified by script family
/**
 * Set B for #6544 (manuscript reads, thinking on/off): 40 handwritten pages, one per book, stratified by
 * `book_class.script_family`. Frame: books with book_class.class 'handwritten' and pages_count > 0, visible OR hidden.
 * Latin carries a BPH sub-quota (image_source.provider === 'bph' — the providerKey in src/lib/library-partners.ts).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/mss-thinking-6544/draw-setb.mjs \
 *     [--out /mnt/HC_Volume_105839809/jobs/mss-thinking-6544/setB] [--seed 6544]
 *
 * Read-only on Mongo. Book ids are sorted, then shuffled with makeRng(seed) (one stream, strata in fixed order).
 * Page eligibility: page_number > 0, page_type not front/back matter or plate, ocr.data >= 150 chars, pageScript() of
 * the stored read's TRANSCRIPTION (sourceProse: wrapper blocks such as <warning>/<meta>/<image-desc> removed, on the
 * first 6,000 chars fetched server-side with $substrCP) is >= 150 chars and its pageScript() matches the stratum, and the image downloads (200, > 2 KB). One page is
 * drawn uniformly among the eligible page_numbers; a book with no eligible page, or whose drawn page's image fails, is
 * rejected and replaced (reasons counted per stratum). Images > 12 MB or > 5000 px long side get a 3000 px JPEG q92
 * read copy; both are recorded.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { makeRng } from '../lib/paired-stats.mjs';
import { pageImageUrl } from '../spot-check/lib.mjs';
import { pageScript } from '../second-reader/lib.mjs';
import { sourceProse } from '../../lib/block-drift.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('out', '/mnt/HC_Volume_105839809/jobs/mss-thinking-6544/setB');
const SEED = Number(opt('seed', 6544));
if (fs.existsSync(path.join(OUT, 'draw.json'))) throw new Error(`${OUT}/draw.json exists — refusing to draw over a run`);

// [stratum, script_family, expected pageScript, target, extra book filter]
const STRATA = [
  ['latin-bph', 'latin', 'latin', 4, { 'image_source.provider': 'bph' }],
  ['latin-other', 'latin', 'latin', 10, { 'image_source.provider': { $ne: 'bph' } }],
  ['cjk', 'cjk', 'han', 8, {}],
  ['arabic', 'arabic', 'arabic', 6, {}],
  ['syriac', 'syriac', 'syriac', 5, {}],
  ['hebrew', 'hebrew', 'hebrew', 4, {}],
  ['greek', 'greek', 'greek', 3, {}],
];
const EXCLUDED_TYPES = ['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate'];
const MIN_OCR = 150, HEAD = 6000, MAX_BYTES = 12 * 1024 * 1024, MAX_SIDE = 5000, READ_SIDE = 3000;

const rng = makeRng(SEED);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const imgDir = path.join(OUT, 'images');
fs.mkdirSync(imgDir, { recursive: true });

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books'), pages = db.collection('pages');

async function download(url, base) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!r.ok) return { err: `http_${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length <= 2048) return { err: 'image_too_small' };
    const meta = await sharp(buf).metadata();
    const ext = meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpg';
    const orig = path.join(imgDir, `${base}.${ext}`);
    fs.writeFileSync(orig, buf);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const rec = { original: { path: orig, sha256: sha, bytes: buf.length, width: meta.width, height: meta.height, format: meta.format }, downscaled: false };
    if (buf.length > MAX_BYTES || Math.max(meta.width, meta.height) > MAX_SIDE) {
      const small = await sharp(buf).resize({ width: READ_SIDE, height: READ_SIDE, fit: 'inside' }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
      const p = path.join(imgDir, `${base}.read3000.jpg`);
      fs.writeFileSync(p, small.data);
      Object.assign(rec, { downscaled: true, path: p, sha256: crypto.createHash('sha256').update(small.data).digest('hex'), bytes: small.data.length, width: small.info.width, height: small.info.height });
    } else Object.assign(rec, { path: orig, sha256: sha, bytes: buf.length, width: meta.width, height: meta.height });
    return rec;
  } catch (e) { return { err: `fetch_error:${String(e.message || e).slice(0, 60)}` }; }
}

const picks = [], acceptance = {};
for (const [stratum, family, script, target, extra] of STRATA) {
  const frame = (await books.find({ 'book_class.class': 'handwritten', 'book_class.script_family': family, pages_count: { $gt: 0 }, ...extra },
    { projection: { _id: 0, id: 1 } }).toArray()).map((b) => b.id).filter(Boolean).sort();
  const reasons = {}; let visited = 0, accepted = 0;
  const bump = (k) => { reasons[k] = (reasons[k] || 0) + 1; };
  for (const id of shuffle(frame)) {
    if (accepted >= target) break;
    visited++;
    const cands = await pages.aggregate([
      { $match: { book_id: id, page_number: { $gt: 0 }, page_type: { $nin: EXCLUDED_TYPES } } },
      { $project: { page_number: 1, len: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] }, ocr_data: '$ocr.data' } },
      { $match: { len: { $gte: MIN_OCR } } },
      { $project: { page_number: 1, len: 1, head: { $substrCP: ['$ocr_data', 0, HEAD] } } },
      { $sort: { page_number: 1, _id: 1 } },
    ]).toArray();
    if (!cands.length) { bump('no_page_with_ocr_ge_150'); continue; }
    // Wrapper blocks (<warning>, <meta>, <image-desc>, …) are English prose the model wrote ABOUT the page; with them
    // left in, pageScript() calls a Manichaean fragment 'latin'. Judge script and length on the transcription only.
    const withProse = cands.map((p) => ({ ...p, prose: sourceProse(p.head) })).filter((p) => [...p.prose].length >= MIN_OCR);
    if (!withProse.length) { bump('no_page_with_prose_ge_150'); continue; }
    const el = withProse.filter((p) => pageScript(p.prose) === script);
    if (!el.length) { bump(`no_page_in_script_${script}`); continue; }
    const nums = [...new Set(el.map((p) => p.page_number))];
    const page_number = nums[Math.floor(rng() * nums.length)];
    const chosen = el.find((p) => p.page_number === page_number);
    const p = await pages.findOne({ _id: chosen._id }, { projection: { page_number: 1, page_type: 1, ocr: 1, photo: 1, cropped_photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1 } });
    const url = pageImageUrl(p);
    if (!url) { bump('no_image_url'); continue; }
    const img = await download(url, `${id}_${page_number}`);
    if (img.err) { bump(img.err.startsWith('fetch_error') ? 'image_fetch_error' : img.err); continue; }
    const b = await books.findOne({ id }, { projection: { _id: 0, title: 1, display_title: 1, author: 1, language: 1, published: 1, visible: 1, pages_count: 1, 'book_class.script_family': 1, 'image_source.provider': 1 } });
    const ocrText = p.ocr.data;
    picks.push({
      uid: `${id}:${page_number}`, stratum: stratum.startsWith('latin') ? 'latin' : stratum, substratum: stratum.startsWith('latin') ? stratum : null,
      book_id: id, page_number, page_id: String(p._id), page_type: p.page_type ?? null,
      title: b.display_title || b.title, author: b.author ?? null, language: b.language ?? null, published: b.published ?? null,
      visible: b.visible === true, visible_raw: b.visible ?? null, script_family: b.book_class?.script_family, provider: b.image_source?.provider ?? null,
      pages_count: b.pages_count, image_url: url, image: img.path, image_sha256: img.sha256, width: img.width, height: img.height,
      downscaled: img.downscaled, image_original: img.downscaled ? img.original : undefined,
      ocr_source: p.ocr?.source ?? null, ocr_model: p.ocr?.model ?? null, ocr_text: ocrText, ocr_chars: [...ocrText].length,
      has_lite: /flash-lite|lite/i.test(String(p.ocr?.model ?? '')),
      eligible_pages: nums.length, frame_size: frame.length,
    });
    accepted++;
    console.log(`${stratum.padEnd(11)} ${id} p${page_number} ${String(p.ocr?.model ?? p.ocr?.source).padEnd(26)} ${img.width}x${img.height}${img.downscaled ? ' (ds)' : ''} ${String(b.display_title || b.title).slice(0, 50)}`);
  }
  acceptance[stratum] = { frame: frame.length, target, visited, accepted, rate: visited ? accepted / visited : null, rejected: reasons };
}
await client.close();

for (const p of picks) p.acceptance = acceptance[p.substratum || p.stratum];
let sha = null; try { sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({
  meta: { issue: 6544, set: 'B', at: new Date().toISOString(), seed: SEED, rng: 'mulberry32 (paired-stats makeRng)', code_sha: sha,
    frame: "books.book_class.class='handwritten' && pages_count>0, visible or hidden", bph_marker: "image_source.provider === 'bph'",
    eligibility: { min_ocr_chars: MIN_OCR, page_number_gt: 0, excluded_types: EXCLUDED_TYPES, prose: 'sourceProse(first 6000 chars) (scripts/lib/block-drift.mjs: wrapper blocks removed) >= 150 chars', script_check: 'pageScript(prose)', image: 'HTTP 200, > 2048 bytes' },
    downscale: { if_bytes_gt: MAX_BYTES, if_long_side_gt: MAX_SIDE, to_long_side: READ_SIDE, jpeg_quality: 92 }, acceptance },
  picks,
}, null, 1));

// Summary table
const engine = (p) => p.ocr_model || p.ocr_source || 'unknown';
console.log('\nstratum      frame  target drawn visited  rejected');
for (const [k, a] of Object.entries(acceptance)) console.log(`${k.padEnd(12)} ${String(a.frame).padStart(5)} ${String(a.target).padStart(6)} ${String(a.accepted).padStart(5)} ${String(a.visited).padStart(7)}  ${JSON.stringify(a.rejected)}`);
console.log('\nengines per stratum (lite vs other):');
for (const s of [...new Set(picks.map((p) => p.stratum))]) {
  const ps = picks.filter((p) => p.stratum === s), byEng = {};
  for (const p of ps) byEng[engine(p)] = (byEng[engine(p)] || 0) + 1;
  console.log(`${s.padEnd(8)} lite ${ps.filter((p) => p.has_lite).length}/${ps.length}  ${JSON.stringify(byEng)}`);
}
console.log(`\nvisible ${picks.filter((p) => p.visible).length} / hidden-or-unset ${picks.filter((p) => !p.visible).length}; downscaled ${picks.filter((p) => p.downscaled).length}`);
console.log(`wrote ${OUT}/draw.json: ${picks.length} picks`);
