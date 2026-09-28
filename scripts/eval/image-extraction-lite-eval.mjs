#!/usr/bin/env node
/**
 * #4747 — Image extraction on gemini-3.1-flash-lite (realtime + Batch API) vs
 * gemini-3-flash-preview, measured on 400 pages.
 *
 * PRIOR ART: scripts/experiments/image-extraction-resolution-test.mjs (deleted; its
 * result is memory/experiment-image-extraction-resolution.md) — 5 pages, 4 resolutions,
 * lite-preview; measured bbox drift vs resolution, not lite vs flash on a sample that
 * can carry a decision. scripts/eval/lib/ has no vision/bbox scorer (all text metrics).
 *
 * Reads only. Never writes to `pages`, `gallery_images`, or `books`.
 *
 * The prompt, generationConfig, response schema and page-grounding are lifted from
 * scripts/workers/image-extract-worker.mjs at runtime (the prompt is read out of the
 * worker's source text) so the experiment runs the production request, not a copy that
 * can drift.
 *
 * WIDENED 2026-09-28 (brief: ops handoffs/2026-09-28-image-extraction-bbox-eval-brief.md).
 * The question became "which cheap model draws ACCURATE boxes?", so agreement with stored
 * flash output is now the secondary number. The primary one is a by-eye grade of every box
 * against the page image (`grade-sheets` → hand-filled grades.json → `grade-score`).
 * Arms (--engine): flash, lite, lite35, lite-box2d (3.1-lite asked for Gemini's native
 * box_2d [ymin,xmin,ymax,xmax] 0–1000 instead of {x,y,width,height} fractions), qwen235
 * (Qwen3-VL via OpenRouter, native bbox_2d [x1,y1,x2,y2] 0–1000 — Qwen3-VL changed from
 * Qwen2.5's absolute pixels to relative 0–1000, per its 2d_grounding cookbook), and a free
 * layout detector (image-extraction-doclayout.py writes raw-doclayout-local.jsonl).
 * `--tag r2` names a re-run (flash test-retest). Every paid call writes a gemini_usage row
 * (type `eval`, endpoint this file). Boxes go through the PRODUCTION normaliser
 * (scripts/lib/bbox.mjs) — the 09-11 inline copy had the mixed-unit speck bug.
 *
 * Sub-commands (state lives under --out, default scripts/eval/results/image-extraction-lite-<date>/):
 *   sample                 draw 200 positive + 200 negative pages, one per book → sample.json
 *   run --engine flash|lite   realtime generateContent on every sampled page → raw-<engine>-realtime.jsonl
 *   batch-submit --engine lite   build JSONL, upload, create Batch API job → batch-<engine>.json
 *   batch-collect --engine lite  poll + download results → raw-<engine>-batch.jsonl
 *   score                  metrics for every raw-*.jsonl vs the stored flash reference → results.json
 *   sheets                 contact sheets (reference / flash / lite boxes) for the hand-read → sheets/
 *   grade-sheets           blinded per-page composites (one panel per arm, order shuffled) → grading/
 *   grade-score            box-accuracy table from grading/grades.json (the by-eye grades)
 *
 * Positives = pages extracted by the production flash worker in the last 90 d with ≥ 1
 * stored bbox (`detected_images[].model = gemini-3-flash-preview`). Negatives = pages the
 * same worker ran and returned no image on (real production candidates, i.e. page-typed
 * or OCR-marked-up pages — harder than pure text). The stored flash output is the
 * REFERENCE; flash is also re-run so its own test-retest agreement is the yardstick lite
 * is held to.
 */

import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { getPageSource } from '../lib/page-image-url.mjs';
import { buildPageGrounding } from '../lib/page-grounding.mjs';
import { normalizeBbox as productionNormalizeBbox } from '../lib/bbox.mjs';
import { logUsage } from '../workers/lib/supabase-usage-logger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, '../workers/image-extract-worker.mjs');

// ── args ──
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const DATE = opt('date', new Date().toISOString().slice(0, 10));
const OUT = opt('out', path.join(__dirname, 'results', `image-extraction-lite-${DATE}`));
const IMG_CACHE = opt('img-cache', path.join(process.env.CLAUDE_JOB_DIR || OUT, 'tmp', 'img-cache-4747'));
const ENGINE = opt('engine', 'lite');
const CONCURRENCY = parseInt(opt('concurrency', '6'), 10);
const N_POS = parseInt(opt('n-pos', '200'), 10);
const N_NEG = parseInt(opt('n-neg', '200'), 10);
const GROUNDING_RADIUS = 3;

const TAG = opt('tag', '');
// format = how the arm is asked for boxes. xywh: production {x,y,width,height} fractions;
// box2d: Gemini native [ymin,xmin,ymax,xmax] 0–1000; bbox2d: Qwen3-VL [x1,y1,x2,y2] 0–1000.
const ENGINES = {
  flash: { vendor: 'gemini', model: 'gemini-3-flash-preview', format: 'xywh' },
  lite: { vendor: 'gemini', model: 'gemini-3.1-flash-lite', format: 'xywh' },
  // 3.5-flash-lite 400s on thinkingBudget:0 (probed 2026-09-28); thinkingLevel 'minimal' is its lowest setting.
  lite35: { vendor: 'gemini', model: 'gemini-3.5-flash-lite', format: 'xywh', thinking: { thinkingLevel: 'minimal' } },
  'lite-box2d': { vendor: 'gemini', model: 'gemini-3.1-flash-lite', format: 'box2d' },
  qwen235: { vendor: 'openrouter', model: 'qwen/qwen3-vl-235b-a22b-instruct', format: 'bbox2d' },
};
const MODELS = Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.model]));
// $/M tokens, realtime. Batch = half. Gemini rows match scripts/lib/model-pricing.mjs; the
// Qwen row is OpenRouter's list price read from /api/v1/models on 2026-09-28.
const PRICE = {
  'gemini-3-flash-preview': { input: 0.5, output: 3.0 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'qwen/qwen3-vl-235b-a22b-instruct': { input: 0.21, output: 1.9 },
  'doclayout-yolo-docstructbench': { input: 0, output: 0 },
};
const USAGE_ENDPOINT = 'scripts/eval/image-extraction-lite-eval.mjs';
const usd = (model, inTok, outTok, batch = false) => ((batch ? 0.5 : 1) * (inTok * (PRICE[model]?.input ?? 0) + outTok * (PRICE[model]?.output ?? 0))) / 1e6;

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(IMG_CACHE, { recursive: true });

// ── lift the production prompt + schema out of the worker source ──
function loadWorkerArtifacts() {
  const src = fs.readFileSync(WORKER_PATH, 'utf8');
  const m = src.match(/const IMAGE_EXTRACTION_PROMPT = `([\s\S]*?)`;\n/);
  if (!m) throw new Error('could not find IMAGE_EXTRACTION_PROMPT in worker source');
  // The template literal in the worker contains one escaped backtick pair (\`extracted_images: []\`).
  const prompt = m[1].replace(/\\`/g, '`');
  const s = src.match(/const RESPONSE_SCHEMA = (\{[\s\S]*?\n\});\n/);
  if (!s) throw new Error('could not find RESPONSE_SCHEMA in worker source');
  // SchemaType.X → "x" (the SDK enum values are lowercase strings; REST accepts them).
  const schemaJs = s[1].replace(/SchemaType\.([A-Z]+)/g, (_, t) => JSON.stringify(t.toLowerCase()));
  const schema = new Function(`return (${schemaJs});`)();
  return { prompt, schema, promptSha: sha(prompt) };
}

/** The production request, re-expressed for an arm that is asked for a different box format. */
function artifactsFor(format) {
  const base = loadWorkerArtifacts();
  if (format === 'xywh') return base;
  const coordBlock = /BOUNDING BOX \(0\.0-1\.0 normalized coordinates\):\n- x: [^\n]*\n- width, height: [^\n]*\n/;
  const example = /"bbox": \{ "x": 0\.15, "y": 0\.25, "width": 0\.70, "height": 0\.45 \}/;
  if (!coordBlock.test(base.prompt) || !example.test(base.prompt)) throw new Error('worker prompt bbox block changed — update artifactsFor()');
  if (format === 'box2d') {
    const prompt = base.prompt
      .replace(coordBlock, 'BOUNDING BOX: box_2d = [ymin, xmin, ymax, xmax] normalized to 0-1000 (0,0 = top-left of the page image).\n')
      .replace(example, '"box_2d": [250, 150, 700, 850]')
      .replace(/\bbbox\b/g, 'box_2d');
    const schema = structuredClone(base.schema);
    const item = schema.properties.extracted_images.items;
    delete item.properties.bbox;
    item.properties.box_2d = { type: 'array', items: { type: 'integer' } };
    item.required = item.required.map((r) => (r === 'bbox' ? 'box_2d' : r));
    return { prompt, schema, promptSha: sha(prompt) };
  }
  if (format === 'bbox2d') {
    const prompt = base.prompt
      .replace(coordBlock, 'BOUNDING BOX: bbox_2d = [x1, y1, x2, y2] in relative coordinates 0-1000 (top-left and bottom-right corners of the illustration).\n')
      .replace(example, '"bbox_2d": [150, 250, 850, 700]')
      .replace(/\bbbox\b/g, 'bbox_2d')
      + '\n\nReturn ONLY a JSON object with keys "scan_quality" and "extracted_images" (no markdown fences).';
    return { prompt, schema: null, promptSha: sha(prompt) };
  }
  throw new Error(`unknown format ${format}`);
}
function sha(s) {
  return (globalThis.crypto?.subtle ? null : null), require_sha(s);
}
function require_sha(s) {
  const { createHash } = createHashLazy();
  return createHash('sha256').update(s).digest('hex').slice(0, 12);
}
let _crypto;
function createHashLazy() {
  if (!_crypto) _crypto = { createHash: (a) => { const c = cryptoMod(); return c.createHash(a); } };
  return _crypto;
}
let _cryptoMod;
function cryptoMod() {
  if (!_cryptoMod) _cryptoMod = globalThis.process.getBuiltinModule('node:crypto');
  return _cryptoMod;
}

function buildBookContextPrefix(book) {
  const contextParts = [];
  if (book.title) contextParts.push(`Book: "${book.title}"`);
  if (book.author) contextParts.push(`Author: ${book.author}`);
  if (book.year) contextParts.push(`Year: ${book.year}`);
  if (book.language) contextParts.push(`Language: ${book.language}`);
  if (book.subjects?.length) contextParts.push(`Subjects: ${book.subjects.join(', ')}`);
  return contextParts.length > 0 ? `BOOK CONTEXT:\n${contextParts.join(' | ')}\n\n` : '';
}

function buildRequestText(item, prompt) {
  const grounding = buildPageGrounding({
    ocr: item.page.ocr?.data,
    translation: item.page.translation?.data,
    pageNumber: item.page.page_number,
    neighbors: item.neighbors,
    bookSummary: item.book.summary || '',
    radius: GROUNDING_RADIUS,
  });
  return buildBookContextPrefix(item.book) + prompt + grounding;
}

const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY']
  .map((category) => ({ category, threshold: 'BLOCK_NONE' }));

function generationConfigFor(schema) {
  return {
    temperature: 0.1,
    maxOutputTokens: 4096,
    responseMimeType: 'application/json',
    responseSchema: schema,
    thinkingConfig: { thinkingBudget: 0 },
  };
}

// ── API keys (same policy as the worker: skip the free-tier KEY_4) ──
function apiKeys() {
  const keys = [
    process.env.GEMINI_API_KEY,
    ...Array.from({ length: 9 }, (_, i) => (i + 2 === 4 ? null : process.env[`GEMINI_API_KEY_${i + 2}`])),
    process.env.GEMINI_API_KEY_TIER3,
  ].filter(Boolean);
  if (!keys.length) throw new Error('no GEMINI_API_KEY* in env');
  return keys;
}

// ── image cache: every engine sees the same bytes ──
async function getImage(item) {
  const f = path.join(IMG_CACHE, `${item.page.id}.bin`);
  const mf = f + '.mime';
  if (fs.existsSync(f) && fs.existsSync(mf)) {
    return { buffer: fs.readFileSync(f), mimeType: fs.readFileSync(mf, 'utf8') };
  }
  const url = getPageSource(item.page);
  if (!url || !/^https?:\/\//.test(url)) return null;
  // A slow or dead image host is a recorded `no-image` for that page, never a crashed run.
  let res = null;
  for (const ms of [30000, 90000]) {
    try { res = await fetch(url, { signal: AbortSignal.timeout(ms) }); if (res.ok) break; } catch { res = null; }
  }
  if (!res?.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  fs.writeFileSync(f, buffer);
  fs.writeFileSync(mf, mimeType);
  return { buffer, mimeType };
}

// ── jsonl helpers ──
function readJsonl(f) {
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function appendJsonl(f, obj) {
  fs.appendFileSync(f, JSON.stringify(obj) + '\n');
}

async function mongo() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  return c;
}

// ═══════════════════════════════════════════════════════════════════════════
// sample
// ═══════════════════════════════════════════════════════════════════════════
async function cmdSample() {
  const client = await mongo();
  const db = client.db('bookstore');
  const pages = db.collection('pages');
  const since = new Date(Date.now() - 90 * 86400e3);
  const SCAN_CAP = parseInt(opt('scan-cap', '30000'), 10);
  const rnd = mulberry32(4747);

  console.log(`[sample] scanning up to ${SCAN_CAP} extracted pages per class since ${since.toISOString()}`);
  const t0 = Date.now();
  const posRaw = await pages.aggregate([
    { $match: { image_extraction_updated_at: { $gte: since }, 'detected_images.0': { $exists: true } } },
    { $limit: SCAN_CAP },
    { $project: { id: 1, book_id: 1, page_number: 1, page_type: 1, 'detected_images.model': 1, 'detected_images.bbox': 1, 'detected_images.detected_at': 1 } },
  ], { maxTimeMS: 600000 }).toArray();
  console.log(`[sample] positives scanned: ${posRaw.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  const negRaw = await pages.aggregate([
    { $match: { image_extraction_updated_at: { $gte: since }, 'detected_images.0': { $exists: false }, 'scan_quality.model': MODELS.flash } },
    { $limit: SCAN_CAP },
    { $project: { id: 1, book_id: 1, page_number: 1, page_type: 1 } },
  ], { maxTimeMS: 600000 }).toArray();
  console.log(`[sample] negatives scanned: ${negRaw.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  // Positive eligibility: page_number > 0 and every stored detection is a flash detection with a bbox.
  const posEligible = posRaw.filter((p) =>
    p.page_number > 0 &&
    Array.isArray(p.detected_images) &&
    p.detected_images.length > 0 &&
    p.detected_images.every((d) => d && d.model === MODELS.flash && d.bbox && d.detected_at && new Date(d.detected_at) >= since)
  );
  const negEligible = negRaw.filter((p) => p.page_number > 0);
  console.log(`[sample] eligible: pos ${posEligible.length}, neg ${negEligible.length}`);

  const onePerBook = (rows, n) => {
    const byBook = new Map();
    for (const r of rows) {
      if (!byBook.has(r.book_id)) byBook.set(r.book_id, []);
      byBook.get(r.book_id).push(r);
    }
    const books = shuffle([...byBook.keys()], rnd);
    return books.slice(0, n).map((b) => {
      const list = byBook.get(b);
      return list[Math.floor(rnd() * list.length)];
    });
  };
  // Exclude negative books that are also positive books, so the two classes never share a book.
  const posPick = onePerBook(posEligible, N_POS);
  const posBooks = new Set(posPick.map((p) => p.book_id));
  const negPick = onePerBook(negEligible.filter((p) => !posBooks.has(p.book_id)), N_NEG);
  console.log(`[sample] picked pos ${posPick.length} (from ${new Set(posEligible.map((p) => p.book_id)).size} books), neg ${negPick.length} (from ${new Set(negEligible.map((p) => p.book_id)).size} books)`);

  // Hydrate: the page (grounding + photo fields), neighbours ±3, the book.
  const PAGE_PROJ = { id: 1, book_id: 1, page_number: 1, page_type: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, crop: 1, split_from_spread: 1, 'ocr.data': 1, 'translation.data': 1, detected_images: 1, scan_quality: 1, image_extraction_updated_at: 1 };
  const bookIds = [...new Set([...posPick, ...negPick].map((p) => p.book_id))];
  const books = await db.collection('books').find({ id: { $in: bookIds } }, { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, subjects: 1, summary: 1, visible: 1 } }).toArray();
  const bookById = new Map(books.map((b) => [b.id, b]));

  const items = [];
  for (const [cls, picks] of [['pos', posPick], ['neg', negPick]]) {
    for (const pick of picks) {
      const page = await pages.findOne({ _id: pick._id }, { projection: PAGE_PROJ });
      const neighbors = await pages.find(
        { book_id: pick.book_id, page_number: { $gte: pick.page_number - GROUNDING_RADIUS, $lte: pick.page_number + GROUNDING_RADIUS, $ne: pick.page_number } },
        { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } },
      ).toArray();
      const book = bookById.get(pick.book_id) || { id: pick.book_id };
      const reference = cls === 'pos'
        ? (page.detected_images || []).filter((d) => d && d.bbox).map((d) => ({ bbox: d.bbox, type: d.type, gallery_quality: d.gallery_quality, description: d.description, detected_at: d.detected_at }))
        : [];
      items.push({
        cls,
        page: { ...page, _id: String(page._id), detected_images: undefined },
        neighbors: neighbors.map((n) => ({ page_number: n.page_number, ocr: n.ocr?.data, translation: n.translation?.data })),
        book: { id: book.id, title: book.title, author: book.author, year: book.year, language: book.language, subjects: book.subjects, summary: book.summary },
        reference,
        image_url: getPageSource(page),
      });
    }
  }
  await client.close();

  const sample = {
    issue: 4747,
    drawn_at: new Date().toISOString(),
    since: since.toISOString(),
    method: `one page per book; positives = every stored detection from ${MODELS.flash} with a bbox in the last 90 d; negatives = flash-extracted candidate pages with no detection; classes never share a book; first ${SCAN_CAP} index-order rows per class, book chosen by seeded RNG (4747)`,
    counts: { pos: posPick.length, neg: negPick.length, pos_eligible: posEligible.length, neg_eligible: negEligible.length },
    items,
  };
  fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify(sample));
  const noUrl = items.filter((i) => !i.image_url).length;
  console.log(`[sample] wrote ${items.length} items → ${path.join(OUT, 'sample.json')}; ${noUrl} without a resolvable image URL; reference boxes: ${items.reduce((s, i) => s + i.reference.length, 0)}`);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function loadSample() {
  const f = path.join(OUT, 'sample.json');
  if (!fs.existsSync(f)) throw new Error(`no sample at ${f} — run \`sample\` first`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// ═══════════════════════════════════════════════════════════════════════════
// run (realtime)
// ═══════════════════════════════════════════════════════════════════════════
async function callArm(eng, item, img, art) {
  const text = buildRequestText(item, art.prompt);
  if (eng.vendor === 'gemini') {
    const generationConfig = art.schema ? generationConfigFor(art.schema) : { temperature: 0.1, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } };
    if (eng.thinking) generationConfig.thinkingConfig = eng.thinking;
    const body = {
      contents: [{ parts: [{ text }, { inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } }] }],
      safetySettings: SAFETY,
      generationConfig,
    };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${eng.model}:generateContent?key=${nextKey()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) return { status: res.status, error: (await res.text()).slice(0, 300) };
    const data = await res.json();
    const usage = data.usageMetadata || {};
    return {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
      thoughts_tokens: usage.thoughtsTokenCount || 0,
      finish_reason: data.candidates?.[0]?.finishReason,
      text: (data.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join(''),
    };
  }
  if (eng.vendor === 'openrouter') {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY not set');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: eng.model,
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        usage: { include: true },
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.buffer.toString('base64')}` } },
          { type: 'text', text },
        ] }],
      }),
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) return { status: res.status, error: (await res.text()).slice(0, 300) };
    const data = await res.json();
    if (data.error) return { status: 500, error: JSON.stringify(data.error).slice(0, 300) };
    return {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
      thoughts_tokens: 0,
      vendor_cost_usd: typeof data.usage?.cost === 'number' ? data.usage.cost : undefined,
      provider: data.provider,
      finish_reason: data.choices?.[0]?.finish_reason,
      text: data.choices?.[0]?.message?.content || '',
    };
  }
  throw new Error(`unknown vendor ${eng.vendor}`);
}

let _ki = 0;
function nextKey() { const k = apiKeys(); return k[(_ki++) % k.length]; }

function rawName(engine, mode) { return `${engine}${TAG ? `-${TAG}` : ''}-${mode}`; }

async function cmdRun() {
  const eng = ENGINES[ENGINE];
  if (!eng) throw new Error(`--engine must be one of ${Object.keys(ENGINES).join('|')}`);
  const model = eng.model;
  const art = artifactsFor(eng.format);
  const sample = loadSample();
  const name = rawName(ENGINE, 'realtime');
  const outFile = path.join(OUT, `raw-${name}.jsonl`);
  const done = new Set(readJsonl(outFile).filter((r) => !r.error).map((r) => r.page_id));
  let todo = sample.items.filter((i) => i.image_url && !done.has(i.page.id));
  const only = opt('only-pages');
  if (only) { const s = new Set(fs.readFileSync(only, 'utf8').split('\n').filter(Boolean)); todo = todo.filter((i) => s.has(i.page.id)); }
  const limit = parseInt(opt('limit', '0'), 10);
  if (limit) todo = todo.slice(0, limit);
  const total = todo.length;
  console.log(`[run ${name}] model=${model} format=${eng.format} prompt_sha=${art.promptSha} todo=${total} (done ${done.size}) → ${outFile}`);
  let spent = 0, errors = 0, n = 0, inSum = 0, outSum = 0;
  const cap = parseFloat(opt('spend-cap', '3'));

  const worker = async () => {
    while (todo.length) {
      const item = todo.shift();
      const img = await getImage(item);
      if (!img) { appendJsonl(outFile, { page_id: item.page.id, cls: item.cls, error: 'no-image' }); continue; }
      let rec = { page_id: item.page.id, cls: item.cls, model, mode: 'realtime', format: eng.format, prompt_sha: art.promptSha, tag: TAG || undefined };
      for (let attempt = 0; attempt < 4; attempt++) {
        const t0 = Date.now();
        try {
          const r = await callArm(eng, item, img, art);
          if (r.error && (r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise((ok) => setTimeout(ok, 3000 * (attempt + 1))); continue; }
          if (r.error) { rec.error = `${r.status} ${r.error}`; break; }
          rec = { ...rec, ...r, ms: Date.now() - t0 };
          break;
        } catch (e) {
          if (attempt === 3) rec.error = String(e).slice(0, 200);
          else await new Promise((ok) => setTimeout(ok, 3000 * (attempt + 1)));
        }
      }
      if (rec.error) errors++;
      const cost = rec.error ? 0 : (rec.vendor_cost_usd ?? usd(model, rec.input_tokens, rec.output_tokens));
      rec.cost_usd = cost;
      spent += cost; inSum += rec.input_tokens || 0; outSum += rec.output_tokens || 0;
      appendJsonl(outFile, rec);
      logUsage({
        type: 'eval', mode: 'realtime', model, page_count: 1, page_ids: [item.page.id], book_id: item.book.id,
        input_tokens: rec.input_tokens || 0, output_tokens: rec.output_tokens || 0, cost_usd: cost,
        status: rec.error ? 'failed' : 'success', error_message: rec.error, duration_ms: rec.ms,
        endpoint: USAGE_ENDPOINT, triggered_by: 'manual', prompt_version: `eval-4747-${name}`,
      }).catch(() => {});
      n++;
      if (n % 25 === 0) console.log(`[run ${name}] ${n}/${total} done, errors ${errors}, $${spent.toFixed(3)}`);
      if (spent > cap) { console.error(`[run ${name}] spend cap $${cap} hit — stopping`); todo.length = 0; }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[run ${name}] finished: ${n} calls, ${errors} errors, in ${inSum} / out ${outSum} tokens, $${spent.toFixed(4)} ($${n ? (spent / n).toFixed(5) : '—'}/page)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// batch-submit / batch-collect
// ═══════════════════════════════════════════════════════════════════════════
async function cmdBatchSubmit() {
  const model = MODELS[ENGINE];
  const { prompt, schema, promptSha } = loadWorkerArtifacts();
  const sample = loadSample();
  const lines = [];
  let skipped = 0;
  for (const item of sample.items) {
    if (!item.image_url) { skipped++; continue; }
    const img = await getImage(item);
    if (!img) { skipped++; continue; }
    lines.push(JSON.stringify({
      key: item.page.id,
      request: {
        contents: [{ parts: [{ text: buildRequestText(item, prompt) }, { inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } }] }],
        safetySettings: SAFETY,
        generationConfig: generationConfigFor(schema),
      },
    }));
  }
  const jsonl = lines.join('\n') + '\n';
  const bytes = Buffer.byteLength(jsonl);
  console.log(`[batch ${ENGINE}] ${lines.length} requests, ${skipped} skipped, ${(bytes / 1e6).toFixed(1)} MB JSONL, prompt_sha=${promptSha}`);
  // Same key preference as the production batch lane (src/lib/gemini-batch.ts): TIER3 first.
  const batchKeyEnv = process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY';
  const key = process.env[batchKeyEnv];
  // resumable upload (text/plain: application/jsonl returns 200 with no `file` key — see src/lib/gemini-batch.ts)
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${key}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes),
      'X-Goog-Upload-Header-Content-Type': 'text/plain',
    },
    body: JSON.stringify({ file: { displayName: `image-extraction-lite-4747-${DATE}` } }),
  });
  if (!start.ok) throw new Error(`upload start failed: ${start.status} ${(await start.text()).slice(0, 300)}`);
  const uploadUrl = start.headers.get('X-Goog-Upload-URL');
  const up = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' },
    body: jsonl,
  });
  if (!up.ok) throw new Error(`upload failed: ${up.status} ${(await up.text()).slice(0, 300)}`);
  const fileInfo = await up.json();
  const fileName = fileInfo.file?.name;
  if (!fileName) throw new Error(`upload response missing file.name: ${JSON.stringify(fileInfo).slice(0, 300)}`);
  console.log(`[batch ${ENGINE}] uploaded ${fileName}`);
  const create = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:batchGenerateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch: { display_name: `image-extraction-lite-4747-${DATE}`, input_config: { file_name: fileName } } }),
  });
  if (!create.ok) throw new Error(`batch create failed: ${create.status} ${(await create.text()).slice(0, 500)}`);
  const job = await create.json();
  const rec = { model, job_name: job.name, state: job.metadata?.state || job.state, file_name: fileName, requests: lines.length, submitted_at: new Date().toISOString(), prompt_sha: promptSha, key_env: batchKeyEnv };
  fs.writeFileSync(path.join(OUT, `batch-${ENGINE}.json`), JSON.stringify(rec, null, 2));
  console.log(`[batch ${ENGINE}] created ${job.name} state=${rec.state}`);
}

async function cmdBatchCollect() {
  const model = MODELS[ENGINE];
  const f = path.join(OUT, `batch-${ENGINE}.json`);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  const key = process.env[rec.key_env || 'GEMINI_API_KEY'];
  const outFile = path.join(OUT, `raw-${ENGINE}-batch.jsonl`);
  const waitMax = parseInt(opt('wait-min', '0'), 10) * 60e3;
  const t0 = Date.now();
  for (;;) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${rec.job_name}?key=${key}`);
    if (!res.ok) throw new Error(`status failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const state = data.metadata?.state || (data.metadata?.output?.responsesFile ? 'BATCH_STATE_SUCCEEDED' : 'BATCH_STATE_PENDING');
    const stats = data.metadata?.batchStats || {};
    console.log(`[batch ${ENGINE}] ${state} ${JSON.stringify(stats)} (${((Date.now() - t0) / 60e3).toFixed(1)} min)`);
    if (state === 'BATCH_STATE_SUCCEEDED') {
      const responsesFile = data.metadata?.output?.responsesFile || data.response?.responsesFile;
      if (!responsesFile) throw new Error(`succeeded but no responsesFile: ${JSON.stringify(data).slice(0, 500)}`);
      const dl = await fetch(`https://generativelanguage.googleapis.com/download/v1beta/${responsesFile}:download?alt=media&key=${key}`);
      if (!dl.ok) throw new Error(`download failed: ${dl.status}`);
      const text = await dl.text();
      const sample = loadSample();
      const clsById = new Map(sample.items.map((i) => [i.page.id, i.cls]));
      fs.writeFileSync(outFile, '');
      let n = 0, errors = 0, batchIn = 0, batchOut = 0;
      for (const line of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(line);
        const pageId = r.key || r.metadata?.key;
        const resp = r.response;
        const usage = resp?.usageMetadata || {};
        const out = { page_id: pageId, cls: clsById.get(pageId), model, mode: 'batch', format: 'xywh', prompt_sha: rec.prompt_sha };
        if (r.error || !resp) { out.error = JSON.stringify(r.error || 'no-response').slice(0, 300); errors++; }
        else {
          out.input_tokens = usage.promptTokenCount || 0;
          out.output_tokens = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
          out.thoughts_tokens = usage.thoughtsTokenCount || 0;
          out.finish_reason = resp.candidates?.[0]?.finishReason;
          out.text = resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
          out.cost_usd = usd(model, out.input_tokens, out.output_tokens, true);
          batchIn += out.input_tokens; batchOut += out.output_tokens;
        }
        appendJsonl(outFile, out);
        n++;
      }
      rec.collected_at = new Date().toISOString(); rec.state = state; rec.responses = n; rec.errors = errors;
      fs.writeFileSync(f, JSON.stringify(rec, null, 2));
      await logUsage({
        type: 'eval', mode: 'batch', model, page_count: n - errors, input_tokens: batchIn, output_tokens: batchOut,
        batch_job_id: rec.job_name, endpoint: USAGE_ENDPOINT, triggered_by: 'manual', prompt_version: `eval-4747-${ENGINE}-batch`,
      }).catch((e) => console.warn('[batch] logUsage failed:', e.message));
      console.log(`[batch ${ENGINE}] $${usd(model, batchIn, batchOut, true).toFixed(4)} for ${n - errors} pages`);
      console.log(`[batch ${ENGINE}] collected ${n} responses (${errors} errors) → ${outFile}`);
      return;
    }
    if (state === 'BATCH_STATE_FAILED' || state === 'BATCH_STATE_CANCELLED' || state === 'BATCH_STATE_EXPIRED') {
      throw new Error(`batch ended ${state}: ${JSON.stringify(data.metadata).slice(0, 500)}`);
    }
    if (Date.now() - t0 > waitMax) { console.log(`[batch ${ENGINE}] still ${state}; re-run batch-collect later (or pass --wait-min N)`); return; }
    await new Promise((r) => setTimeout(r, 60e3));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// score
// ═══════════════════════════════════════════════════════════════════════════
/** Production normaliser for {x,y,width,height}; stored reference boxes pass through it too. */
function normalizeBbox(raw) {
  return productionNormalizeBbox(raw);
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function cornersToBox(x1, y1, x2, y2) {
  const [a, b] = [clamp01(Math.min(x1, x2)), clamp01(Math.max(x1, x2))];
  const [c, d] = [clamp01(Math.min(y1, y2)), clamp01(Math.max(y1, y2))];
  if (b - a < 0.005 || d - c < 0.005) return null;
  return { x: a, y: c, width: b - a, height: d - c };
}
/** One detection → {x,y,width,height} fractions, by the format the arm was asked for. */
function boxOf(d, format) {
  const arr = (v) => Array.isArray(v) && v.length === 4 && v.every((n) => Number.isFinite(Number(n))) ? v.map(Number) : null;
  if (format === 'box2d') {
    const v = arr(d.box_2d) || arr(d.bbox);
    return v ? cornersToBox(v[1] / 1000, v[0] / 1000, v[3] / 1000, v[2] / 1000) : null;
  }
  if (format === 'bbox2d') {
    const v = arr(d.bbox_2d) || arr(d.bbox);
    if (v) return cornersToBox(v[0] / 1000, v[1] / 1000, v[2] / 1000, v[3] / 1000);
    return d.bbox && typeof d.bbox === 'object' ? normalizeBbox(d.bbox) : null;
  }
  return d.bbox && typeof d.bbox === 'object' && !Array.isArray(d.bbox) ? normalizeBbox(d.bbox) : null;
}
/** A raw-*.jsonl record → detections. Local detectors store `images` already normalised. */
function parseRecord(r) {
  if (Array.isArray(r.images)) return { images: r.images.filter((d) => d.bbox) };
  return parseDetections(r.text, r.format || 'xywh');
}
function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
function parseDetections(text, format = 'xywh') {
  if (!text) return { images: [], parse_error: 'empty' };
  try {
    // Qwen sometimes fences the JSON or answers with a bare array; accept both (see the
    // contact-sheet-screen lesson: a discarded valid answer reads as a confident negative).
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const j = JSON.parse(cleaned);
    const list = Array.isArray(j) ? j : (j.extracted_images || []);
    const images = list.filter((d) => d && typeof d === 'object')
      .map((d) => ({ bbox: boxOf(d, format), type: d.type, gallery_quality: typeof d.gallery_quality === 'number' ? d.gallery_quality : undefined, description: d.description }))
      .filter((d) => d.bbox);
    return { images, scan_quality: Array.isArray(j) ? undefined : j.scan_quality };
  } catch (e) {
    return { images: [], parse_error: String(e).slice(0, 80) };
  }
}
/** Greedy one-to-one match by descending IoU. */
function matchBoxes(out, ref, thr) {
  const pairs = [];
  out.forEach((o, i) => ref.forEach((r, j) => { const v = iou(o.bbox, r.bbox); if (v >= thr) pairs.push({ i, j, v }); }));
  pairs.sort((a, b) => b.v - a.v);
  const usedO = new Set(), usedR = new Set(), matched = [];
  for (const p of pairs) {
    if (usedO.has(p.i) || usedR.has(p.j)) continue;
    usedO.add(p.i); usedR.add(p.j); matched.push(p);
  }
  return matched;
}
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (n, d) => (d ? n / d : null);

function scoreRun(records, sampleById, refSource) {
  // refSource: map page_id → { images: [...] } (stored flash or another run)
  const pos = [], neg = [];
  let callable = 0, errors = 0, parseErrors = 0, inTok = 0, outTok = 0, thoughts = 0, ms = [];
  const ious = [], typeAgree = [], gqAbs = [], galleryGateAgree = [];
  let refBoxes = 0, matchedRef = 0, outBoxes = 0, matchedOut = 0;
  let pagesWithRef = 0, pagesWithRefDetected = 0, negPages = 0, negPagesFired = 0, negBoxes = 0;
  const perPage = [];
  for (const r of records) {
    const item = sampleById.get(r.page_id);
    if (!item) continue;
    if (r.error) { errors++; continue; }
    callable++;
    inTok += r.input_tokens || 0; outTok += r.output_tokens || 0; thoughts += r.thoughts_tokens || 0; if (r.ms) ms.push(r.ms);
    const parsed = parseRecord(r);
    if (parsed.parse_error) parseErrors++;
    const out = parsed.images;
    const ref = refSource.get(r.page_id);
    if (!ref) continue;
    const refImgs = ref.images;
    const page = { page_id: r.page_id, cls: r.cls, out: out.length, ref: refImgs.length };
    if (refImgs.length > 0) {
      pagesWithRef++; refBoxes += refImgs.length; outBoxes += out.length;
      if (out.length > 0) pagesWithRefDetected++;
      const m = matchBoxes(out, refImgs, 0.5);
      matchedRef += m.length; matchedOut += m.length;
      page.matched = m.length;
      for (const p of m) {
        ious.push(p.v);
        const o = out[p.i], rr = refImgs[p.j];
        typeAgree.push(o.type === rr.type ? 1 : 0);
        if (typeof o.gallery_quality === 'number' && typeof rr.gallery_quality === 'number') {
          gqAbs.push(Math.abs(o.gallery_quality - rr.gallery_quality));
          galleryGateAgree.push((o.gallery_quality >= 0.5) === (rr.gallery_quality >= 0.5) ? 1 : 0);
        }
      }
      // Any page-level "would the gallery get at least one crop" agreement
      page.gallery_any_ref = refImgs.some((d) => (d.gallery_quality ?? 0) >= 0.5);
      page.gallery_any_out = out.some((d) => (d.gallery_quality ?? 0) >= 0.5);
      pos.push(page);
    } else {
      negPages++;
      if (out.length > 0) { negPagesFired++; negBoxes += out.length; }
      neg.push(page);
    }
    perPage.push(page);
  }
  const n = records.length;
  return {
    n_records: n, callable, errors, parse_errors: parseErrors,
    tokens: { input: inTok, output: outTok, thoughts, per_call_in: pct(inTok, callable), per_call_out: pct(outTok, callable) },
    latency_ms_median: median(ms),
    positives: {
      pages: pagesWithRef,
      page_recall: pct(pagesWithRefDetected, pagesWithRef),
      ref_boxes: refBoxes, out_boxes: outBoxes,
      box_recall_iou50: pct(matchedRef, refBoxes),
      box_precision_iou50: pct(matchedOut, outBoxes),
      iou: { n: ious.length, median: median(ious), mean: ious.length ? ious.reduce((a, b) => a + b, 0) / ious.length : null, share_ge_070: pct(ious.filter((v) => v >= 0.7).length, ious.length), share_ge_085: pct(ious.filter((v) => v >= 0.85).length, ious.length) },
      type_agreement: pct(typeAgree.reduce((a, b) => a + b, 0), typeAgree.length),
      gallery_quality_mean_abs_diff: gqAbs.length ? gqAbs.reduce((a, b) => a + b, 0) / gqAbs.length : null,
      gallery_gate_agreement: pct(galleryGateAgree.reduce((a, b) => a + b, 0), galleryGateAgree.length),
      page_gallery_any_agreement: pct(pos.filter((p) => p.gallery_any_ref === p.gallery_any_out).length, pos.length),
    },
    negatives: {
      pages: negPages,
      false_positive_page_rate: pct(negPagesFired, negPages),
      false_positive_boxes: negBoxes,
    },
    per_page: perPage,
  };
}

function cmdScore() {
  const sample = loadSample();
  const sampleById = new Map(sample.items.map((i) => [i.page.id, i]));
  const storedRef = new Map(sample.items.map((i) => [i.page.id, { images: i.reference.map((d) => ({ ...d, bbox: normalizeBbox(d.bbox) })).filter((d) => d.bbox) }]));
  const runs = fs.readdirSync(OUT).filter((f) => /^raw-.*\.jsonl$/.test(f));
  const results = { issue: 4747, scored_at: new Date().toISOString(), sample: { counts: sample.counts, method: sample.method, since: sample.since }, runs: {} };
  const runRecords = {};
  for (const f of runs) {
    const name = f.replace(/^raw-|\.jsonl$/g, '');
    runRecords[name] = readJsonl(path.join(OUT, f));
  }
  // vs stored flash reference
  for (const [name, records] of Object.entries(runRecords)) {
    const model = records.find((r) => r.model)?.model;
    const s = scoreRun(records, sampleById, storedRef);
    // Per-record cost when the run recorded one (OpenRouter returns the billed amount);
    // otherwise list price from tokens. Batch = half.
    const recorded = records.filter((r) => typeof r.cost_usd === 'number');
    s.cost_usd = recorded.length === records.length
      ? recorded.reduce((a, r) => a + r.cost_usd, 0)
      : usd(model, s.tokens.input, s.tokens.output, name.endsWith('batch'));
    s.cost_per_1k_pages = s.callable ? (s.cost_usd / s.callable) * 1000 : null;
    s.model = model;
    results.runs[name] = { vs: 'stored-flash-reference', ...s };
  }
  // lite runs vs the flash RE-RUN (same bytes, same day) — removes drift-over-time from the comparison
  const flashRerun = runRecords['flash-realtime'];
  if (flashRerun) {
    const rerunRef = new Map();
    for (const r of flashRerun) if (!r.error) rerunRef.set(r.page_id, parseRecord(r));
    for (const [name, records] of Object.entries(runRecords)) {
      if (name === 'flash-realtime') continue;
      const s = scoreRun(records, sampleById, rerunRef);
      delete s.per_page;
      results.runs[`${name}__vs_flash_rerun`] = { vs: 'flash-realtime-rerun', ...s };
    }
  }
  // SECONDARY since 2026-09-28: agreement with flash, not accuracy — the verdict comes from
  // grade-score. Original 09-11 decision rule (handoff): lite adopted iff recall ≥ flash − 3pp, FP ≤ flash + 2pp, median IoU ≥ 0.85 — all vs the stored reference,
  // "flash" = flash re-run (test-retest), which is the fair yardstick.
  const F = results.runs['flash-realtime'], L = results.runs['lite-realtime'], LB = results.runs['lite-batch'];
  const decide = (l, label) => {
    if (!l || !F) return null;
    const recallOk = l.positives.box_recall_iou50 >= F.positives.box_recall_iou50 - 0.03;
    const pageRecallOk = l.positives.page_recall >= F.positives.page_recall - 0.03;
    const fpOk = l.negatives.false_positive_page_rate <= F.negatives.false_positive_page_rate + 0.02;
    const iouOk = l.positives.iou.median >= 0.85;
    return { label, recall_ok: recallOk, page_recall_ok: pageRecallOk, fp_ok: fpOk, iou_ok: iouOk, adopt: recallOk && pageRecallOk && fpOk && iouOk };
  };
  results.decision = { lite_realtime: decide(L, 'lite-realtime'), lite_batch: decide(LB, 'lite-batch') };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));

  // table
  const f = (v, d = 3) => (v == null ? '—' : typeof v === 'number' ? (Math.abs(v) < 1 && d === 3 ? (v * 100).toFixed(1) + '%' : v.toFixed(d === 3 ? 0 : d)) : String(v));
  const rows = Object.entries(results.runs).filter(([k]) => !k.includes('__vs'));
  console.log('\n| run | model | calls | err | page recall | box recall | box precision | IoU median | IoU≥0.85 | type agree | gallery gate agree | FP page rate (neg) | $/1K pages |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, s] of rows) {
    console.log(`| ${k} | ${s.model} | ${s.callable} | ${s.errors} | ${f(s.positives.page_recall)} | ${f(s.positives.box_recall_iou50)} | ${f(s.positives.box_precision_iou50)} | ${s.positives.iou.median?.toFixed(3) ?? '—'} | ${f(s.positives.iou.share_ge_085)} | ${f(s.positives.type_agreement)} | ${f(s.positives.gallery_gate_agreement)} | ${f(s.negatives.false_positive_page_rate)} | $${s.cost_per_1k_pages?.toFixed(2) ?? '—'} |`);
  }
  const vs = Object.entries(results.runs).filter(([k]) => k.includes('__vs'));
  if (vs.length) {
    console.log('\nvs flash re-run (same bytes, same day):');
    console.log('| run | page recall | box recall | box precision | IoU median | IoU≥0.85 | gallery gate agree | FP page rate |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const [k, s] of vs) console.log(`| ${k.replace('__vs_flash_rerun', '')} | ${f(s.positives.page_recall)} | ${f(s.positives.box_recall_iou50)} | ${f(s.positives.box_precision_iou50)} | ${s.positives.iou.median?.toFixed(3) ?? '—'} | ${f(s.positives.iou.share_ge_085)} | ${f(s.positives.gallery_gate_agreement)} | ${f(s.negatives.false_positive_page_rate)} |`);
  }
  console.log('\ndecision:', JSON.stringify(results.decision));
  console.log(`→ ${path.join(OUT, 'results.json')}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// sheets — contact sheets for the hand-read (reference=green, flash=blue, lite=red)
// ═══════════════════════════════════════════════════════════════════════════
async function cmdSheets() {
  const sample = loadSample();
  const nPer = parseInt(opt('n', '20'), 10);
  const rnd = mulberry32(4748);
  const runs = {};
  for (const f of fs.readdirSync(OUT).filter((x) => /^raw-.*\.jsonl$/.test(x))) {
    const name = f.replace(/^raw-|\.jsonl$/g, '');
    runs[name] = new Map(readJsonl(path.join(OUT, f)).map((r) => [r.page_id, r]));
  }
  const dir = path.join(OUT, 'sheets');
  fs.mkdirSync(dir, { recursive: true });
  const colors = { reference: '#00c000', 'flash-realtime': '#0060ff', 'lite-realtime': '#ff2020', 'lite-batch': '#ff9900' };
  const pick = (cls) => shuffle(sample.items.filter((i) => i.cls === cls && i.image_url), rnd).slice(0, nPer);
  const chosen = [...pick('pos'), ...pick('neg')];
  const manifest = [];
  for (const item of chosen) {
    const img = await getImage(item);
    if (!img) continue;
    const meta = await sharp(img.buffer).metadata();
    const W = 900, scale = W / meta.width, H = Math.round(meta.height * scale);
    const boxes = [];
    const layers = { reference: item.reference.map((d) => ({ ...d, bbox: normalizeBbox(d.bbox) })).filter((d) => d.bbox) };
    for (const [name, m] of Object.entries(runs)) { const r = m.get(item.page.id); if (r && !r.error) layers[name] = parseRecord(r).images; }
    let k = 0;
    const svgParts = [];
    for (const [name, imgs] of Object.entries(layers)) {
      const col = colors[name] || '#ff00ff';
      const dash = name === 'reference' ? '' : name.startsWith('lite') ? 'stroke-dasharray="12,6"' : 'stroke-dasharray="4,4"';
      for (const d of imgs) {
        const b = d.bbox; const off = (k++ % 4) * 2;
        svgParts.push(`<rect x="${(b.x * W + off).toFixed(1)}" y="${(b.y * H + off).toFixed(1)}" width="${(b.width * W).toFixed(1)}" height="${(b.height * H).toFixed(1)}" fill="none" stroke="${col}" stroke-width="4" ${dash}/>`);
        svgParts.push(`<text x="${(b.x * W + 4 + off).toFixed(1)}" y="${(b.y * H + 18 + off).toFixed(1)}" font-size="16" fill="${col}" font-family="sans-serif">${name.replace('-realtime', '')} ${d.type || ''} gq=${d.gallery_quality ?? '?'}</text>`);
        boxes.push({ layer: name, type: d.type, gallery_quality: d.gallery_quality, bbox: b, description: d.description });
      }
    }
    const legend = `<rect x="0" y="0" width="${W}" height="26" fill="rgba(255,255,255,0.85)"/><text x="6" y="18" font-size="14" font-family="sans-serif">${item.cls.toUpperCase()} p${item.page.page_number} ${item.page.page_type || ''} — ${(item.book.title || '').slice(0, 70).replace(/[<>&]/g, '')} | green=ref blue=flash red=lite orange=lite-batch</text>`;
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svgParts.join('')}${legend}</svg>`);
    const outName = `${item.cls}-${item.page.id}.jpg`;
    await sharp(img.buffer).resize(W, H).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 82 }).toFile(path.join(dir, outName));
    manifest.push({ file: outName, cls: item.cls, page_id: item.page.id, book_id: item.book.id, page_number: item.page.page_number, page_type: item.page.page_type, title: item.book.title, url: `https://sourcelibrary.org/book/${item.book.id}?page=${item.page.page_number}`, boxes });
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[sheets] wrote ${manifest.length} sheets → ${dir}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// grade-sheets — BLINDED composites for grading each box against the page image.
// One panel per arm, arm→panel order shuffled per page (key in grading/key.json), every
// box drawn in the same colour and numbered. The grader fills grading/grades.json:
//   { "<page_id>": { "pictures": <true illustrations on the page, by eye>,
//                    "panels": { "P1": { "grades": "TL", "missed": 0 }, ... } } }
// grades: one letter per numbered box, in order — T tight, L loose (takes in text/margin),
// C cropped (cuts the figure), W wrong object (text, ornament, blank), D duplicate (second
// box on an already-boxed figure). missed = true illustrations with no box in that panel.
// ═══════════════════════════════════════════════════════════════════════════
function hashSeed(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
function loadRuns() {
  const runs = {};
  for (const f of fs.readdirSync(OUT).filter((x) => /^raw-.*\.jsonl$/.test(x))) {
    const name = f.replace(/^raw-|\.jsonl$/g, '');
    const m = new Map();
    for (const r of readJsonl(path.join(OUT, f))) if (!r.error || !m.has(r.page_id)) m.set(r.page_id, r); // successful retry wins
    runs[name] = m;
  }
  return runs;
}

async function cmdGradeSheets() {
  const sample = loadSample();
  const runs = loadRuns();
  const arms = Object.keys(runs).sort();
  const nGrade = parseInt(opt('n-grade', '60'), 10);
  const perSheet = parseInt(opt('per-sheet', '4'), 10);
  const PANEL_W = parseInt(opt('panel-w', '700'), 10);
  const dir = path.join(OUT, 'grading');
  fs.mkdirSync(path.join(dir, 'sheets'), { recursive: true });
  const complete = (i) => arms.every((a) => { const r = runs[a].get(i.page.id); return r && !r.error; });
  const pos = sample.items.filter((i) => i.cls === 'pos' && i.image_url);
  const posOk = pos.filter(complete);
  // Stratify positives by stored-reference box count (1 / 2–3 / 4+), proportional, seeded.
  const rnd = mulberry32(47470928);
  const strata = { one: [], few: [], many: [] };
  for (const i of posOk) strata[i.reference.length <= 1 ? 'one' : i.reference.length <= 3 ? 'few' : 'many'].push(i);
  const picked = [];
  for (const [k, list] of Object.entries(strata)) {
    const take = Math.round((list.length / posOk.length) * nGrade);
    picked.push(...shuffle([...list], rnd).slice(0, take).map((i) => ({ ...i, stratum: k })));
  }
  // Negatives: every flash-negative page where ANY arm drew a box (each fire must be judged by eye —
  // a "false positive" there may be a picture production flash missed).
  const negFiredAll = sample.items.filter((i) => i.cls === 'neg' && complete(i) && arms.some((a) => parseRecord(runs[a].get(i.page.id)).images.length));
  const nNegGrade = parseInt(opt('n-neg-grade', '0'), 10);
  const negFired = nNegGrade ? shuffle([...negFiredAll], rnd).slice(0, nNegGrade) : negFiredAll;
  const chosen = [...picked, ...negFired.map((i) => ({ ...i, stratum: 'neg-fired' }))];
  console.log(`[grade-sheets] arms: ${arms.join(', ')}`);
  console.log(`[grade-sheets] positives complete in every arm ${posOk.length}/${pos.length}; strata one/few/many = ${strata.one.length}/${strata.few.length}/${strata.many.length}; picked ${picked.length}; negatives with a fire ${negFiredAll.length}, graded ${negFired.length}`);

  const key = {}, template = {}, manifest = [];
  let idx = 0;
  for (const item of chosen) {
    const img = await getImage(item);
    if (!img) continue;
    idx++;
    const meta = await sharp(img.buffer).metadata();
    const W = PANEL_W, H = Math.round(meta.height * (W / meta.width));
    const base = await sharp(img.buffer).resize(W, H).jpeg({ quality: 85 }).toBuffer();
    const order = shuffle([...arms], mulberry32(hashSeed(item.page.id)));
    key[item.page.id] = {};
    template[item.page.id] = { cls: item.cls, stratum: item.stratum, pictures: null, panels: {} };
    const panels = [];
    for (let p = 0; p < order.length; p++) {
      const label = `P${p + 1}`;
      const arm = order[p];
      key[item.page.id][label] = arm;
      const boxes = parseRecord(runs[arm].get(item.page.id)).images;
      template[item.page.id].panels[label] = { n_boxes: boxes.length, grades: '', missed: null };
      const parts = boxes.map((d, bi) => {
        const b = d.bbox; const x = b.x * W, y = b.y * H;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(b.width * W).toFixed(1)}" height="${(b.height * H).toFixed(1)}" fill="none" stroke="#ff00d4" stroke-width="3"/>`
          + `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="26" height="24" fill="#ff00d4"/><text x="${(x + 6).toFixed(1)}" y="${(y + 18).toFixed(1)}" font-size="18" font-weight="bold" fill="#fff" font-family="sans-serif">${bi + 1}</text>`;
      });
      const head = `<rect x="0" y="0" width="${W}" height="30" fill="rgba(0,0,0,0.75)"/><text x="8" y="22" font-size="20" font-weight="bold" fill="#fff" font-family="sans-serif">${label} · ${boxes.length} box${boxes.length === 1 ? '' : 'es'}</text>`;
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}${head}</svg>`);
      panels.push(await sharp(base).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 85 }).toBuffer());
    }
    // Sheets of `perSheet` panels in a 2-column grid, 8px gutters.
    for (let s = 0; s * perSheet < panels.length; s++) {
      const chunk = panels.slice(s * perSheet, (s + 1) * perSheet);
      const cols = Math.min(2, chunk.length), rows = Math.ceil(chunk.length / cols), G = 8;
      const sheetW = cols * W + (cols - 1) * G, sheetH = rows * H + (rows - 1) * G;
      const file = `${String(idx).padStart(3, '0')}-${item.cls}-${item.page.id}-${'abcd'[s]}.jpg`;
      await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#808080' } })
        .composite(chunk.map((buf, k) => ({ input: buf, left: (k % cols) * (W + G), top: Math.floor(k / cols) * (H + G) })))
        .jpeg({ quality: 82 }).toFile(path.join(dir, 'sheets', file));
      manifest.push({ file, page_id: item.page.id, cls: item.cls, stratum: item.stratum, url: `https://sourcelibrary.org/book/${item.book.id}?page=${item.page.page_number}`, title: item.book.title });
    }
  }
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 2));
  fs.writeFileSync(path.join(dir, 'grades.template.json'), JSON.stringify(template, null, 2));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[grade-sheets] ${idx} pages, ${manifest.length} sheets → ${dir}/sheets (key.json is the unblinding key — grade before opening it)`);
}

function cmdGradeScore() {
  const dir = path.join(OUT, 'grading');
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));
  const template = JSON.parse(fs.readFileSync(path.join(dir, 'grades.template.json'), 'utf8'));
  // --grades a.json,b.json,… merges several graders' files; the first file wins on pages graded
  // twice, and those overlap pages report inter-grader agreement (box letters + pictures).
  const files = (opt('grades') || path.join(dir, 'grades.json')).split(',');
  const graders = files.map((f) => JSON.parse(fs.readFileSync(path.isAbsolute(f) ? f : path.join(dir, f), 'utf8')));
  const grades = {};
  for (const g of [...graders].reverse()) Object.assign(grades, g);
  if (graders.length > 1) {
    let boxes = 0, same = 0, pages = 0, picSame = 0, tightSame = 0;
    for (let i = 0; i < graders.length; i++) for (let j = i + 1; j < graders.length; j++) {
      for (const [pid, a] of Object.entries(graders[i])) {
        const b = graders[j][pid]; if (!b) continue;
        pages++; if (a.pictures === b.pictures) picSame++;
        for (const [label, pa] of Object.entries(a.panels)) {
          const la = (pa.grades || '').toUpperCase(), lb = (b.panels[label]?.grades || '').toUpperCase();
          for (let k = 0; k < Math.max(la.length, lb.length); k++) {
            boxes++; if (la[k] === lb[k]) same++;
            if ((la[k] === 'T') === (lb[k] === 'T')) tightSame++;
          }
        }
      }
    }
    console.log(`[grade-score] inter-grader overlap: ${pages} page-pairs; pictures agree ${picSame}/${pages}; box letter agree ${same}/${boxes} (${boxes ? ((same / boxes) * 100).toFixed(1) : '—'}%); tight-vs-not agree ${tightSame}/${boxes} (${boxes ? ((tightSame / boxes) * 100).toFixed(1) : '—'}%)`);
  }
  const runs = loadRuns();
  const arms = Object.keys(runs).sort();
  const blank = () => ({ pages: 0, pictures: 0, missed: 0, T: 0, L: 0, C: 0, W: 0, D: 0, neg_pages: 0, neg_pages_fp: 0, neg_W: 0, neg_real: 0, perPage: [] });
  const A = Object.fromEntries(arms.map((a) => [a, blank()]));
  const problems = [];
  for (const [pid, g] of Object.entries(grades)) {
    if (!key[pid]) { problems.push(`${pid}: not in key`); continue; }
    const cls = g.cls || template[pid]?.cls;
    for (const [label, pg] of Object.entries(g.panels)) {
      const arm = key[pid][label];
      const n = parseRecord(runs[arm].get(pid)).images.length;
      const letters = (pg.grades || '').replace(/\s/g, '').toUpperCase();
      if (letters.length !== n || /[^TLCWD]/.test(letters)) { problems.push(`${pid} ${label} (${arm}): ${n} boxes, grades "${letters}"`); continue; }
      const s = A[arm];
      const cnt = (ch) => [...letters].filter((x) => x === ch).length;
      if (cls === 'pos') {
        s.pages++; s.pictures += g.pictures; s.missed += pg.missed || 0;
        for (const ch of 'TLCWD') s[ch] += cnt(ch);
        s.perPage.push({ pid, pictures: g.pictures, tight: Math.min(cnt('T'), g.pictures), found: g.pictures - (pg.missed || 0) });
      }
      if (cls === 'neg') {
        s.neg_pages++; s.neg_W += cnt('W'); if (cnt('W')) s.neg_pages_fp++;
        s.neg_real += cnt('T') + cnt('L') + cnt('C');
      }
    }
  }
  if (problems.length) { console.error(`[grade-score] ${problems.length} grading problems:\n  ${problems.join('\n  ')}`); }
  // Page-bootstrap CI (pages are the unit; boxes on one page are not independent).
  const boot = (pp) => {
    const rnd = mulberry32(4747); const xs = [];
    for (let b = 0; b < 2000; b++) {
      let t = 0, p = 0;
      for (let i = 0; i < pp.length; i++) { const q = pp[Math.floor(rnd() * pp.length)]; t += q.tight; p += q.pictures; }
      xs.push(p ? t / p : 0);
    }
    xs.sort((a, b) => a - b); return [xs[49], xs[1949]];
  };
  const costPerPage = {};
  for (const a of arms) {
    const recs = [...runs[a].values()].filter((r) => !r.error);
    const model = recs[0]?.model;
    const c = recs.reduce((s, r) => s + (typeof r.cost_usd === 'number' ? r.cost_usd : usd(model, r.input_tokens || 0, r.output_tokens || 0, r.mode === 'batch')), 0);
    costPerPage[a] = recs.length ? c / recs.length : null;
  }
  // Paired vs production flash (first flash run): per page, tight pictures won/lost/tied.
  const baseArm = arms.find((a) => a === 'flash-realtime');
  const byPid = (a) => new Map(A[a].perPage.map((p) => [p.pid, p]));
  const out = { graded_at: new Date().toISOString(), arms: {} };
  console.log('\n| arm | pages | pictures | box accuracy (tight/pictures) [95% CI] | usable (T+L)/pictures | picture recall | boxes T/L/C/W/D | neg FP boxes (pages) | neg real finds | vs flash W–L–T | $/page | $/1K pages |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const a of arms) {
    const s = A[a];
    const acc = s.pictures ? s.T / s.pictures : null;
    const ci = s.perPage.length ? boot(s.perPage) : [null, null];
    let wlt = '—';
    if (baseArm && a !== baseArm) {
      const bp = byPid(baseArm); let w = 0, l = 0, t = 0;
      for (const p of s.perPage) { const q = bp.get(p.pid); if (!q) continue; if (p.tight > q.tight) w++; else if (p.tight < q.tight) l++; else t++; }
      wlt = `${w}–${l}–${t}`;
    }
    const row = {
      pages: s.pages, pictures: s.pictures, box_accuracy: acc, box_accuracy_ci95: ci,
      usable: s.pictures ? (s.T + s.L) / s.pictures : null, picture_recall: s.pictures ? (s.pictures - s.missed) / s.pictures : null,
      boxes: { T: s.T, L: s.L, C: s.C, W: s.W, D: s.D }, neg: { pages: s.neg_pages, fp_boxes: s.neg_W, fp_pages: s.neg_pages_fp, real_finds: s.neg_real },
      vs_flash_wlt: wlt, cost_per_page: costPerPage[a],
    };
    out.arms[a] = row;
    const p = (v) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
    console.log(`| ${a} | ${s.pages} | ${s.pictures} | ${p(acc)} [${p(ci[0])}, ${p(ci[1])}] | ${p(row.usable)} | ${p(row.picture_recall)} | ${s.T}/${s.L}/${s.C}/${s.W}/${s.D} | ${s.neg_W} (${s.neg_pages_fp}/${s.neg_pages}) | ${s.neg_real} | ${wlt} | $${costPerPage[a]?.toFixed(5) ?? '—'} | $${costPerPage[a] != null ? (costPerPage[a] * 1000).toFixed(2) : '—'} |`);
  }
  fs.writeFileSync(path.join(dir, 'grade-results.json'), JSON.stringify(out, null, 2));
  console.log(`→ ${path.join(dir, 'grade-results.json')}`);
}

// ── main ──
const cmds = { sample: cmdSample, run: cmdRun, 'batch-submit': cmdBatchSubmit, 'batch-collect': cmdBatchCollect, score: cmdScore, sheets: cmdSheets, 'grade-sheets': cmdGradeSheets, 'grade-score': cmdGradeScore };
if (!cmds[cmd]) {
  console.error(`usage: node scripts/eval/image-extraction-lite-eval.mjs <${Object.keys(cmds).join('|')}> [--engine ${Object.keys(ENGINES).join('|')}] [--tag r2] [--limit N] [--out dir] [--date YYYY-MM-DD]`);
  process.exit(1);
}
await cmds[cmd]();
