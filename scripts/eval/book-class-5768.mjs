#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/quality-covariates.mjs --corpus-profile (#5643: ONE picked page per book,
 * its descriptor answer is read here as a label, not re-run); scripts/lib/syriac-kraken-lane.mjs
 * (`routeBook` — the manuscript-library / pre-1500 rule, reused as the metadata signal, and
 * `scriptTagCounts`); scripts/lib/ocr-result-parse.mjs `extractScriptType` (the tag parser);
 * scripts/eval/contact-sheet-screen.mjs (the grid builder the paid fallback reuses). None of them
 * stores a per-BOOK class with its evidence, which is what #5768 asks for.
 *
 * book-class-5768 — handwritten / printed / mixed + script family for every book (#5768).
 *
 * Stages (each writes a cache under scripts/eval/output/book-class-5768/, resumable):
 *   --labels    $0. Per book: 8 spread pages → OCR `<script>` tag + `pages.script_type`, letter
 *               counts by Unicode block of the OCR text (script family), metadata signals, the
 *               #5643 census answer, and the 3 spread text-page thumbnails the classifier uses.
 *   --summary   agreement between the free sources; prints counts.
 *
 *   node --env-file=.env.production.local scripts/eval/book-class-5768.mjs --labels
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';
import { extractScriptType } from '../lib/ocr-result-parse.mjs';
import { routeBook, editionYear } from '../lib/syriac-kraken-lane.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const OUT_DIR = path.join(ROOT, 'scripts/eval/output/book-class-5768');
export const LABELS_FILE = path.join(OUT_DIR, 'labels.jsonl');
const CENSUS_FILE = path.join(ROOT, 'scripts/eval/output/corpus-page-profile-2026-10-02-typeface.jsonl.gz');
const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };

export const SAMPLE_PAGES = 8;
const TEXTISH = new Set(['text', 'table', 'index', 'preface', 'toc', 'contents', 'colophon', 'title-page', 'notes', 'commentary', 'appendix', 'dedication']);

// ── script family by Unicode block ──────────────────────────────────────────────────────────
const BLOCKS = [
  ['greek', 0x0370, 0x03FF], ['greek', 0x1F00, 0x1FFF], ['coptic', 0x2C80, 0x2CFF],
  ['cyrillic', 0x0400, 0x052F], ['armenian', 0x0530, 0x058F], ['hebrew', 0x0590, 0x05FF],
  ['arabic', 0x0600, 0x06FF], ['arabic', 0x0750, 0x077F], ['arabic', 0xFB50, 0xFDFF], ['arabic', 0xFE70, 0xFEFF],
  ['syriac', 0x0700, 0x074F], ['indic', 0x0900, 0x0DFF], ['southeast-asian', 0x0E00, 0x0EFF], ['tibetan', 0x0F00, 0x0FFF],
  ['southeast-asian', 0x1000, 0x109F], ['georgian', 0x10A0, 0x10FF], ['cjk', 0x1100, 0x11FF], ['ethiopic', 0x1200, 0x139F],
  ['mongolian', 0x1800, 0x18AF], ['cjk', 0x3040, 0x30FF], ['cjk', 0x3100, 0x31FF], ['cjk', 0x3400, 0x4DBF],
  ['cjk', 0x4E00, 0x9FFF], ['cjk', 0xAC00, 0xD7AF], ['cjk', 0xF900, 0xFAFF], ['cuneiform', 0x12000, 0x1254F],
  ['egyptian', 0x13000, 0x1342F], ['cjk', 0x20000, 0x2FFFF],
];
const META_TAGS = /<(lang|language|script|page-type|page-num|columns|warning|meta|sig|header|image-desc|detected-images)\b[^>]*>[\s\S]*?<\/\1>/gi;
export function letterFamilies(text) {
  const out = {};
  const body = String(text || '').replace(META_TAGS, ' ').replace(/<[^>]+>/g, ' ');
  for (const ch of body) {
    const c = ch.codePointAt(0);
    let fam = null;
    if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0xC0 && c <= 0x24F) || (c >= 0x1E00 && c <= 0x1EFF)) fam = 'latin';
    else if (c >= 0x370) { for (const [f, a, b] of BLOCKS) if (c >= a && c <= b) { fam = f; break; } if (!fam && /\p{L}/u.test(ch)) fam = 'other'; }
    if (fam) out[fam] = (out[fam] || 0) + 1;
  }
  return out;
}

/** Book family from summed letter counts: dominant, plus a secondary at ≥ 20% of letters. */
export function familyOf(counts, minLetters = 80) {
  const tot = Object.values(counts).reduce((s, x) => s + x, 0);
  if (tot < minLetters) return null;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return { family: top[0][0], share: +(top[0][1] / tot).toFixed(3), secondary: top[1] && top[1][1] / tot >= 0.2 ? top[1][0] : null, letters: tot };
}

// Fallback when no OCR text exists. Edition language → family. Deliberately partial: a language not
// listed returns null rather than a guess.
const LANG_FAMILY = {
  latin: 'latin', english: 'latin', german: 'latin', french: 'latin', italian: 'latin', spanish: 'latin', dutch: 'latin',
  portuguese: 'latin', polish: 'latin', czech: 'latin', swedish: 'latin', danish: 'latin', hungarian: 'latin', catalan: 'latin',
  'middle english': 'latin', 'old english': 'latin', nahuatl: 'latin', welsh: 'latin', irish: 'latin', norwegian: 'latin', icelandic: 'latin',
  greek: 'greek', 'ancient greek': 'greek', 'byzantine greek': 'greek', 'modern greek': 'greek', coptic: 'coptic',
  russian: 'cyrillic', 'church slavonic': 'cyrillic', 'old church slavonic': 'cyrillic', ukrainian: 'cyrillic', bulgarian: 'cyrillic', serbian: 'cyrillic',
  hebrew: 'hebrew', yiddish: 'hebrew', aramaic: 'hebrew', 'judeo-arabic': 'hebrew', ladino: 'hebrew',
  arabic: 'arabic', persian: 'arabic', 'ottoman turkish': 'arabic', urdu: 'arabic', syriac: 'syriac',
  armenian: 'armenian', georgian: 'georgian', "ge'ez": 'ethiopic', geez: 'ethiopic', ethiopic: 'ethiopic', amharic: 'ethiopic',
  sanskrit: 'indic', hindi: 'indic', bengali: 'indic', tamil: 'indic', pali: 'indic', marathi: 'indic', tibetan: 'tibetan',
  chinese: 'cjk', 'classical chinese': 'cjk', japanese: 'cjk', korean: 'cjk', mongolian: 'mongolian', manchu: 'mongolian',
  sumerian: 'cuneiform', akkadian: 'cuneiform', 'egyptian': 'egyptian', thai: 'southeast-asian', burmese: 'southeast-asian',
};
export const languageFamily = (lang) => LANG_FAMILY[String(lang || '').trim().toLowerCase()] ?? null;

// ── metadata signal ─────────────────────────────────────────────────────────────────────────
const MS_SHELFMARK = /^(ms|mss|cod|codex|or\.|add\.|vat\.|borg\.|barb\.|urb\.|neofiti|harley|sloane|arundel|royal|egerton|cotton|plut\.|pal\.|reg\.|ross\.|ott\.|chig\.|sin\.|syr\.|arab|hebr|heb\.|gr\.|grec|lat\.|suppl\.|nouv\.|coislin|clm|cgm|cod\.)/i;
const MS_TITLE = /\b(manuscript|manuscrit|handschrift|manoscritto|manuscrito|codex|cod\.|ms\.?\s*[a-z0-9]|mss\.?)\b/i;
export function metadataSignal(b) {
  const why = [];
  const fam = languageFamily(b.language);
  if (b.shelfmark && MS_SHELFMARK.test(String(b.shelfmark).trim())) why.push(`shelfmark ${String(b.shelfmark).slice(0, 40)}`);
  if (MS_TITLE.test(String(b.title || ''))) why.push('title says manuscript/codex');
  if (/^manuscript/.test(String(b.resource_type || ''))) why.push(`resource_type ${b.resource_type}`);
  const route = routeBook(b, {});
  // routeBook's pre-1500 rule is for Syriac; block printing makes it wrong for CJK and Tibetan.
  if (route.route === 'manuscript' && /^provider/.test(route.why)) why.push(route.why);
  const y = editionYear(b.published);
  if (y !== null && y < 1450 && !['cjk', 'tibetan', 'mongolian'].includes(fam)) why.push(`published ${b.published}`);
  return why.length ? { answer: 'handwritten', why } : null;
}

/** Book class from page answers: majority; printed and handwritten both ≥ 25% → mixed. */
export function classOf(counts) {
  const pr = counts.printed || 0, hw = counts.handwritten || 0, mx = counts.mixed || 0;
  const n = pr + hw + mx;
  if (!n) return null;
  if (pr / n >= 0.25 && hw / n >= 0.25) return 'mixed';
  const top = [['printed', pr], ['handwritten', hw], ['mixed', mx]].sort((a, b) => b[1] - a[1]);
  return top[0][0];
}

/** `count` spread page numbers across a book, avoiding the first and last 5% (covers, bindings). */
export function spreadPages(pagesCount, count) {
  const out = new Set();
  const lo = Math.max(1, Math.round(pagesCount * 0.05)), hi = Math.max(lo, Math.round(pagesCount * 0.95));
  for (let i = 0; i < count; i++) out.add(Math.round(lo + ((i + 0.5) / count) * (hi - lo)));
  return [...out];
}

const thumbOf = (p) => [p.thumbnail_blob, p.image_thumb].find((u) => typeof u === 'string' && /^https:\/\/images\.sourcelibrary\.org\//.test(u)) || getPageSource(p) || null;

async function loadCensus() {
  const m = new Map();
  if (!fs.existsSync(CENSUS_FILE)) return m;
  const rl = readline.createInterface({ input: fs.createReadStream(CENSUS_FILE).pipe(zlib.createGunzip()) });
  for await (const l of rl) {
    const r = JSON.parse(l);
    m.set(r.book_id, { script: r.script ?? null, script_src: r.script_src ?? null, descriptor_script: r.descriptor?.script ?? null, typeface: r.typeface ?? null, page_id: r.page_id ?? null, family: r.family ?? null });
  }
  return m;
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function labels() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const done = new Set(readJsonl(LABELS_FILE).map((r) => r.book_id));
  const census = await loadCensus();
  console.log(`census rows ${census.size}; already labelled ${done.size}`);
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db('bookstore');
  const books = [];
  const cur = db.collection('books').find({ pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, title: 1, language: 1, published: 1, pages_count: 1, visible: 1, shelfmark: 1, resource_type: 1, contributing_library: 1, 'image_source.provider': 1, 'pipeline_auto.hold.reason': 1, 'pipeline_auto.status': 1 } });
  for await (const b of cur) if (b.id && !done.has(b.id)) books.push(b);
  console.log(`books to label ${books.length}`);
  const out = fs.createWriteStream(LABELS_FILE, { flags: 'a' });
  const proj = { _id: 0, id: 1, book_id: 1, page_number: 1, script_type: 1, page_type: 1, 'ocr.model': 1, thumbnail_blob: 1, image_thumb: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1 };
  const BATCH = 40;
  let n = 0;
  const work = async (batch) => {
    const want = new Map(batch.map((b) => [b.id, spreadPages(b.pages_count, SAMPLE_PAGES)]));
    const pages = await db.collection('pages').aggregate([
      { $match: { $or: batch.map((b) => ({ book_id: b.id, page_number: { $in: want.get(b.id) } })) } },
      { $project: { ...proj, o: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, 2500] } } },
    ], { allowDiskUse: false }).toArray();
    const byBook = new Map();
    for (const p of pages) { if (!byBook.has(p.book_id)) byBook.set(p.book_id, []); byBook.get(p.book_id).push(p); }
    for (const b of batch) {
      const ps = (byBook.get(b.id) || []).sort((x, y) => x.page_number - y.page_number);
      const tags = {}, fam = {};
      const pageRows = ps.map((p) => {
        const tag = extractScriptType(p.o) ?? null;
        const st = p.script_type ?? null;
        const answer = tag || st;
        if (answer) tags[answer] = (tags[answer] || 0) + 1;
        const lf = letterFamilies(p.o);
        for (const [k, v] of Object.entries(lf)) fam[k] = (fam[k] || 0) + v;
        const pt = p.page_type || (/<page-type>\s*([\w-]+)/i.exec(p.o || '')?.[1]) || null;
        return { page_id: p.id, n: p.page_number, tag, script_type: st, page_type: pt, ocr_model: p.ocr?.model ?? null, has_ocr: !!(p.o && p.o.trim()), letters: Object.values(lf).reduce((s, x) => s + x, 0), thumb: thumbOf(p) };
      });
      const c = census.get(b.id) || null;
      const famOcr = familyOf(fam);
      const row = {
        book_id: b.id, title: String(b.title || '').slice(0, 100), language: b.language ?? null, published: b.published ?? null,
        pages_count: b.pages_count, visible: !!b.visible, provider: b.image_source?.provider ?? null, library: b.contributing_library ?? null,
        hold: b.pipeline_auto?.hold?.reason ?? null, status: b.pipeline_auto?.status ?? null,
        pages: pageRows, tag_counts: tags, tag_class: classOf(tags),
        family_ocr: famOcr, family_lang: languageFamily(b.language),
        census: c ? { script: c.script, script_src: c.script_src, descriptor_script: c.descriptor_script, typeface: c.typeface, page_id: c.page_id } : null,
        meta: metadataSignal(b),
      };
      out.write(JSON.stringify(row) + '\n');
    }
    n += batch.length;
  };
  const CONC = Number(opt('concurrency', 4));
  let i = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < books.length) {
      const batch = books.slice(i, i + BATCH); i += BATCH;
      for (let attempt = 0; ; attempt++) {
        try { await work(batch); break; } catch (e) { if (attempt >= 3) throw e; console.error('retry', e.message); await new Promise((r) => setTimeout(r, 5000)); }
      }
      if (n % 2000 < BATCH) console.log(`${n}/${books.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }));
  await new Promise((r) => out.end(r));
  await client.close();
  console.log('labels done', n);
}

// ── CLIP page embeddings, in-process at the caller's nice level (#5768 step 2) ──────────────────
// Same model and runtime as the production clip-server (Xenova/clip-vit-base-patch32, @xenova v2,
// quantized), loaded here instead of called over HTTP so the whole job runs under `nice -n 19`:
// the shared server runs at normal priority and would compete with the pipeline workers.
export const EMB_FILE = path.join(OUT_DIR, 'page-clip.jsonl');
const TRAIN_FILE = path.join(OUT_DIR, 'train-pages.json');
const TARGET_FILE = path.join(OUT_DIR, 'target-pages.json');
const freeClass = (r) => r.tag_class || r.census?.script || null;
const tagN = (r) => Object.values(r.tag_counts || {}).reduce((a, b) => a + b, 0);
const textish = (p) => !p.page_type || TEXTISH.has(p.page_type);

/** Pick the pages to embed: a stratified training set (tagged pages) and 3 spread pages per unlabelled book. */
function plan() {
  const rows = readJsonl(LABELS_FILE);
  let seed = 5768; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const cells = new Map();
  for (const r of rows) {
    if (!r.family_ocr || tagN(r) < 2) continue;
    const ps = r.pages.filter((p) => (p.tag || p.script_type) && p.thumb && textish(p) && p.letters >= 40).sort(() => rnd() - 0.5).slice(0, 2);
    for (const p of ps) {
      const k = `${r.family_ocr.family}|${p.tag || p.script_type}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push({ book_id: r.book_id, page_id: p.page_id, url: p.thumb, label: p.tag || p.script_type, family: r.family_ocr.family });
    }
  }
  const PER_CELL = Number(opt('per-cell', 700));
  const train = [];
  for (const [k, a] of [...cells].sort()) { const s = a.sort(() => rnd() - 0.5).slice(0, PER_CELL); train.push(...s); console.log(`train cell ${k}: ${s.length} of ${a.length}`); }
  const target = [];
  for (const r of rows) {
    if (freeClass(r)) continue;
    const ps = r.pages.filter((p) => p.thumb);
    if (!ps.length) continue;
    const idx = ps.length >= 3 ? [Math.floor(ps.length * 0.25), Math.floor(ps.length * 0.5), Math.floor(ps.length * 0.75)] : ps.map((_, i) => i);
    for (const i of [...new Set(idx)]) target.push({ book_id: r.book_id, page_id: ps[i].page_id, url: ps[i].thumb });
  }
  fs.writeFileSync(TRAIN_FILE, JSON.stringify(train));
  fs.writeFileSync(TARGET_FILE, JSON.stringify(target));
  console.log(`train pages ${train.length}; target pages ${target.length} over ${new Set(target.map((t) => t.book_id)).size} books`);
}

async function embed() {
  const which = opt('set', 'train');
  const items = JSON.parse(fs.readFileSync(which === 'train' ? TRAIN_FILE : TARGET_FILE, 'utf8'));
  const done = new Set(readJsonl(EMB_FILE).map((r) => r.page_id));
  for (const f of fs.readdirSync(OUT_DIR).filter((f) => /^page-clip\.\d+\.jsonl$/.test(f))) for (const r of readJsonl(path.join(OUT_DIR, f))) done.add(r.page_id);
  const [si, sn] = opt('shard', '0/1').split('/').map(Number);
  const todo = items.filter((x, i) => i % sn === si && !done.has(x.page_id)).slice(0, Number(opt('limit', 1e9)));
  console.log(`${which}: ${todo.length} to embed (${done.size} cached)`);
  const { env, CLIPVisionModelWithProjection, AutoProcessor, RawImage } = await import('@xenova/transformers');
  env.backends.onnx.wasm.numThreads = Number(opt('threads', 2));
  const model = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { quantized: true });
  const processor = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');
  // One file per shard so concurrent shards never interleave writes; readers glob page-clip*.jsonl.
  const out = fs.createWriteStream(sn > 1 ? EMB_FILE.replace(/\.jsonl$/, `.${si}.jsonl`) : EMB_FILE, { flags: 'a' });
  const fetchImg = async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org) book-class-5768' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return RawImage.fromBlob(new Blob([Buffer.from(await res.arrayBuffer())], { type: res.headers.get('content-type') || 'image/jpeg' }));
  };
  const FETCH_AHEAD = Number(opt('fetch-concurrency', 6));
  const t0 = Date.now(); let ok = 0, fail = 0;
  const pending = [];
  let next = 0;
  const launch = () => { while (pending.length < FETCH_AHEAD && next < todo.length) { const it = todo[next++]; pending.push({ it, img: fetchImg(it.url).catch((e) => e) }); } };
  launch();
  while (pending.length) {
    const { it, img } = pending.shift(); launch();
    const im = await img;
    if (im instanceof Error) { fail++; out.write(JSON.stringify({ page_id: it.page_id, book_id: it.book_id, error: im.message }) + '\n'); continue; }
    try {
      const { image_embeds } = await model(await processor(im));
      const v = Array.from(image_embeds.data); const nrm = Math.hypot(...v) || 1;
      out.write(JSON.stringify({ page_id: it.page_id, book_id: it.book_id, e: Buffer.from(new Float32Array(v.map((x) => x / nrm)).buffer).toString('base64') }) + '\n');
      ok++;
    } catch (e) { fail++; out.write(JSON.stringify({ page_id: it.page_id, book_id: it.book_id, error: e.message }) + '\n'); }
    if ((ok + fail) % 500 === 0) console.log(`${ok + fail}/${todo.length} ok ${ok} fail ${fail} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await new Promise((r) => out.end(r));
  console.log(`embedded ${ok}, failed ${fail}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

// ── classify (#5768 step 2) ──────────────────────────────────────────────────────────────────
// k-nearest-neighbours over the tagged training pages, cosine on unit CLIP vectors. Measured on
// the held-out books first (2026-10-04): a softmax logistic regression on the same vectors scored
// 69.3% on three classes and 78.8% on two; kNN-15 scored 85.7% on two, 95.2% where ≥ 80% of the
// neighbours agree. "mixed" is not separable at 224 px (LR: 43% recall, 30% precision), so a PAGE
// is handwritten or not; a BOOK is mixed when its confident pages split.
export const CLIP_FILE = path.join(OUT_DIR, 'clip-classes.jsonl');
const K = 15, VOTE_FLOOR = 0.8;
function loadEmbeddings() {
  const m = new Map();
  for (const f of fs.readdirSync(OUT_DIR).filter((f) => /^page-clip(\.\d+)?\.jsonl$/.test(f))) {
    for (const r of readJsonl(path.join(OUT_DIR, f))) if (r.e) { const b = Buffer.from(r.e, 'base64'); m.set(r.page_id, new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))); }
  }
  return m;
}
const heldOut = (bookId) => { let x = 5768; for (const c of bookId) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 100 < 25; };

/** Neighbour vote for one vector: share handwritten, and the family vote. */
function knn(train, v) {
  const best = []; // [sim, idx], kept sorted ascending, length ≤ K
  for (let i = 0; i < train.length; i++) {
    const e = train[i].e; let s = 0;
    for (let j = 0; j < 512; j++) s += e[j] * v[j];
    if (best.length < K) { best.push([s, i]); best.sort((a, b) => a[0] - b[0]); } else if (s > best[0][0]) { best[0] = [s, i]; best.sort((a, b) => a[0] - b[0]); }
  }
  const hw = best.filter(([, i]) => train[i].label === 'handwritten').length / best.length;
  const fam = {}; for (const [, i] of best) fam[train[i].family] = (fam[train[i].family] || 0) + 1;
  const ftop = Object.entries(fam).sort((a, b) => b[1] - a[1])[0];
  return { hw, answer: hw >= 0.5 ? 'handwritten' : 'printed', vote: Math.max(hw, 1 - hw), family: ftop[0], fvote: ftop[1] / best.length };
}
function trainSet(emb, { excludeHeldOut }) {
  return JSON.parse(fs.readFileSync(TRAIN_FILE, 'utf8')).filter((x) => emb.has(x.page_id) && !(excludeHeldOut && heldOut(x.book_id))).map((x) => ({ ...x, e: emb.get(x.page_id) }));
}

function evaluate() {
  const emb = loadEmbeddings();
  const tr = trainSet(emb, { excludeHeldOut: true });
  const te = JSON.parse(fs.readFileSync(TRAIN_FILE, 'utf8')).filter((x) => emb.has(x.page_id) && heldOut(x.book_id));
  const res = te.map((x) => ({ ...x, truth: x.label === 'handwritten' ? 'handwritten' : 'printed', ...knn(tr, emb.get(x.page_id)) }));
  const acc = (a) => ({ n: a.length, acc: a.length ? +(a.filter((r) => r.answer === r.truth).length / a.length).toFixed(3) : null });
  const confident = res.filter((r) => r.vote >= VOTE_FLOOR);
  const report = {
    k: K, vote_floor: VOTE_FLOOR, n_train: tr.length, n_test: res.length, label_rule: 'page tag handwritten → handwritten; printed and mixed → printed',
    overall: acc(res), confident: { ...acc(confident), coverage: +(confident.length / res.length).toFixed(3) },
    by_truth: Object.fromEntries(['printed', 'handwritten'].map((c) => [c, { recall: acc(res.filter((r) => r.truth === c)), precision: acc(res.filter((r) => r.answer === c)) }])),
    by_tag: Object.fromEntries(['printed', 'handwritten', 'mixed'].map((c) => [c, acc(res.filter((r) => r.label === c))])),
    by_family: Object.fromEntries([...new Set(res.map((r) => r.family))].sort().map((f) => [f, { all: acc(res.filter((r) => r.family === f)), confident: acc(confident.filter((r) => r.family === f)) }])),
    family_vote: { ...(() => { const a = res; return { n: a.length, acc: +(a.filter((r) => r.family === r.family).length / a.length).toFixed(3) }; })() },
  };
  // family: the knn's family answer vs the OCR-text family
  const fres = te.map((x) => ({ truth: x.family, ...knn(tr, emb.get(x.page_id)) }));
  report.family_vote = { n: fres.length, acc: +(fres.filter((r) => r.family === r.truth).length / fres.length).toFixed(3), by: Object.fromEntries([...new Set(fres.map((r) => r.truth))].sort().map((f) => [f, { n: fres.filter((r) => r.truth === f).length, recall: +(fres.filter((r) => r.truth === f && r.family === f).length / Math.max(1, fres.filter((r) => r.truth === f).length)).toFixed(3) }])) };
  fs.writeFileSync(path.join(OUT_DIR, 'clip-heldout.summary.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

/** Per unlabelled book: classify its target pages, vote, flag low confidence. */
function apply() {
  const emb = loadEmbeddings();
  const tr = trainSet(emb, { excludeHeldOut: false });
  const target = JSON.parse(fs.readFileSync(TARGET_FILE, 'utf8'));
  const byBook = new Map();
  for (const t of target) { if (!emb.has(t.page_id)) continue; if (!byBook.has(t.book_id)) byBook.set(t.book_id, []); byBook.get(t.book_id).push(t); }
  const out = fs.createWriteStream(CLIP_FILE);
  const tally = {};
  let n = 0;
  for (const [book_id, ts] of byBook) {
    const pages = ts.map((t) => { const r = knn(tr, emb.get(t.page_id)); return { page_id: t.page_id, answer: r.answer, vote: +r.vote.toFixed(2), family: r.family, fvote: +r.fvote.toFixed(2) }; });
    const conf = pages.filter((p) => p.vote >= VOTE_FLOOR);
    const hw = conf.filter((p) => p.answer === 'handwritten').length, pr = conf.length - hw;
    const cls = hw && pr ? 'mixed' : hw ? 'handwritten' : pr ? 'printed' : null;
    // Confident only when at least two pages are confident, they agree, and no page contradicts them.
    const low = !(cls && cls !== 'mixed' && conf.length >= 2 && pages.every((p) => p.answer === pages[0].answer));
    const fv = {}; for (const p of pages) fv[p.family] = (fv[p.family] || 0) + 1;
    const row = { book_id, class: cls, low_confidence: low, family: Object.entries(fv).sort((a, b) => b[1] - a[1])[0][0], pages };
    out.write(JSON.stringify(row) + '\n');
    const k = `${cls}${low ? ' (low)' : ''}`; tally[k] = (tally[k] || 0) + 1;
    if (++n % 5000 === 0) console.log(n, tally);
  }
  out.end();
  console.log(`classified ${n} books`, tally);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (flag('evaluate')) evaluate();
  if (flag('apply')) apply();
  if (flag('labels')) await labels();
  if (flag('plan')) plan();
  if (flag('embed')) await embed();
}
