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
 * Stages, in order (each writes a cache under scripts/eval/output/book-class-5768/, resumable):
 *   --labels      $0. Per book: 8 spread pages → OCR `<script>` tag + `pages.script_type`, letter
 *                 counts by Unicode block of the OCR text (script family), metadata signals, the
 *                 #5643 census answer, and the page thumbnails the classifier uses.
 *   --plan        training pages (tagged, stratified family × tag) and 3 target pages per unlabelled book.
 *   --embed --set=train|target [--shard=i/n]   CLIP vectors in-process; run under `nice -n 19`.
 *   --evaluate    held-out (by book) accuracy of the kNN classifier → clip-heldout.summary.json.
 *   --classify    kNN vote per unlabelled book → clip-classes.jsonl.
 *   --siku        四庫全書 hand copies (OCR header, CADAL series) → siku.json.
 *   --submit [--limit=N --only=free|cjk] / --collect   the paid contact-sheet fallback (Batch).
 *   --decide      one class per book with its evidence → classes.jsonl.
 *   --write [--apply]   books.book_class + one sweep_log row per book. Dry run without --apply.
 *   --byeye-sheets=<json> [--out=dir]   9-page viewing sheets for a by-eye check.
 *
 *   node --env-file=.env.production.local scripts/eval/book-class-5768.mjs --labels
 * Write-up: scripts/eval/experiments/2026-10-04-book-class-5768.md
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';
import { extractScriptType } from '../lib/ocr-result-parse.mjs';
import { routeBook, editionYear } from '../lib/syriac-kraken-lane.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { sheetFor } from './lib/contact-sheet.mjs';
import { priceFor, BATCH_MULTIPLIER } from '../lib/model-pricing.mjs';
import { createThenDeleteInput } from '../lib/gemini-batch-input-file.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

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
  // Turfan fragments (Manichaean, Sogdian, Old Uyghur scripts): no family of their own in the list, and
  // their OCR is a Latin transliteration, so the language must not fall through to the OCR's letters.
  sogdian: 'other', parthian: 'other', 'middle persian': 'other', 'old turkic': 'other', 'old uyghur': 'other', bactrian: 'other', tocharian: 'other',
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
/**
 * How much the free labels can be trusted. `strong`: ≥ 3 tagged pages and one answer on ≥ 75% of
 * them. Anything less is a claim to check — on the 24-book by-eye dev set (2026-10-04) single-page
 * tags and census-only answers were wrong on 6 of 13, and "mixed" from ≤ 2 pages on 3 of 4.
 */
export function tierOf(r) {
  const c = r.tag_counts || {};
  const n = (c.printed || 0) + (c.handwritten || 0) + (c.mixed || 0);
  if (n >= 3) return Math.max(c.printed || 0, c.handwritten || 0, c.mixed || 0) / n >= 0.75 ? 'strong' : 'split';
  return n ? 'weak' : r.census?.script ? 'census' : 'none';
}
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
function classify() {
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

// ── 四庫全書 hand copies (#5768) ──────────────────────────────────────────────────────────────
// The CADAL volumes of the Siku Quanshu are the Wenyuange HAND COPY (or a photo-reprint of it):
// regular kaishu that the OCR tag and the descriptor both often call "printed" (by-eye dev set,
// 2026-10-04: 3 of 3 such volumes claimed printed were hand-copied). The collection was never
// typeset or cut in blocks, so its own header — 欽定四庫全書 on a sampled page's OCR — decides.
export const SIKU_FILE = path.join(OUT_DIR, 'siku.json');
export const SIKU_SERIES = /·卷.*\(vol \d+\)\s*$/;
async function siku() {
  // Every page of every CJK book, not the 8 sampled: the header sits on the first leaf of each juan,
  // so the sample missed it on 51 of 60 volumes whose OCR does carry it (2026-10-04).
  const rows = readJsonl(LABELS_FILE).filter((r) => (r.family_ocr?.family || r.family_lang) === 'cjk' || SIKU_SERIES.test(r.title || ''));
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db('bookstore');
  const hits = {};
  for (let i = 0; i < rows.length; i += 20) {
    const ids = rows.slice(i, i + 20).map((r) => r.book_id);
    const ps = await db.collection('pages').aggregate([
      { $match: { book_id: { $in: ids }, 'ocr.data': /四庫全書/ } },
      { $sort: { page_number: 1 } },
      { $project: { _id: 0, id: 1, book_id: 1, head: { $substrCP: ['$ocr.data', 0, 800] } } },
    ]).toArray();
    // Outside the series a MENTION is not enough (海國圖志, 1840s, cites the collection in its text):
    // the page's own running head must be 欽定四庫全書.
    const series = new Set(rows.slice(i, i + 20).filter((r) => SIKU_SERIES.test(r.title || '')).map((r) => r.book_id));
    for (const p of ps) {
      if (!series.has(p.book_id) && !/<(header|meta)>[^<]*欽定四庫全書/.test(p.head || '')) continue;
      (hits[p.book_id] ||= { rule: 'header', pages: [] }).pages.length < 5 && hits[p.book_id].pages.push(p.id);
    }
    if (i % 2000 === 0) console.log(`${i}/${rows.length} with header so far ${Object.keys(hits).length}`);
  }
  // The same CADAL series without a header in its OCR (or with no OCR): a collection rule, labelled as
  // one. Of 60 random series volumes classed "printed", 51 carry the header and the 2 viewed without it
  // are the hand copy too (one is the 四庫全書薈要). Confined to CADAL-sponsored `.cn` Archive items.
  const series = rows.filter((r) => !hits[r.book_id] && SIKU_SERIES.test(r.title || '')).map((r) => r.book_id);
  for (let i = 0; i < series.length; i += 500) {
    const bs = await db.collection('books').find({ id: { $in: series.slice(i, i + 500) } }, { projection: { _id: 0, id: 1, ia_identifier: 1, 'image_source.sponsor': 1 } }).toArray();
    for (const b of bs) if (/\.cn$/.test(b.ia_identifier || '') && /CADAL/.test(b.image_source?.sponsor || '')) hits[b.id] = { rule: 'series', pages: [] };
  }
  await client.close();
  fs.writeFileSync(SIKU_FILE, JSON.stringify(hits));
  const by = {}; for (const h of Object.values(hits)) by[h.rule] = (by[h.rule] || 0) + 1;
  console.log(`books checked ${rows.length}; 四庫全書:`, by);
}

// ── paid fallback: one contact sheet per uncertain book, Batch flash-lite (#5768 step 3) ─────────
// 16 pages spread across the book, 384 px cells (the #5009 grid builder), one enum answer per
// sheet, thinking off. Metered per job as `gemini_usage` rows under ENDPOINT, and stopped by a
// hard cap read from this run's own ledger before every submit. NOT a processing_control envelope:
// an `allow_scopes` entry's book_ids is also the selective-unpause allowlist (getScopeConfig
// ignores `lanes`), so listing these books there would let a paused pipeline OCR them.
const PAID_MODEL = 'gemini-3.1-flash-lite';
const ENDPOINT = 'eval/book-class-5768';
const PAID_FILE = path.join(OUT_DIR, 'paid.jsonl');
const LEDGER = path.join(OUT_DIR, 'paid-jobs.json'); // resumable ledger, not tracked
const PER_SHEET = 16, CELL_PX = 384;
export const FAMILIES = ['latin', 'greek', 'cyrillic', 'coptic', 'armenian', 'georgian', 'hebrew', 'arabic', 'syriac', 'ethiopic', 'indic', 'tibetan', 'mongolian', 'cjk', 'southeast-asian', 'cuneiform', 'egyptian', 'other'];
// v2 (after the by-eye dev set): a facsimile of handwriting is handwritten (the class is about the
// writing a reader and an OCR engine meet, not the printing of the reproduction), and a printed book
// annotated by hand on most pages is mixed, while occasional notes or one handwritten flyleaf are not.
const PAID_PROMPT_VERSION = 'book-class-5768-v2';
const PAID_PROMPT = `This is a contact sheet: ${PER_SHEET} pages spread across ONE book, numbered left-to-right, top-to-bottom.

Answer two questions about the BOOK as a whole.

1. "class": how was the writing on these pages produced?
   - "printed": set in type, cut in woodblocks, or engraved. Occasional handwritten notes, a signature, or one handwritten flyleaf do not change this.
   - "handwritten": written by hand — a manuscript, codex, scroll, letter, notebook or hand-copied book, INCLUDING a photographic or lithographic facsimile of handwriting.
   - "mixed": substantial printed AND substantial handwritten text — e.g. printed pages annotated by hand on most pages, printed and manuscript leaves bound together, or printed forms filled in by hand throughout.
2. "script_family": the writing system of the main text.

Ignore blank pages, bindings, colour charts and library stamps.`;
const PAID_SCHEMA = { type: 'OBJECT', properties: { class: { type: 'STRING', enum: CLASSES_ALL() }, script_family: { type: 'STRING', enum: FAMILIES } }, required: ['class', 'script_family'] };
function CLASSES_ALL() { return ['printed', 'handwritten', 'mixed']; }
const API = 'https://generativelanguage.googleapis.com';
const isR2 = (u) => typeof u === 'string' && u.startsWith('https://images.sourcelibrary.org/');
const sheetUrl = (p) => [p.display_photo, p.cropped_photo].find(isR2) || getPageSource(p) || p.thumbnail_blob || p.image_thumb || null;

function ledger() { return fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { cap_usd: 10, jobs: [] }; }
const spentOf = (L) => L.jobs.reduce((s, j) => s + (j.cost_usd ?? j.estimate_usd ?? 0), 0);

// Hosts that ration us per day. BSB's IIIF answers `x-ratelimit-limit: 25001` per client per day and
// the box's archivers draw on the same budget: the CLIP pass of 2026-10-04 got 9,577 429s and left it
// at 49 requests. A book whose images exist ONLY there is deferred until it is archived to R2, never
// fetched again by this script. Vatican's digi.vatlib.it answered 403.
const RATE_LIMITED_HOSTS = /(^|\.)(digitale-sammlungen\.de|vatlib\.it)$/;
export function rateLimitedOnly(r) {
  const hosts = r.pages.map((p) => { try { return new URL(p.thumb).host; } catch { return null; } }).filter(Boolean);
  return hosts.length > 0 && hosts.filter((h) => RATE_LIMITED_HOSTS.test(h)).length > hosts.length / 2;
}

/** Books that go to the paid step: CLIP low-confidence, CJK (CLIP is near chance there), and books CLIP could not see. */
export function paidCandidates() {
  const labels = readJsonl(LABELS_FILE);
  const clip = new Map(readJsonl(CLIP_FILE).map((r) => [r.book_id, r]));
  const sikuHits = fs.existsSync(SIKU_FILE) ? JSON.parse(fs.readFileSync(SIKU_FILE, 'utf8')) : {};
  const done = new Set(readJsonl(PAID_FILE).filter((r) => r.class).map((r) => r.book_id));
  const L0 = ledger();
  for (const j of L0.jobs) if (!j.collected_at) for (const id of j.book_ids || []) done.add(id);
  for (const u of L0.unfetchable || []) done.add(u.book_id);
  const out = [];
  for (const r of labels) {
    if (done.has(r.book_id) || sikuHits[r.book_id] || tierOf(r) === 'strong') continue;
    if (rateLimitedOnly(r)) continue; // deferred, see RATE_LIMITED_HOSTS
    const tier = tierOf(r);
    const fam = r.family_ocr?.family || r.family_lang || null;
    if (tier !== 'none') { out.push({ book_id: r.book_id, pages_count: r.pages_count, family: fam, why: `free label ${tier}` }); continue; }
    const c = clip.get(r.book_id);
    const cjk = (fam || c?.family) === 'cjk';
    if (!c || c.low_confidence || cjk) out.push({ book_id: r.book_id, pages_count: r.pages_count, family: fam, why: cjk ? 'cjk' : !c ? 'no clip vector' : 'clip low confidence' });
  }
  return out;
}

async function submitPaid() {
  const L = ledger();
  const limit = Number(opt('limit', 50));
  const cands = paidCandidates();
  // --only=cjk: CJK books always go to the paid step (CLIP is near chance there), so they can be
  // priced before the CLIP pass has finished deciding which other books are uncertain.
  // --only=free: books whose free labels are too thin to trust; they need no CLIP answer first.
  const only = opt('only');
  const pool = only === 'cjk' ? cands.filter((c) => c.why === 'cjk' || (c.why === 'no clip vector' && c.family === 'cjk'))
    : only === 'free' ? cands.filter((c) => c.why.startsWith('free label') || c.why === 'cjk') : cands;
  const pick = pool.slice(0, limit);
  console.log(`paid candidates ${cands.length}; this job ${pick.length}; spent so far $${spentOf(L).toFixed(4)} of $${L.cap_usd}`);
  if (!pick.length) return;
  // Projection from what the collected jobs actually cost per sheet; a first job is capped at 50.
  const collected = L.jobs.filter((j) => j.cost_usd != null && j.responses);
  const perSheet = collected.length ? collected.reduce((s, j) => s + j.cost_usd, 0) / collected.reduce((s, j) => s + j.responses, 0) : null;
  if (perSheet == null && pick.length > 50) throw new Error('price the first 50 before sending more (--limit=50)');
  const est = perSheet == null ? 0.002 * pick.length : perSheet * pick.length * 1.2;
  if (spentOf(L) + est > L.cap_usd) { console.error(`REFUSING: spent $${spentOf(L).toFixed(4)} + this job ~$${est.toFixed(4)} > cap $${L.cap_usd}`); process.exit(2); }
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db('bookstore');
  const proj = { _id: 0, id: 1, book_id: 1, page_number: 1, display_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, thumbnail_blob: 1, image_thumb: 1 };
  const chunkFile = path.join(OUT_DIR, `paid-input-${Date.now()}.jsonl`);
  const w = fs.createWriteStream(chunkFile);
  const sheetPages = {};
  const unfetchable = [];
  let built = 0;
  const CONC = Number(opt('concurrency', 6)); let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < pick.length) {
      const b = pick[i++];
      const want = spreadPages(b.pages_count, PER_SHEET);
      const ps = (await db.collection('pages').find({ book_id: b.book_id, page_number: { $in: want } }, { projection: proj }).toArray()).sort((x, y) => x.page_number - y.page_number);
      if (!ps.length) continue;
      const jpeg = await sheetFor(ps, { perSheet: PER_SHEET, cellPx: CELL_PX, urlOf: sheetUrl });
      // A mostly-white sheet would still get a confident answer. Refuse it; the book stays unclassified.
      if (jpeg.failedTiles > ps.length / 2) { unfetchable.push({ book_id: b.book_id, failed: jpeg.failedTiles, of: ps.length }); continue; }
      sheetPages[b.book_id] = ps.map((p) => p.id);
      w.write(JSON.stringify({ key: b.book_id, request: { contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: jpeg.toString('base64') } }, { text: PAID_PROMPT }] }], generationConfig: { maxOutputTokens: 100, responseMimeType: 'application/json', responseSchema: PAID_SCHEMA, thinkingConfig: { thinkingBudget: 0 } } } }) + '\n');
      if (++built % 100 === 0) console.log(`sheets ${built}/${pick.length}`);
    }
  }));
  await new Promise((r) => w.end(r));
  await client.close();
  if (!built) { // every picked book was unfetchable: record them, send nothing
    fs.unlinkSync(chunkFile);
    L.unfetchable = [...(L.unfetchable || []), ...unfetchable];
    fs.writeFileSync(LEDGER, JSON.stringify(L));
    console.log(`no sheet built; ${unfetchable.length} unfetchable recorded`);
    return;
  }
  const key = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
  const keyEnv = process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY';
  const bytes = fs.statSync(chunkFile).size;
  const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'text/plain' }, body: JSON.stringify({ file: { displayName: 'book-class-5768' } }) });
  if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
  const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: fs.readFileSync(chunkFile) });
  if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
  const fileName = (await up.json()).file?.name;
  const job = await createThenDeleteInput({ fileName, apiKey: key, create: async () => {
    const r = await fetch(`${API}/v1beta/models/${PAID_MODEL}:batchGenerateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch: { display_name: 'book-class-5768', input_config: { file_name: fileName } } }) });
    if (!r.ok) throw new Error(`batch create ${r.status} ${(await r.text()).slice(0, 500)}`);
    return r.json();
  } });
  fs.unlinkSync(chunkFile);
  L.unfetchable = [...(L.unfetchable || []), ...unfetchable];
  L.jobs.push({ job_name: job.name, key_env: keyEnv, model: PAID_MODEL, prompt_version: PAID_PROMPT_VERSION, requests: built, bytes, estimate_usd: +est.toFixed(4), submitted_at: new Date().toISOString(), book_ids: Object.keys(sheetPages), sheet_pages: sheetPages });
  fs.writeFileSync(LEDGER, JSON.stringify(L));
  console.log(`submitted ${job.name}: ${built} sheets, ${(bytes / 1e6).toFixed(0)} MB, estimate $${est.toFixed(4)}`);
}

async function collectPaid() {
  const L = ledger();
  const p = priceFor(PAID_MODEL);
  const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
  for (const j of L.jobs) {
    if (j.collected_at) continue;
    const key = process.env[j.key_env];
    const data = await (await fetch(`${API}/v1beta/${j.job_name}?key=${key}`)).json();
    const state = data.metadata?.state || data.state;
    const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
    console.log(`${j.job_name} ${state}`);
    if (/FAILED|CANCELLED|EXPIRED/.test(state || '')) { j.collected_at = new Date().toISOString(); j.failed = state; j.cost_usd = 0; continue; }
    if (!rf) continue;
    const text = await (await fetch(`${API}/download/v1beta/${rf}:download?alt=media&key=${key}`)).text();
    let inTok = 0, outTok = 0, n = 0, errors = 0;
    for (const line of text.split('\n').filter(Boolean)) {
      const r = JSON.parse(line); const book_id = r.key || r.metadata?.key;
      const resp = r.response, u = resp?.usageMetadata || {};
      const row = { book_id, job: j.job_name, model: j.model, pages: j.sheet_pages?.[book_id] || [] };
      try { Object.assign(row, JSON.parse((resp.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(''))); } catch { row.error = JSON.stringify(r.error || resp?.candidates?.[0]?.finishReason || 'unparsable').slice(0, 200); errors++; }
      inTok += u.promptTokenCount || 0; outTok += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
      fs.appendFileSync(PAID_FILE, JSON.stringify(row) + '\n'); n++;
    }
    j.collected_at = new Date().toISOString(); j.responses = n; j.errors = errors; j.in_tokens = inTok; j.out_tokens = outTok;
    j.cost_usd = +(BATCH_MULTIPLIER * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output)).toFixed(5);
    try { await logUsage({ type: 'eval', mode: 'batch', model: j.model, page_count: n - errors, input_tokens: inTok, output_tokens: outTok, cost_usd: j.cost_usd, batch_job_id: j.job_name, endpoint: ENDPOINT, triggered_by: 'manual', prompt_version: j.prompt_version || 'book-class-5768-v1' }); } catch (e) { console.warn(`logUsage failed: ${e.message}`); }
    console.log(`collected ${n} (${errors} errors): ${inTok} in / ${outTok} out tokens, $${j.cost_usd} ($${(j.cost_usd / Math.max(1, n)).toFixed(6)}/sheet)`);
  }
  fs.writeFileSync(LEDGER, JSON.stringify(L));
  console.log(`spent $${spentOf(L).toFixed(4)} of $${L.cap_usd}; pending ${L.jobs.filter((j) => !j.collected_at).length}`);
}

// ── decide: one class per book, with its evidence (#5768) ─────────────────────────────────────
// Precedence, strongest evidence first:
//   1. 欽定四庫全書 on a sampled page's OCR → handwritten (see siku()).
//   2. Strong OCR tags (tierOf === 'strong').
//   3. The paid contact sheet (every book whose free labels are thinner, and every unlabelled book
//      CLIP was unsure of or could not see, or that is CJK).
//   4. A confident CLIP vote (unlabelled books only).
// A book none of these decide gets no class: absent, not guessed.
// Script family: the OCR text's own letters where it has ≥ 80, else the sheet's answer, else the
// edition language, else CLIP (62% recall on Greek — last for that reason).
export const CLASSES_FILE = path.join(OUT_DIR, 'classes.jsonl');
export const CLASS_VERSION = 'book-class-5768-v1';
function decide() {
  const labels = readJsonl(LABELS_FILE);
  const clip = new Map(readJsonl(CLIP_FILE).map((r) => [r.book_id, r]));
  const paid = new Map(readJsonl(PAID_FILE).filter((r) => r.class).map((r) => [r.book_id, r]));
  const sikuHits = fs.existsSync(SIKU_FILE) ? JSON.parse(fs.readFileSync(SIKU_FILE, 'utf8')) : {};
  const out = fs.createWriteStream(CLASSES_FILE);
  const T = {}; const inc = (k) => (T[k] = (T[k] || 0) + 1);
  for (const r of labels) {
    const tier = tierOf(r);
    const tagged = r.pages.filter((p) => p.tag || p.script_type).map((p) => ({ page_id: p.page_id, answer: p.tag || p.script_type }));
    const ocrModels = [...new Set(r.pages.filter((p) => p.tag || p.script_type).map((p) => p.ocr_model).filter(Boolean))];
    const c = clip.get(r.book_id), s = paid.get(r.book_id);
    let cls = null, source = null, pages = [], model = null;
    const sk = sikuHits[r.book_id];
    if (sk) { cls = 'handwritten'; source = sk.rule === 'header' ? 'siku-header' : 'siku-series'; pages = sk.pages.map((id) => ({ page_id: id, answer: 'handwritten (欽定四庫全書 header in OCR)' })); }
    else if (tier === 'strong') { cls = r.tag_class; source = 'ocr-script-tags'; pages = tagged; model = ocrModels.join(',') || null; }
    else if (s) { cls = s.class; source = 'contact-sheet'; pages = s.pages.map((id) => ({ page_id: id, answer: `${s.class} (sheet of ${s.pages.length})` })); model = s.model; }
    else if (c && !c.low_confidence) { cls = c.class; source = 'clip-knn'; pages = c.pages.map((p) => ({ page_id: p.page_id, answer: p.answer, vote: p.vote })); model = `clip-vit-base-patch32 knn-${K}`; }
    let family = null, familySource = null;
    // The OCR's letters, unless they are Latin while the edition language is written in another
    // script: then the transcription is a transliteration (Turfan "M" fragments, ETCSL Sumerian).
    const langFam = languageFamily(String(r.language || '').split(/[;,]/)[0]);
    const translit = r.family_ocr?.family === 'latin' && langFam && langFam !== 'latin';
    if (r.family_ocr && r.family_ocr.letters >= 80 && !translit) { family = r.family_ocr.family; familySource = 'ocr-text-letters'; }
    else if (translit) { family = langFam; familySource = 'books.language (OCR is a transliteration)'; }
    else if (s?.script_family) { family = s.script_family; familySource = 'contact-sheet'; }
    else if (r.family_lang) { family = r.family_lang; familySource = 'books.language'; }
    else if (c?.family) { family = c.family; familySource = 'clip-knn'; }
    inc(`class ${cls}`); inc(`source ${source}`); inc(`family ${family}`);
    // disagreement bookkeeping, for the report
    const free = r.tag_class || r.census?.script || null;
    if (s && free) inc(`sheet-vs-free ${tier}: ${free === s.class ? 'agree' : `free=${free} sheet=${s.class}`}`);
    if (s && c && !c.low_confidence) inc(`sheet-vs-clip: ${c.class === s.class ? 'agree' : `clip=${c.class} sheet=${s.class}`}`);
    // routeBook's provider list is for SYRIAC holdings; for Gallica it is wrong in general (628 of 748
    // tagged Gallica books are printed), so it is not kept as evidence of a manuscript.
    if (r.meta) { r.meta.why = r.meta.why.filter((w) => w !== 'provider gallica'); if (!r.meta.why.length) r.meta = null; }
    if (r.meta && cls) inc(`meta(handwritten) vs class: ${cls}`);
    out.write(JSON.stringify({
      book_id: r.book_id, language: r.language, visible: r.visible, hold: r.hold, title: r.title,
      book_class: cls ? { class: cls, script_family: family, evidence: { source, pages, family_source: familySource, ...(r.family_ocr?.secondary ? { secondary_family: r.family_ocr.secondary } : {}), ...(r.meta ? { metadata: r.meta.why } : {}) }, model, version: CLASS_VERSION } : null,
    }) + '\n');
  }
  out.end();
  for (const k of Object.keys(T).sort()) console.log(k, T[k]);
}

/** Write `books.book_class` + one sweep_log row per book. Dry-run unless --apply. Touches nothing else. */
async function write() {
  const rows = readJsonl(CLASSES_FILE).filter((r) => r.book_class);
  const apply = flag('apply');
  console.log(`${rows.length} books with a class; ${apply ? 'WRITING' : 'dry run (pass --apply)'}`);
  if (!apply) return;
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db('bookstore');
  const at = new Date();
  let matched = 0, modified = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await db.collection('books').bulkWrite(chunk.map((r) => ({ updateOne: { filter: { id: r.book_id }, update: { $set: { book_class: { ...r.book_class, at } } } } })), { ordered: false });
    matched += res.matchedCount; modified += res.modifiedCount;
    await recordSweepActions(db, chunk.map((r) => ({ sweep: CLASS_VERSION, book_id: r.book_id, action: 'set book_class', detail: { class: r.book_class.class, script_family: r.book_class.script_family, source: r.book_class.evidence.source } })));
    if (i % 10000 === 0) console.log(`${i + chunk.length}/${rows.length}`);
  }
  await client.close();
  console.log(`matched ${matched}, modified ${modified}`);
}

/** Viewing sheets (9 spread pages, 420 px) for a by-eye check: --byeye-sheets=<json of [{book_id, pages_count}]>. */
async function byeyeSheets() {
  const picks = JSON.parse(fs.readFileSync(opt('byeye-sheets'), 'utf8'));
  const dir = opt('out', '/tmp/byeye');
  fs.mkdirSync(dir, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db('bookstore');
  for (const b of picks) {
    const file = path.join(dir, `${b.book_id}.jpg`); if (fs.existsSync(file)) continue;
    const ps = (await db.collection('pages').find({ book_id: b.book_id, page_number: { $in: spreadPages(b.pages_count, 9) } }).toArray()).sort((x, y) => x.page_number - y.page_number);
    fs.writeFileSync(file, await sheetFor(ps, { perSheet: 9, cellPx: 420, urlOf: sheetUrl }));
  }
  await client.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (flag('evaluate')) evaluate();
  if (flag('classify')) classify();
  if (flag('siku')) await siku();
  if (flag('decide')) decide();
  if (flag('write')) await write();
  if (opt('byeye-sheets')) await byeyeSheets();
  if (flag('submit')) await submitPaid();
  if (flag('collect')) await collectPaid();
  if (flag('labels')) await labels();
  if (flag('plan')) plan();
  if (flag('embed')) await embed();
}
