#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/greek-ms-fit-5619.mjs (#5619) — the Greek fit files, edition loading and Greek letter
 * stream this reads (loadEdition is not exported, so the two-line held-edition load is repeated here);
 * scripts/import/sefaria-fit-5560.mjs (#5560) — the Sefaria export fetch + flattenVersion stream; the
 * g4-hard-6707 request files (#6707) — the {uid, image, prompt} shape run-cli-arm.py reads. None draws pages from
 * a fit or a classification, which is what this does.
 *
 * Draws and request files for #6731 (PREREGISTRATION-hard-hands-6731.md). Read-only on Mongo; writes only under
 * $JOB_SCRATCH/hh (images, requests, references) and scripts/eval/results/hard-hands-6731 (page lists, no text).
 *
 *   node --env-file=… prepare.mjs class-pages            one seeded interior page per Rashi candidate → thumbs to view
 *   node --env-file=… prepare.mjs greek                  Greek draw, page images (Grec 1841 split), reference spans
 *   node --env-file=… prepare.mjs rashi-pages [--n 8]    seeded page order per mapped book → thumbs to view
 *   node --env-file=… prepare.mjs rashi                  kept Rashi pages → images, requests, Sefaria streams
 *   node --env-file=… prepare.mjs requests               request files per script (live default prompt, hash-checked)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { withMongo } from '../../lib/mongo.mjs';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { buildGreekStream } from '../greek-ms-fit-5619.mjs';
import { bodyText } from '../../import/sefaria-fit-5560.mjs';
import { flattenVersion } from '../../lib/sefaria-fit.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const val = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const SCRATCH = path.join(process.env.JOB_SCRATCH || '/tmp', 'hh');
const RES = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'results', 'hard-hands-6731');
const FIT = '/mnt/HC_Volume_105839809/greek-ms-align-5619';
const PROMPT_HASH = '9d8f959e053491362b2c4acec1e20c9a';
const u = (s) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 12), 16) / 2 ** 48;
const mk = (d) => { fs.mkdirSync(d, { recursive: true }); return d; };
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

async function fetchTo(url, file) {
  if (fs.existsSync(file)) return file;
  const r = await fetch(url, { headers: { 'user-agent': 'sourcelibrary-eval/6731' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}
// Long side capped (prereg: 3,000 px for reads; thumbs for viewing are smaller). Python/PIL is on the box.
function resize(src, dst, max, box = null) {
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
b = sys.argv[4]
if b != '-':
    x0, x1 = map(int, b.split(','))
    im = im.crop((x0, 0, x1, im.size[1]))
im.thumbnail((int(sys.argv[3]), int(sys.argv[3])))
im.save(sys.argv[2], quality=90)
`, src, dst, String(max), box ? box.join(',') : '-']);
  return dst;
}
// Gutter: the lowest-variance pixel column within 45–58 % of the width (prereg, Grec 1841 spreads).
function gutter(src) {
  return Number(execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageStat
im = Image.open(sys.argv[1]).convert('L'); w, h = im.size
s = im.resize((w // 4, h // 4)); W, H = s.size
best = None
for x in range(int(W * 0.45), int(W * 0.58)):
    col = s.crop((x, int(H * 0.1), x + 1, int(H * 0.9)))
    v = ImageStat.Stat(col).var[0]
    if best is None or v < best[0]: best = (v, x)
print(best[1] * 4)
`, src]).toString().trim());
}
// Amendment 2: the page's own image (a split page's archived_photo is the whole spread).
const imgUrl = (p) => getPageSource(p);

// ── Rashi: one seeded interior page per candidate book, for classification by eye ──
async function classPages(db) {
  const cands = JSON.parse(fs.readFileSync(path.join(RES, 'rashi-candidates.json'), 'utf8')).books;
  const dir = mk(path.join(SCRATCH, 'class'));
  const out = [];
  for (const b of cands) {
    const ps = await db.collection('pages').find({ book_id: b.id }, { projection: { _id: 0, id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1 } }).sort({ page_number: 1 }).toArray();
    const withImg = ps.filter(imgUrl);
    if (!withImg.length) { out.push({ book: b.id, page: null, note: 'no page image' }); continue; }
    const lo = Math.floor(withImg.length * 0.3), hi = Math.max(lo + 1, Math.ceil(withImg.length * 0.7));
    const p = withImg[lo + Math.floor(u(`hardhands-6731|class|${b.id}`) * (hi - lo))];
    const raw = path.join(dir, `${b.id}-${p.page_number}.orig.jpg`), th = path.join(dir, `${b.id}-${p.page_number}.jpg`);
    try { await fetchTo(imgUrl(p), raw); resize(raw, th, 1400); } catch (e) { out.push({ book: b.id, page: p.page_number, note: `image fetch failed: ${e.message}` }); continue; }
    out.push({ book: b.id, page: p.page_number, page_id: p.id, title: b.title, thumb: th });
    log(`${b.id} p${p.page_number}`);
  }
  fs.writeFileSync(path.join(SCRATCH, 'class-pages.json'), JSON.stringify(out, null, 1));
}

// ── Greek: draw, images, reference spans ──
const GREEK = {
  '69a5e5e985fa13e734e41cba': { name: 'Grec 1841', ed: 'schneider', edition: '69942ffcbb14908bbd9a1123', spread: true },
  '69a5e5e385fa13e734e41894': { name: 'Grec 1839', ed: 'schneider', edition: '69942ffcbb14908bbd9a1123' },
  '6a45298cc6d95bc278fbc8c3': { name: 'Marcianus gr. 299', ed: 'caag', edition: '6994383a6879ff0184cb803a' },
  '69b4c04d978ca9526eda33f7': { name: 'Ars sacra', ed: 'caag', edition: '6994383a6879ff0184cb803a' },
  '69938921ce15387065946912': { name: 'Psellos', ed: 'schneider', edition: '69942ffcbb14908bbd9a1123' },
};

function qualifying(book, ed, reads) {
  const j = JSON.parse(fs.readFileSync(path.join(FIT, `fit-${book}-${ed}-${reads}.json`), 'utf8'));
  const L = j.summary.boundaries.letters_per_line;
  return { L, rows: j.neighbour.filter((x) => x.verdict !== 'edges' && x.start_err != null && x.end_err != null && Math.abs(x.start_err) <= L && Math.abs(x.end_err) <= L) };
}

async function greek(db) {
  const dir = mk(path.join(SCRATCH, 'greek'));
  const streams = {};
  const draw = [];
  for (const [book, cfg] of Object.entries(GREEK)) {
    if (!streams[cfg.edition]) {
      const ps = await db.collection('pages').find({ book_id: cfg.edition, page_number: { $gte: 0 } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
      streams[cfg.edition] = buildGreekStream(ps.filter((p) => p.ocr?.data).map((p) => ({ ref: `${cfg.edition} p${p.page_number}`, text: bodyText(p.ocr.data) })));
    }
    const st = streams[cfg.edition];
    const k = qualifying(book, cfg.ed, 'kraken');
    let pool = k.rows.map((r) => ({ ...r, fit: 'kraken', L: k.L }));
    if (pool.length < 15) { const f = qualifying(book, cfg.ed, 'flash-v2'); const have = new Set(pool.map((r) => r.page)); pool.push(...f.rows.filter((r) => !have.has(r.page)).map((r) => ({ ...r, fit: 'flash-v2', L: f.L }))); }
    pool.sort((a, b) => u(`hardhands-6731|${book}|${a.page}`) - u(`hardhands-6731|${book}|${b.page}`));
    for (const r of pool.slice(0, 15)) {
      const p = await db.collection('pages').findOne({ book_id: book, page_number: r.page }, { projection: { _id: 0, id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.model': 1 } });
      const a = Math.max(0, r.a - r.L), b = Math.min(st.letters.length, r.b + r.L);
      // letter range → edition text (segments joined by newlines, each cut at the letter's offset)
      const s0 = st.seg[a], s1 = st.seg[b - 1];
      let ref = '';
      for (let s = s0; s <= s1; s++) {
        const t = String(st.segments[s].text || '').normalize('NFC');
        ref += (s === s0 ? t.slice(st.off[a], s === s1 ? st.off[b - 1] + 1 : undefined) : s === s1 ? t.slice(0, st.off[b - 1] + 1) : t) + '\n';
      }
      const uid = `greek|${book.slice(-6)}-p${r.page}`;
      const raw = path.join(dir, `${book}-${r.page}.orig.jpg`);
      const src = fs.existsSync(path.join(FIT, 'kraken-full', `${book}-${r.page}.jpg`)) ? path.join(FIT, 'kraken-full', `${book}-${r.page}.jpg`) : await fetchTo(imgUrl(p), raw);
      const images = [];
      if (cfg.spread) {
        const g = gutter(src);
        const w = Number(execFileSync('python3', ['-c', 'import sys;from PIL import Image;print(Image.open(sys.argv[1]).size[0])', src]).toString().trim());
        images.push(resize(src, path.join(dir, `${book}-${r.page}-L.jpg`), 3000, [0, g]), resize(src, path.join(dir, `${book}-${r.page}-R.jpg`), 3000, [g, w]));
      } else images.push(resize(src, path.join(dir, `${book}-${r.page}.jpg`), 3000));
      const kf = path.join(FIT, 'kraken-full', `${book}-${r.page}.txt`);
      const unit = { uid, script: 'greek', book, work: cfg.name, page: r.page, page_id: p.id, fit: r.fit, span: [r.a, r.b], pad: r.L, verdict_k6: r.verdict_k6 || r.verdict, images,
        production: { model: p.ocr?.model || null, text: p.ocr?.data || '' }, kraken: fs.existsSync(kf) ? fs.readFileSync(kf, 'utf8') : null, reference: ref };
      draw.push(unit);
      log(`${uid} ${cfg.name} fit=${r.fit} ref ${ref.length} chars ${images.length} image(s)`);
    }
  }
  fs.writeFileSync(path.join(SCRATCH, 'greek-units.json'), JSON.stringify(draw, null, 1));
  // committed: page list only (no reference text, no reads)
  fs.writeFileSync(path.join(RES, 'greek-pages.json'), JSON.stringify(draw.map(({ uid, book, work, page, page_id, fit, span, pad, verdict_k6, images, production }) => ({ uid, book, work, page, page_id, fit, span, pad, verdict_k6, n_images: images.length, production_model: production.model })), null, 1));
}

// ── Rashi: seeded page order per mapped book, thumbs to confirm Rashi-type text by eye ──
async function rashiPages(db) {
  const map = JSON.parse(fs.readFileSync(path.join(RES, 'rashi-sefaria-map.json'), 'utf8')).books;
  const ids = Object.keys(map).sort((a, b) => u(`hardhands-6731|book|${a}`) - u(`hardhands-6731|book|${b}`)).slice(0, 12);
  const n = Number(val('n', '8'));
  const dir = mk(path.join(SCRATCH, 'rashi-view'));
  const out = [];
  for (const id of ids) {
    const ps = (await db.collection('pages').find({ book_id: id }, { projection: { _id: 0, id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1 } }).sort({ page_number: 1 }).toArray()).filter(imgUrl);
    const lo = Math.floor(ps.length * 0.1), hi = Math.ceil(ps.length * 0.9);
    const order = ps.slice(lo, hi).sort((a, b) => u(`hardhands-6731|page|${id}|${a.page_number}`) - u(`hardhands-6731|page|${id}|${b.page_number}`)).slice(0, n);
    for (const [i, p] of order.entries()) {
      const raw = path.join(dir, `${id}-${p.page_number}.orig.jpg`), th = path.join(dir, `${id}-${p.page_number}.jpg`);
      try { await fetchTo(imgUrl(p), raw); resize(raw, th, 1400); } catch (e) { log(`${id} p${p.page_number} fetch failed ${e.message}`); continue; }
      out.push({ book: id, rank: i, page: p.page_number, page_id: p.id, thumb: th });
    }
    log(`${id} ${map[id].name}: ${order.length} pages`);
  }
  fs.writeFileSync(path.join(SCRATCH, 'rashi-view.json'), JSON.stringify(out, null, 1));
}

// ── Sefaria: export path from the index API, cached ──
export async function sefariaSegments(title) {
  const dir = mk(path.join(SCRATCH, 'sefaria'));
  const f = path.join(dir, `${title.replace(/[^\w.-]+/g, '_')}.json`);
  if (!fs.existsSync(f)) {
    const idx = await (await fetch(`https://www.sefaria.org/api/v2/index/${encodeURIComponent(title.replace(/ /g, '_'))}`)).json();
    if (!idx.categories) throw new Error(`sefaria index: no categories for ${title}`);
    const rel = ['json', ...idx.categories, idx.title, 'Hebrew', 'merged.json'].map(encodeURIComponent).join('/');
    const r = await fetch(`https://storage.googleapis.com/sefaria-export/${rel}`);
    if (!r.ok) throw new Error(`sefaria export ${r.status} ${rel}`);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  return flattenVersion(json).map((s) => ({ ...s, ref: `${json.title} ${s.ref}`.replace(/\s+/g, ' ').trim(), work: json.title }));
}

async function rashi(db) {
  const map = JSON.parse(fs.readFileSync(path.join(RES, 'rashi-sefaria-map.json'), 'utf8')).books;
  const kept = JSON.parse(fs.readFileSync(path.join(RES, 'rashi-pages.json'), 'utf8')).pages.filter((p) => p.keep);
  const dir = mk(path.join(SCRATCH, 'rashi'));
  const units = [];
  for (const k of kept) {
    const p = await db.collection('pages').findOne({ book_id: k.book, page_number: k.page }, { projection: { _id: 0, id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.model': 1 } });
    const raw = path.join(SCRATCH, 'rashi-view', `${k.book}-${k.page}.orig.jpg`);
    await fetchTo(imgUrl(p), raw);
    const img = resize(raw, path.join(dir, `${k.book}-${k.page}.jpg`), 3000);
    units.push({ uid: `rashi|${k.book.slice(-6)}-p${k.page}`, script: 'hebrew', book: k.book, work: map[k.book].name, sefaria: map[k.book].sefaria, page: k.page, page_id: p.id, images: [img],
      production: { model: p.ocr?.model || null, text: p.ocr?.data || '' } });
  }
  fs.writeFileSync(path.join(SCRATCH, 'rashi-units.json'), JSON.stringify(units, null, 1));
  // warm the Sefaria cache for every mapped title
  for (const t of new Set(units.flatMap((x) => x.sefaria))) { const s = await sefariaSegments(t); log(`sefaria ${t}: ${s.length} segments`); }
}

async function requests(db) {
  const { base, ref } = await liveOcrPrompt(db);
  if (ref.hash !== PROMPT_HASH) throw new Error(`live OCR prompt hash ${ref.hash} ≠ preregistered ${PROMPT_HASH}: stop`);
  const dir = mk(path.join(SCRATCH, 'req'));
  for (const s of ['greek', 'rashi']) {
    const f = path.join(SCRATCH, `${s}-units.json`); if (!fs.existsSync(f)) continue;
    const rows = JSON.parse(fs.readFileSync(f, 'utf8')).flatMap((x) => x.images.map((img, i) => ({ uid: x.images.length > 1 ? `${x.uid}#${i ? 'R' : 'L'}` : x.uid, image: img, prompt: base })));
    fs.writeFileSync(path.join(dir, `${s}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    log(`${s}: ${rows.length} requests`);
  }
  fs.writeFileSync(path.join(dir, 'prompt-ref.json'), JSON.stringify(ref));
}

const COMMANDS = { 'class-pages': classPages, greek, 'rashi-pages': rashiPages, rashi, requests };
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (!COMMANDS[cmd]) { console.error(`usage: ${Object.keys(COMMANDS).join('|')}`); process.exit(2); }
  await withMongo(async (db) => { await COMMANDS[cmd](db); }, { noTimeout: true });
}
