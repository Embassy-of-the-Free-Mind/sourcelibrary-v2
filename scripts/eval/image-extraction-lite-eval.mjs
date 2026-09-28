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
 * Sub-commands (state lives under --out, default scripts/eval/results/image-extraction-lite-<date>/):
 *   sample                 draw 200 positive + 200 negative pages, one per book → sample.json
 *   run --engine flash|lite   realtime generateContent on every sampled page → raw-<engine>-realtime.jsonl
 *   batch-submit --engine lite   build JSONL, upload, create Batch API job → batch-<engine>.json
 *   batch-collect --engine lite  poll + download results → raw-<engine>-batch.jsonl
 *   score                  metrics for every raw-*.jsonl vs the stored flash reference → results.json
 *   sheets                 contact sheets (reference / flash / lite boxes) for the hand-read → sheets/
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

const MODELS = {
  flash: 'gemini-3-flash-preview',
  lite: 'gemini-3.1-flash-lite',
};
// $/M tokens, realtime. Batch = half. Matches scripts/workers/lib/supabase-usage-logger.mjs.
const PRICE = {
  'gemini-3-flash-preview': { input: 0.5, output: 3.0 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
};

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

function generationConfig(schema) {
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
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return null;
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
async function cmdRun() {
  const model = MODELS[ENGINE];
  if (!model) throw new Error(`--engine must be flash|lite`);
  const { prompt, schema, promptSha } = loadWorkerArtifacts();
  const sample = loadSample();
  const outFile = path.join(OUT, `raw-${ENGINE}-realtime.jsonl`);
  const done = new Set(readJsonl(outFile).map((r) => r.page_id));
  const todo = sample.items.filter((i) => i.image_url && !done.has(i.page.id));
  console.log(`[run ${ENGINE}] model=${model} prompt_sha=${promptSha} todo=${todo.length} (done ${done.size}) → ${outFile}`);
  const keys = apiKeys();
  let ki = 0;
  let spentIn = 0, spentOut = 0, errors = 0, n = 0;
  const cap = parseFloat(opt('spend-cap', '3'));

  const worker = async () => {
    while (todo.length) {
      const item = todo.shift();
      const img = await getImage(item);
      if (!img) { appendJsonl(outFile, { page_id: item.page.id, cls: item.cls, error: 'no-image' }); continue; }
      const text = buildRequestText(item, prompt);
      const body = {
        contents: [{ parts: [{ text }, { inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } }] }],
        safetySettings: SAFETY,
        generationConfig: generationConfig(schema),
      };
      let rec = { page_id: item.page.id, cls: item.cls, model, mode: 'realtime', prompt_sha: promptSha };
      for (let attempt = 0; attempt < 4; attempt++) {
        const key = keys[(ki++) % keys.length];
        const t0 = Date.now();
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
          });
          if (res.status === 429 || res.status >= 500) {
            const t = await res.text();
            if (attempt === 3) { rec.error = `${res.status} ${t.slice(0, 200)}`; break; }
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            continue;
          }
          if (!res.ok) { rec.error = `${res.status} ${(await res.text()).slice(0, 300)}`; break; }
          const data = await res.json();
          const usage = data.usageMetadata || {};
          rec = {
            ...rec,
            ms: Date.now() - t0,
            input_tokens: usage.promptTokenCount || 0,
            output_tokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
            thoughts_tokens: usage.thoughtsTokenCount || 0,
            finish_reason: data.candidates?.[0]?.finishReason,
            text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
          };
          spentIn += rec.input_tokens; spentOut += rec.output_tokens;
          break;
        } catch (e) {
          if (attempt === 3) rec.error = String(e).slice(0, 200);
          else await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
      if (rec.error) errors++;
      appendJsonl(outFile, rec);
      n++;
      const usd = (spentIn * PRICE[model].input + spentOut * PRICE[model].output) / 1e6;
      if (n % 25 === 0) console.log(`[run ${ENGINE}] ${n}/${n + todo.length} done, errors ${errors}, $${usd.toFixed(3)}`);
      if (usd > cap) { console.error(`[run ${ENGINE}] spend cap $${cap} hit — stopping`); todo.length = 0; }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const usd = (spentIn * PRICE[model].input + spentOut * PRICE[model].output) / 1e6;
  console.log(`[run ${ENGINE}] finished: ${n} calls, ${errors} errors, in ${spentIn} / out ${spentOut} tokens, $${usd.toFixed(3)}`);
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
        generationConfig: generationConfig(schema),
      },
    }));
  }
  const jsonl = lines.join('\n') + '\n';
  const bytes = Buffer.byteLength(jsonl);
  console.log(`[batch ${ENGINE}] ${lines.length} requests, ${skipped} skipped, ${(bytes / 1e6).toFixed(1)} MB JSONL, prompt_sha=${promptSha}`);
  const key = apiKeys()[0];
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
  const rec = { model, job_name: job.name, state: job.metadata?.state || job.state, file_name: fileName, requests: lines.length, submitted_at: new Date().toISOString(), prompt_sha: promptSha, key_index: 0 };
  fs.writeFileSync(path.join(OUT, `batch-${ENGINE}.json`), JSON.stringify(rec, null, 2));
  console.log(`[batch ${ENGINE}] created ${job.name} state=${rec.state}`);
}

async function cmdBatchCollect() {
  const model = MODELS[ENGINE];
  const f = path.join(OUT, `batch-${ENGINE}.json`);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  const key = apiKeys()[rec.key_index || 0];
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
      let n = 0, errors = 0;
      for (const line of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(line);
        const pageId = r.key || r.metadata?.key;
        const resp = r.response;
        const usage = resp?.usageMetadata || {};
        const out = { page_id: pageId, cls: clsById.get(pageId), model, mode: 'batch', prompt_sha: rec.prompt_sha };
        if (r.error || !resp) { out.error = JSON.stringify(r.error || 'no-response').slice(0, 300); errors++; }
        else {
          out.input_tokens = usage.promptTokenCount || 0;
          out.output_tokens = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
          out.thoughts_tokens = usage.thoughtsTokenCount || 0;
          out.finish_reason = resp.candidates?.[0]?.finishReason;
          out.text = resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }
        appendJsonl(outFile, out);
        n++;
      }
      rec.collected_at = new Date().toISOString(); rec.state = state; rec.responses = n; rec.errors = errors;
      fs.writeFileSync(f, JSON.stringify(rec, null, 2));
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
function normalizeBbox(raw) {
  const x = parseFloat(raw.x) || 0, y = parseFloat(raw.y) || 0, width = parseFloat(raw.width) || 0, height = parseFloat(raw.height) || 0;
  if (x > 1 || y > 1 || width > 1 || height > 1) {
    const scale = Math.max(x + width, y + height, 1000);
    return { x: Math.min(x / scale, 0.95), y: Math.min(y / scale, 0.95), width: Math.min(width / scale, 1), height: Math.min(height / scale, 1) };
  }
  return { x, y, width, height };
}
function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
function parseDetections(text) {
  if (!text) return { images: [], parse_error: 'empty' };
  try {
    const j = JSON.parse(text);
    const images = (j.extracted_images || []).filter((d) => d && d.bbox).map((d) => ({
      bbox: normalizeBbox(d.bbox), type: d.type, gallery_quality: typeof d.gallery_quality === 'number' ? d.gallery_quality : undefined, description: d.description,
    }));
    return { images, scan_quality: j.scan_quality };
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
    const parsed = parseDetections(r.text);
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
  const storedRef = new Map(sample.items.map((i) => [i.page.id, { images: i.reference.map((d) => ({ ...d, bbox: normalizeBbox(d.bbox) })) }]));
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
    const price = PRICE[model] || PRICE[MODELS.flash];
    const mult = name.endsWith('batch') ? 0.5 : 1;
    s.cost_usd = mult * (s.tokens.input * price.input + s.tokens.output * price.output) / 1e6;
    s.cost_per_1k_pages = s.callable ? (s.cost_usd / s.callable) * 1000 : null;
    s.model = model;
    results.runs[name] = { vs: 'stored-flash-reference', ...s };
  }
  // lite runs vs the flash RE-RUN (same bytes, same day) — removes drift-over-time from the comparison
  const flashRerun = runRecords['flash-realtime'];
  if (flashRerun) {
    const rerunRef = new Map();
    for (const r of flashRerun) if (!r.error) rerunRef.set(r.page_id, parseDetections(r.text));
    for (const [name, records] of Object.entries(runRecords)) {
      if (name === 'flash-realtime') continue;
      const s = scoreRun(records, sampleById, rerunRef);
      delete s.per_page;
      results.runs[`${name}__vs_flash_rerun`] = { vs: 'flash-realtime-rerun', ...s };
    }
  }
  // decision rule (handoff): lite adopted iff recall ≥ flash − 3pp, FP ≤ flash + 2pp, median IoU ≥ 0.85 — all vs the stored reference,
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
    const layers = { reference: item.reference.map((d) => ({ ...d, bbox: normalizeBbox(d.bbox) })) };
    for (const [name, m] of Object.entries(runs)) { const r = m.get(item.page.id); if (r && !r.error) layers[name] = parseDetections(r.text).images; }
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

// ── main ──
const cmds = { sample: cmdSample, run: cmdRun, 'batch-submit': cmdBatchSubmit, 'batch-collect': cmdBatchCollect, score: cmdScore, sheets: cmdSheets };
if (!cmds[cmd]) {
  console.error(`usage: node scripts/eval/image-extraction-lite-eval.mjs <${Object.keys(cmds).join('|')}> [--engine flash|lite] [--out dir] [--date YYYY-MM-DD]`);
  process.exit(1);
}
await cmds[cmd]();
