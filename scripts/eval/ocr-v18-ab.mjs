#!/usr/bin/env node
/**
 * OCR prompt v18 vs v16, three arms through the Batch API, over five labelled strata (#4195, #4149).
 * The spec is scripts/eval/PREREGISTRATION-ocr-v18-blank-insert.md: strata, outcomes, noise floor and the
 * five-clause decision rule, including its dated amendments. This file implements that spec and nothing else.
 *
 * PRIOR ART: scripts/eval/prompt-ab.mjs (#4610): paired k-run A/B, but realtime, over 10 hand-picked cases,
 * with a body-length estimator. Its three blank cases are reused here as S3 members. scripts/eval/blank-page-study.mjs
 * (#3444): `bodyText` / `declaredBlank` / `loopCoverage` are imported, not rewritten.
 * scripts/eval/ocr-preprocessing/gemini-score.mjs (#5250): the windowed-CER + A/A rule over the same reference
 * pages; `scoreAgainstReference` (lib/metrics.mjs) and `makeRng` / `binomTwoSided` (lib/paired-stats.mjs) are
 * imported. scripts/eval/two-read-garble-5313.mjs: the REST Batch upload/create/collect shape, which this mirrors
 * (it cannot be imported, because it runs on import). scripts/workers/pipeline-orchestrator.mjs: the production
 * cross-book OCR request (prompt + document context, safety settings, OCR_GENERATION_CONFIG, 1500 px resize).
 * Those constants are not exported from that worker, so they are copied here and named.
 *
 * Stages. Each one reads the previous stage's files in WORK. The script is resumable, and it never writes to
 * `pages` or `prompts`.
 *   --draw                 Mongo READ-ONLY: select the strata         → WORK/pages.jsonl, WORK/draw-log.json
 *   --build                fetch images, write one request file per arm → WORK/requests-<arm>.jsonl, WORK/estimate.json
 *   --submit --approved-usd=N   upload + create one Batch job per arm  → WORK/batch.json
 *   --poll                 collect finished jobs; exit 0 when every job is terminal, 1 otherwise
 *   --score                outcomes, noise floor, decision rule       → scripts/eval/results/ocr-v18-ab-2026-10.json
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ocr-v18-ab.mjs --draw
 *   until node --env-file=… scripts/eval/ocr-v18-ab.mjs --poll; do sleep 120; done
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bodyText, declaredBlank, loopCoverage } from './blank-page-study.mjs';
import { scoreAgainstReference } from './lib/metrics.mjs';
import { makeRng, binomTwoSided, mean } from './lib/paired-stats.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { OCR_MODEL_LITE } from '../lib/ocr-routing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => (argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || d;

const SEED = 4195;
const K = 3;
const ARMS = ['A', 'A2', 'B'];
const MODEL = OCR_MODEL_LITE; // gemini-3.1-flash-lite: the production lite OCR model
const V16_ID = '6a98b8a075660c6a8b09a8f8';
const V16_HASH = '0203c2641e253ffbf17772ae1b30bf16';
const CANDIDATE = path.join(__dirname, '../../prompts/ocr/standard-ocr-v18-candidate.md');
const HARD_CAP_USD = 5;
const WORK = opt('work', '/root/claude-jobs/ocr-v18-ab-work');
const RESULTS_DIR = path.join(__dirname, 'results/ocr-v18-ab-2026-10');
const RESULTS_JSON = path.join(__dirname, 'results/ocr-v18-ab-2026-10.json');
const CORPUS_4149 = opt('corpus', '/root/claude-jobs/fabricated-ocr-corpus-2026-08-21.jsonl');
const V04 = path.join(__dirname, 'dataset/v0.4-difficulty/pages.jsonl');
const REF_5250 = opt('ref5250', '/mnt/HC_Volume_105839809/root-moved/pp5250/gemini/pages.jsonl');
const RES_5250 = path.join(__dirname, 'results/ocr-preprocessing-2026-09-29.json');
const API = 'https://generativelanguage.googleapis.com';

// pipeline-orchestrator.mjs: OCR_GENERATION_CONFIG, OCR_IMAGE_MAX_PX, the cross-book safety settings,
// and getOcrPromptFromDb's language instruction (same text as eval/lib/production-prompt.mjs).
const OCR_GENERATION_CONFIG = Object.freeze({ temperature: 0.1, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } });
const OCR_IMAGE_MAX_PX = 1500;
const SAFETY = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT', 'CIVIC_INTEGRITY'].map((c) => ({ category: `HARM_CATEGORY_${c}`, threshold: 'BLOCK_NONE' }));
const LANGUAGE_INSTRUCTION = '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).';

// prompt-ab.mjs BULHAN cases (#3591): real content that must NOT be read as blank.
const NAMED_S3 = [
  { book_id: '6953b56577f38f6761bd979d', page: 4, note: 'prompt-ab faint-mark' },
  { book_id: '6953b56577f38f6761bd979d', page: 266, note: 'prompt-ab basmala' },
  { book_id: '6953b56577f38f6761bd979d', page: 197, note: 'prompt-ab cataloguer' },
];

const F = (n) => path.join(WORK, n);
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const sha = (s) => crypto.createHash('sha256').update(s || '').digest('hex').slice(0, 16);
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const r4 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1e4) / 1e4);
const BAD_LANG = /tibet|syriac|^bo$|^bod$|^syr$|^syc$/i;
const letters = (s) => (s.match(/\p{L}/gu) || []).length;

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ───────────────────────────── draw ─────────────────────────────
async function stageDraw() {
  fs.mkdirSync(WORK, { recursive: true });
  const { withMongo } = await import('../lib/mongo.mjs');
  const log = { seed: SEED, skipped: {}, corpus_4149: {} };
  const skip = (stratum, reason, what) => ((log.skipped[stratum] ||= []).push({ reason, ...what }));

  // #4149 corpus. The brief warned of bad surrogate escapes: parse line by line and count what fails.
  const corpus = []; let bad = 0, lines = 0;
  for (const l of fs.readFileSync(CORPUS_4149, 'utf8').split('\n')) {
    if (!l.trim()) continue; lines++;
    try { corpus.push(JSON.parse(l)); } catch { bad++; }
  }
  log.corpus_4149 = { lines, parsed: corpus.length, skipped_unparseable: bad };
  const v04 = readJsonl(V04);

  const out = [];
  await withMongo(async (db) => {
    const bookCache = new Map();
    async function book(id) {
      if (!bookCache.has(id)) {
        let b = await db.collection('books').findOne({ id }, { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, original_language: 1, languages: 1 } });
        if (!b && /^[0-9a-f]{24}$/.test(id)) {
          const { ObjectId } = await import('mongodb');
          b = await db.collection('books').findOne({ _id: new ObjectId(id) }, { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, original_language: 1, languages: 1 } });
        }
        bookCache.set(id, b);
      }
      return bookCache.get(id);
    }
    const langs = (b) => [b.language, b.original_language, ...(Array.isArray(b.languages) ? b.languages : [])].filter((x) => typeof x === 'string');
    const PAGE_PROJ = { id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 };
    /** Resolve one candidate → a stratum row, or null with the reason logged. */
    async function resolve(stratum, { book_id, page_number, page_id }, extra) {
      const b = await book(book_id);
      if (!b) { skip(stratum, 'book-not-found', { book_id, page_number }); return null; }
      if (langs(b).some((x) => BAD_LANG.test(x.trim()))) { skip(stratum, 'tibetan-or-syriac', { book_id, page_number, langs: langs(b) }); return null; }
      const q = page_id ? { id: page_id } : { book_id: b.id || book_id, page_number };
      const ps = await db.collection('pages').find(q, { projection: PAGE_PROJ }).sort({ id: 1 }).toArray();
      if (!ps.length) { skip(stratum, 'page-not-found', { book_id, page_number, page_id }); return null; }
      const p = ps[0];
      const image = getPageSource(p);
      if (!image) { skip(stratum, 'no-image-url', { book_id, page_number }); return null; }
      return { uid: p.id, stratum, book_id: b.id || book_id, page_id: p.id, page_number: p.page_number, pages_matched: ps.length,
        image, language: b.language || null, title: b.title || null, author: b.author || null, year: b.year || null, ...extra };
    }
    /** One row per book, books in seeded order, until n are accepted. */
    async function drawPerBook(stratum, rows, n, toCand, exclude = new Set()) {
      const rng = makeRng(SEED);
      const byBook = new Map();
      for (const r of rows) (byBook.get(r.book_id) || byBook.set(r.book_id, []).get(r.book_id)).push(r);
      const got = [];
      for (const bid of shuffle([...byBook.keys()].sort(), rng)) {
        if (got.length >= n) break;
        const opts = byBook.get(bid).sort((a, b) => a.page - b.page);
        const pick = opts[Math.floor(rng() * opts.length)];
        if (exclude.has(`${pick.book_id}:${pick.page}`)) { skip(stratum, 'named-case-duplicate', { book_id: pick.book_id, page_number: pick.page }); continue; }
        const row = await resolve(stratum, toCand(pick), { source: '4149-corpus', ink_coverage: pick.ink_coverage, corpus_image: pick.image, corpus_model: pick.model, corpus_opening: (pick.opening || '').slice(0, 160) });
        if (row) got.push(row);
      }
      return got;
    }

    const cand4149 = (r) => ({ book_id: r.book_id, page_number: r.page });
    // S1: fabricated blank leaves
    out.push(...await drawPerBook('S1', corpus.filter((r) => r.verdict === 'FABRICATED'), 40, cand4149));
    // S2: v0.4 blank_page (all 38)
    for (const r of v04.filter((x) => (x.difficulty || []).includes('blank_page'))) {
      const row = await resolve('S2', { book_id: r.book_id, page_id: r.page_id, page_number: r.page_number }, { source: 'v0.4 blank_page', slug: r.slug });
      if (row) out.push(row);
    }
    // S3: sparse ink, real content (over-decline guard)
    const named = new Set(NAMED_S3.map((c) => `${c.book_id}:${c.page}`));
    out.push(...await drawPerBook('S3', corpus.filter((r) => r.verdict === 'has_ink' && r.ink_coverage >= 0.003 && r.ink_coverage <= 0.03), 40, cand4149, named));
    for (const c of NAMED_S3) {
      const row = await resolve('S3', { book_id: c.book_id, page_number: c.page }, { source: c.note });
      if (row) out.push(row);
    }
    // S4: labels / inserts
    const seen = new Set();
    for (const r of v04.filter((x) => (x.difficulty || []).some((d) => d === 'image_only_labels' || d === 'marginalia_missed'))) {
      if (seen.has(r.page_id)) continue; seen.add(r.page_id);
      const row = await resolve('S4', { book_id: r.book_id, page_id: r.page_id, page_number: r.page_number }, { source: `v0.4 ${(r.difficulty || []).filter((d) => d === 'image_only_labels' || d === 'marginalia_missed').join('+')}`, slug: r.slug });
      if (row) out.push(row);
    }
    // S5: #5250 reference pages that did not abstain there (amendment 1)
    const res5250 = JSON.parse(fs.readFileSync(RES_5250, 'utf8'));
    const abstained = new Set(['greek-latin', 'cjk-woodblock'].flatMap((s) => res5250.strata[s].abstained.map((a) => a.slug)));
    const refs = readJsonl(REF_5250).filter((r) => r.ref && !abstained.has(r.slug));
    for (const [script, n] of [['latin', 14], ['greek', 13], ['cjk', 13]]) {
      const rng = makeRng(SEED);
      let got = 0;
      for (const r of shuffle(refs.filter((x) => x.script === script).sort((a, b) => a.slug.localeCompare(b.slug)), rng)) {
        if (got >= n) break;
        const base = { source: `#5250 ${r.ref_source}`, slug: r.slug, script, ref: r.ref, origin: r.origin };
        if (r.origin === 'external') {
          out.push({ uid: r.slug, stratum: 'S5', book_id: null, page_id: null, page_number: null, image: r.image_url, language: 'Latin', title: null, author: null, year: null, ...base });
          got++; continue;
        }
        const pn = Number((r.slug.match(/-p(\d+)$/) || [])[1]);
        const row = await resolve('S5', { book_id: r.book_id, page_number: pn }, base);
        if (row) { out.push(row); got++; }
      }
    }
  });
  writeJsonl(F('pages.jsonl'), out);
  log.counts = out.reduce((a, r) => ((a[r.stratum] = (a[r.stratum] || 0) + 1), a), {});
  log.skipped_counts = Object.fromEntries(Object.entries(log.skipped).map(([s, l]) => [s, l.reduce((a, x) => ((a[x.reason] = (a[x.reason] || 0) + 1), a), {})]));
  fs.writeFileSync(F('draw-log.json'), JSON.stringify(log, null, 1));
  console.log('draw:', JSON.stringify(log.counts), '\nskipped:', JSON.stringify(log.skipped_counts), '\n4149 corpus:', JSON.stringify(log.corpus_4149));
}

// ───────────────────────────── build ─────────────────────────────
async function loadPrompts() {
  const { withMongo } = await import('../lib/mongo.mjs');
  const { ObjectId } = await import('mongodb');
  let v16;
  await withMongo(async (db) => { v16 = await db.collection('prompts').findOne({ _id: new ObjectId(V16_ID) }); });
  if (!v16?.content) throw new Error(`v16 prompt row ${V16_ID} not found`);
  if (v16.content_hash !== V16_HASH || md5(v16.content) !== V16_HASH) throw new Error(`v16 content_hash mismatch: row ${v16.content_hash}, md5 ${md5(v16.content)}`);
  const cand = fs.readFileSync(CANDIDATE, 'utf8');
  // getOcrPromptFromDb's substitution, applied identically to both prompts
  const sub = (t) => t.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '');
  return {
    A: { text: sub(v16.content), source: `prompts ${V16_ID} v${v16.version}`, content_hash: v16.content_hash },
    A2: { text: sub(v16.content), source: `prompts ${V16_ID} v${v16.version}`, content_hash: v16.content_hash },
    B: { text: sub(cand), source: 'prompts/ocr/standard-ocr-v18-candidate.md', content_hash: md5(cand) },
  };
}

/** pipeline-orchestrator.mjs fetchImageBase64: resize to fit 1500 px (JPEG q80) only when over 100 KB. */
async function fetchImageBase64(url) {
  const sharp = (await import('sharp')).default;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'SourceLibrary-eval/0.1 (OCR prompt A/B #4195; library@sourcelibrary.org)' } });
  if (!res.ok) throw new Error(`http ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  let mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (buf.length < 1000) throw new Error(`tiny body ${buf.length}b`);
  if (buf.length > 100_000) {
    try { buf = await sharp(buf).resize({ width: OCR_IMAGE_MAX_PX, height: OCR_IMAGE_MAX_PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(); mimeType = 'image/jpeg'; } catch { /* as production: use the original */ }
  }
  return { data: buf.toString('base64'), mimeType, bytes: buf.length };
}

const docContext = (p) => {
  const yearStr = p.year ? `Published ${p.year}.` : '';
  const pd = p.year && p.year < 1930 ? 'This work is in the public domain.' : '';
  return yearStr || p.title ? `\n\n**Document context:** "${p.title || 'Unknown'}" by ${p.author || 'Unknown'}. ${yearStr} ${pd}`.trim() : '';
};

async function stageBuild() {
  const pages = readJsonl(F('pages.jsonl'));
  const prompts = await loadPrompts();
  const streams = Object.fromEntries(ARMS.map((a) => [a, fs.createWriteStream(F(`requests-${a}.jsonl`))]));
  const meta = []; const tok = { in: 0, n: 0 };
  let i = 0;
  for (const p of pages) {
    i++;
    let img;
    try { img = await fetchImageBase64(p.image); } catch (e) { meta.push({ uid: p.uid, stratum: p.stratum, fetch_error: String(e.message || e).slice(0, 120) }); console.log(`  fetch failed ${p.stratum} ${p.uid}: ${e.message}`); continue; }
    const ctx = p.book_id ? docContext(p) : '';
    for (const arm of ARMS) {
      const text = `${prompts[arm].text}${ctx}`.trim();
      const request = { contents: [{ parts: [{ text }, { inlineData: { mimeType: img.mimeType, data: img.data } }] }], safetySettings: SAFETY, generationConfig: OCR_GENERATION_CONFIG };
      for (let k = 1; k <= K; k++) {
        streams[arm].write(JSON.stringify({ key: `${arm}:${p.uid}:${k}`, request }) + '\n');
        tok.in += Math.ceil(text.length / 3.5) + 1100; tok.n++;
      }
    }
    meta.push({ uid: p.uid, stratum: p.stratum, image_bytes: img.bytes, image_hash: sha(img.data) });
    if (i % 20 === 0) console.log(`  ${i}/${pages.length}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  await Promise.all(Object.values(streams).map((s) => new Promise((res) => s.end(res))));
  const { priceFor, BATCH_MULTIPLIER } = await import('../lib/model-pricing.mjs');
  const pr = priceFor(MODEL);
  const outAvg = 900; // generous: an average OCR page is ~500 tokens; loops run to 16k
  const usd = BATCH_MULTIPLIER * ((tok.in / 1e6) * pr.input + ((tok.n * outAvg) / 1e6) * pr.output);
  const est = { at: new Date().toISOString(), model: MODEL, requests: tok.n, in_tokens: tok.in, out_tokens_assumed: tok.n * outAvg, price: pr, batch_multiplier: BATCH_MULTIPLIER, usd: r4(usd),
    pages_built: meta.filter((m) => !m.fetch_error).length, fetch_failed: meta.filter((m) => m.fetch_error),
    prompts: Object.fromEntries(ARMS.map((a) => [a, { source: prompts[a].source, content_hash: prompts[a].content_hash, sent_hash_no_context: sha(prompts[a].text) }])),
    generation: OCR_GENERATION_CONFIG, image: { field: 'getPageSource(page)', resized_to_px: OCR_IMAGE_MAX_PX } };
  writeJsonl(F('images.jsonl'), meta);
  fs.writeFileSync(F('estimate.json'), JSON.stringify(est, null, 1));
  console.log(`build: ${est.pages_built} pages × ${ARMS.length} arms × k=${K} = ${tok.n} requests; fetch failed ${est.fetch_failed.length}; ESTIMATE $${est.usd}`);
}

// ───────────────────────────── submit ─────────────────────────────
async function stageSubmit() {
  const est = JSON.parse(fs.readFileSync(F('estimate.json'), 'utf8'));
  const approved = Number(opt('approved-usd', 0));
  if (est.usd > HARD_CAP_USD) { console.error(`REFUSING: estimate $${est.usd} is over the $${HARD_CAP_USD} cap`); process.exit(2); }
  if (!(approved >= est.usd)) { console.error(`REFUSING TO SPEND: estimate $${est.usd}, --approved-usd=${approved || 'absent'}`); process.exit(2); }
  const { createThenDeleteInput } = await import('../lib/gemini-batch-input-file.mjs');
  const bf = F('batch.json');
  const rec = fs.existsSync(bf) ? JSON.parse(fs.readFileSync(bf, 'utf8')) : { key_env: process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY', estimate_usd: est.usd, jobs: [] };
  const key = process.env[rec.key_env]; if (!key) throw new Error(`no ${rec.key_env}`);
  for (const arm of ARMS) {
    if (rec.jobs.some((j) => j.arm === arm)) { console.log(`${arm}: already submitted`); continue; }
    const file = F(`requests-${arm}.jsonl`); const bytes = fs.statSync(file).size;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
    const name = `ocr-v18-ab-4195-${arm}`;
    const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'text/plain' },
      body: JSON.stringify({ file: { displayName: name } }) });
    if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
    const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: fs.readFileSync(file) });
    if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
    const fileName = (await up.json()).file?.name; if (!fileName) throw new Error('upload response missing file.name');
    for (let i = 0; i < 30; i++) { // wait for ACTIVE, as createBatchJobFromFile does
      const st = await (await fetch(`${API}/v1beta/${fileName}?key=${key}`)).json();
      if (st.state === 'ACTIVE') break; if (st.state === 'FAILED') throw new Error(`file ${fileName} FAILED`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    // thinking-ok: a Batch job over requests-<arm>.jsonl, whose every line sets thinkingConfig: { thinkingBudget: 0 } (OCR_GENERATION_CONFIG); usage is logged in --poll
    const job = await createThenDeleteInput({ fileName, apiKey: key, create: async () => {
      const create = await fetch(`${API}/v1beta/models/${MODEL}:batchGenerateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: { display_name: name, input_config: { file_name: fileName } } }) });
      if (!create.ok) throw new Error(`batch create ${create.status} ${(await create.text()).slice(0, 500)}`);
      return create.json();
    } });
    rec.jobs.push({ arm, model: MODEL, job_name: job.name, requests: lines, bytes, submitted_at: new Date().toISOString() });
    fs.writeFileSync(bf, JSON.stringify(rec, null, 1)); // after EACH job: a crash must not orphan a paid one
    console.log(`submitted ${arm} → ${job.name} (${lines} requests, ${(bytes / 1e6).toFixed(0)} MB)`);
  }
}

// ───────────────────────────── poll / collect ─────────────────────────────
/** One Batch response line → an outcome (eval-design §5.1: an enum, never inferred from the text alone). Same as two-read-garble-5313. */
function outcomeOf(r) {
  const resp = r.response;
  if (r.error || !resp) return { outcome: 'error', error: JSON.stringify(r.error || 'no response').slice(0, 300) };
  const cand = resp.candidates?.[0], finish = cand?.finishReason || null;
  const raw = (cand?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('');
  const block = resp.promptFeedback?.blockReason || null;
  if (!raw.trim()) return { outcome: block || (finish && finish !== 'STOP') ? 'refusal' : 'empty', finish, block };
  return { outcome: finish === 'MAX_TOKENS' ? 'truncated' : finish && finish !== 'STOP' ? 'refusal' : 'text', finish, raw };
}

async function stagePoll() {
  const bf = F('batch.json');
  const rec = JSON.parse(fs.readFileSync(bf, 'utf8')); const key = process.env[rec.key_env];
  const { priceFor, BATCH_MULTIPLIER } = await import('../lib/model-pricing.mjs');
  let pending = 0;
  for (const j of rec.jobs) {
    if (j.collected_at || j.terminal_state) continue;
    const data = await (await fetch(`${API}/v1beta/${j.job_name}?key=${key}`)).json();
    const state = data.metadata?.state || data.state;
    console.log(`${new Date().toISOString()} ${j.arm} ${j.job_name} ${state} ${JSON.stringify(data.metadata?.batchStats || {})}`);
    if (/FAILED|CANCELLED|EXPIRED/.test(state || '')) { j.terminal_state = state; fs.writeFileSync(bf, JSON.stringify(rec, null, 1)); continue; }
    const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
    if (!rf) { pending++; continue; }
    const text = await (await fetch(`${API}/download/v1beta/${rf}:download?alt=media&key=${key}`)).text();
    let inTok = 0, outTok = 0; const outcomes = {}, rows = []; const p = priceFor(j.model);
    for (const line of text.split('\n').filter(Boolean)) {
      const r = JSON.parse(line); const [arm, uid, k] = (r.key || r.metadata?.key).split(':');
      const o = outcomeOf(r), u = r.response?.usageMetadata || {};
      const it = { arm, uid, k: Number(k), outcome: o.outcome, finish: o.finish ?? null, model_version: r.response?.modelVersion || null };
      if (o.error) it.error = o.error; if (o.block) it.block = o.block;
      if (o.raw) it.text = o.raw;
      it.inTok = u.promptTokenCount || 0; it.outTok = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
      inTok += it.inTok; outTok += it.outTok; outcomes[o.outcome] = (outcomes[o.outcome] || 0) + 1; rows.push(it);
    }
    fs.appendFileSync(F('reads.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    Object.assign(j, { collected_at: new Date().toISOString(), responses: rows.length, outcomes, in_tokens: inTok, out_tokens: outTok, cost_usd: BATCH_MULTIPLIER * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output) });
    fs.writeFileSync(bf, JSON.stringify(rec, null, 1));
    console.log(`collected ${j.arm}: ${rows.length} ${JSON.stringify(outcomes)} $${j.cost_usd.toFixed(4)}`);
    try {
      const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
      await logUsage({ type: 'eval', mode: 'batch', model: j.model, page_count: rows.length, input_tokens: inTok, output_tokens: outTok, batch_job_id: j.job_name, endpoint: 'eval/ocr-v18-ab-4195', triggered_by: 'manual', prompt_version: `eval-4195-${j.arm}` });
      j.usage_logged = true;
    } catch (e) { j.usage_logged = false; console.warn(`logUsage failed: ${e.message}`); }
    fs.writeFileSync(bf, JSON.stringify(rec, null, 1));
  }
  const total = rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0);
  if (pending) { console.log(`${pending} job(s) pending; collected so far $${total.toFixed(4)}`); process.exit(1); }
  console.log(`all jobs terminal; actual $${total.toFixed(4)}`);
  process.exit(0);
}

// ───────────────────────────── score ─────────────────────────────
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const sd = (xs) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };
function wilson(k, n, z = 1.96) {
  if (!n) return { rate: null, lo: null, hi: null, k, n };
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return { rate: r4(p), lo: r4(Math.max(0, c - h)), hi: r4(Math.min(1, c + h)), k, n };
}
const TAG_TEXT = (t, names) => { let n = 0; const re = new RegExp(`<(${names})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi'); let m; while ((m = re.exec(t))) n += m[2].trim().length; return n; };
const pageType = (t) => ((t || '').match(/<page-type>\s*([^<]*?)\s*<\/page-type>/i) || [, null])[1];

/** Per-run outcome values. null = not scoreable for that outcome (amendment 6). */
function runOutcomes(page, run) {
  if (run.outcome === 'error' || (run.outcome === 'refusal' && !run.text)) return null;
  const t = run.text || '';
  const body = bodyText(t);
  const L = letters(body);
  const fabricated = L > 20 ? 1 : 0;
  const o = { body_letters: L, body_chars: body.length, loop: loopCoverage(body) > 0.5 ? 1 : 0, page_type: pageType(t), declared_blank: declaredBlank(t) ? 1 : 0 };
  if (page.stratum === 'S1' || page.stratum === 'S2') { o.fabricated = fabricated; o.blank_recall = declaredBlank(t) && !fabricated ? 1 : 0; }
  if (page.stratum === 'S3') o.false_blank = declaredBlank(t) || L === 0 ? 1 : 0;
  if (page.stratum === 'S4') {
    const cap = TAG_TEXT(t, 'insert|margin|gloss'), desc = TAG_TEXT(t, 'note|image-desc');
    o.label_capture = cap + desc ? cap / (cap + desc) : null; o.label_chars = cap;
  }
  if (page.stratum === 'S5') {
    const s = run.outcome === 'text' ? scoreAgainstReference(page.ref, t, page.script) : null;
    o.aligned = s?.aligned ? 1 : 0;
    o.wcer = s?.aligned && s.windowedCer != null ? Math.min(1, s.windowedCer) : 1.0;
  }
  return o;
}

const OUTCOME_OF = { S1: 'fabricated', S2: 'blank_recall', S3: 'false_blank', S4: 'label_capture', S5: 'wcer' };
const SECONDARY = { S1: ['blank_recall'], S2: ['fabricated'], S3: [], S4: ['label_chars'], S5: [] };

function stageScore() {
  const pages = readJsonl(F('pages.jsonl'));
  const imgs = new Map(readJsonl(F('images.jsonl')).map((m) => [m.uid, m]));
  const reads = new Map(); // last row per arm:uid:k
  for (const r of readJsonl(F('reads.jsonl'))) reads.set(`${r.arm}:${r.uid}:${r.k}`, r);
  const rec = JSON.parse(fs.readFileSync(F('batch.json'), 'utf8'));
  const est = JSON.parse(fs.readFileSync(F('estimate.json'), 'utf8'));
  const dropped = pages.filter((p) => imgs.get(p.uid)?.fetch_error).map((p) => ({ uid: p.uid, stratum: p.stratum, reason: imgs.get(p.uid).fetch_error }));
  const live = pages.filter((p) => imgs.has(p.uid) && !imgs.get(p.uid).fetch_error);

  // per page × arm: per-run outcomes and the page mean
  const per = new Map(); // uid → { arm → { runs:[o], mean:{outcome:value}, sd:{} } }
  const runOutcomeCounts = {};
  for (const p of live) {
    const byArm = {};
    for (const arm of ARMS) {
      const runs = [];
      for (let k = 1; k <= K; k++) {
        const r = reads.get(`${arm}:${p.uid}:${k}`);
        const key = `${arm}:${r ? r.outcome : 'missing'}`; runOutcomeCounts[key] = (runOutcomeCounts[key] || 0) + 1;
        if (!r) continue;
        const o = runOutcomes(p, r); if (o) runs.push({ k, ...o });
      }
      const fields = [OUTCOME_OF[p.stratum], ...SECONDARY[p.stratum], 'loop', 'declared_blank', 'body_letters'];
      const m = {}, s = {};
      for (const f of fields) { const v = runs.map((r) => r[f]).filter((x) => x != null); m[f] = v.length ? mean(v) : null; s[f] = v.length ? sd(v) : null; }
      if (p.stratum === 'S5') m.aligned_runs = runs.filter((r) => r.aligned).length;
      // length statistics exclude looped runs (#4610)
      const nl = runs.filter((r) => !r.loop).map((r) => r.body_chars); m.body_chars_nonloop = nl.length ? mean(nl) : null;
      byArm[arm] = { n_runs: runs.length, mean: m, sd: s, page_types: runs.map((r) => r.page_type) };
    }
    per.set(p.uid, byArm);
  }

  const strata = {};
  for (const S of ['S1', 'S2', 'S3', 'S4', 'S5']) {
    const sp = live.filter((p) => p.stratum === S);
    const f = OUTCOME_OF[S];
    let eligible = sp;
    const abstained = [];
    if (S === 'S5') {
      eligible = sp.filter((p) => { const a = per.get(p.uid).A; const ok = a.n_runs && (a.mean.aligned_runs || 0) >= 2; if (!ok) abstained.push(p.uid); return ok; });
    }
    const val = (p, arm, field = f) => per.get(p.uid)[arm]?.mean[field];
    const both = (a, b, field = f) => eligible.filter((p) => val(p, a, field) != null && val(p, b, field) != null);
    const armMean = (arm, field = f) => { const v = eligible.map((p) => val(p, arm, field)).filter((x) => x != null); return { mean: v.length ? r4(mean(v)) : null, n: v.length };
    };
    const spread = (arm, field = f) => { const v = eligible.map((p) => per.get(p.uid)[arm]?.sd[field]).filter((x) => x != null); return v.length ? r4(mean(v)) : null; };
    const aa = both('A', 'A2').map((p) => Math.abs(val(p, 'A') - val(p, 'A2')));
    const floor = aa.length ? r4(quantile(aa, 0.9)) : null;
    const pairAB = both('A', 'B');
    const dAB = pairAB.map((p) => val(p, 'A') - val(p, 'B')); // positive = B lower
    const wins = dAB.filter((x) => x > 1e-9).length, losses = dAB.filter((x) => x < -1e-9).length;
    const dAA = both('A', 'A2').map((p) => val(p, 'A') - val(p, 'A2'));
    const aaW = dAA.filter((x) => x > 1e-9).length, aaL = dAA.filter((x) => x < -1e-9).length;
    const secondary = {};
    for (const g of SECONDARY[S]) secondary[g] = Object.fromEntries(ARMS.map((a) => [a, { ...armMean(a, g), spread_k: spread(a, g) }]));
    strata[S] = {
      outcome: f, n_pages: sp.length, n_scored: eligible.length, abstained,
      arms: Object.fromEntries(ARMS.map((a) => [a, { ...armMean(a), spread_k: spread(a) }])),
      noise_floor_p90_abs_A_A2: floor, aa_pages: aa.length, aa_identical: aa.filter((x) => x === 0).length,
      aa_sign: { a_higher: aaW, a2_higher: aaL, p: r4(binomTwoSided(aaW, aaW + aaL)) },
      a_minus_b: { n: dAB.length, mean: r4(mean(dAB)), median: r4(median(dAB)), b_lower: wins, b_higher: losses, ties: dAB.length - wins - losses, sign_p: r4(binomTwoSided(wins, wins + losses)) },
      secondary,
      body_chars_nonloop: Object.fromEntries(ARMS.map((a) => [a, armMean(a, 'body_chars_nonloop')])),
      declared_blank: Object.fromEntries(ARMS.map((a) => [a, armMean(a, 'declared_blank')])),
    };
  }

  // loop: runs pooled over all strata (amendment 8)
  const loop = {};
  for (const arm of ARMS) {
    let k = 0, n = 0, pagesAny = 0;
    for (const p of live) { const a = per.get(p.uid)[arm]; if (!a?.n_runs) continue; n += a.n_runs; const lk = Math.round(a.mean.loop * a.n_runs); k += lk; if (lk) pagesAny++; }
    loop[arm] = { ...wilson(k, n), pages_with_a_looped_run: pagesAny };
  }

  // decision rule
  const s1 = strata.S1, s2 = strata.S2, s3 = strata.S3, s5 = strata.S5;
  const fl = (s) => s.noise_floor_p90_abs_A_A2 ?? 0;
  const clauses = {
    1: { name: 'S1 fabricated rate falls (primary)', test: `mean(A−B) ${s1.a_minus_b.mean} > floor ${fl(s1)} AND sign p ${s1.a_minus_b.sign_p} < 0.05`, pass: s1.a_minus_b.mean > fl(s1) && s1.a_minus_b.sign_p < 0.05 },
    2: { name: 'S3 false-blank guard', test: `B ${s3.arms.B.mean} − A ${s3.arms.A.mean} = ${r4(s3.arms.B.mean - s3.arms.A.mean)} ≤ max(floor ${fl(s3)}, 0.05)`, pass: s3.arms.B.mean - s3.arms.A.mean <= Math.max(fl(s3), 0.05) + 1e-12 },
    3: { name: 'S5 windowed-CER guard', test: `median(B−A) ${r4(-s5.a_minus_b.median)} ≤ floor ${fl(s5)}`, pass: -s5.a_minus_b.median <= fl(s5) + 1e-12 },
    4: { name: 'loop guard', test: `B Wilson lo ${loop.B.lo} ≤ A Wilson hi ${loop.A.hi}`, pass: loop.B.lo <= loop.A.hi },
    5: { name: 'S2 blank recall holds', test: `B ${s2.arms.B.mean} ≥ A ${s2.arms.A.mean} − floor ${fl(s2)}`, pass: s2.arms.B.mean >= s2.arms.A.mean - fl(s2) - 1e-12 },
  };
  const all = Object.values(clauses).every((c) => c.pass);

  // examples: candidate pages where A and A2 invent on every run and B never does (S1/S2), and S3 pages where B declares blank
  const examples = [];
  for (const p of live) {
    const a = per.get(p.uid);
    const firstText = (arm) => { for (let k = 1; k <= K; k++) { const r = reads.get(`${arm}:${p.uid}:${k}`); if (r?.text) return r.text; } return ''; };
    const link = p.book_id ? `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}` : p.image;
    if ((p.stratum === 'S1' || p.stratum === 'S2') && a.A.mean.fabricated === 1 && a.A2.mean.fabricated === 1 && a.B.mean.fabricated === 0)
      examples.push({ kind: 'fixed-fabrication', stratum: p.stratum, uid: p.uid, link, A: bodyText(firstText('A')).slice(0, 220), B: firstText('B').replace(/\s+/g, ' ').slice(0, 260) });
    if ((p.stratum === 'S1' || p.stratum === 'S2') && a.B.mean.fabricated > 0 && a.A.mean.fabricated < a.B.mean.fabricated)
      examples.push({ kind: 'new-fabrication-under-B', stratum: p.stratum, uid: p.uid, link, A: firstText('A').replace(/\s+/g, ' ').slice(0, 220), B: bodyText(firstText('B')).slice(0, 220) });
    if (p.stratum === 'S3' && (a.B.mean.false_blank > a.A.mean.false_blank))
      examples.push({ kind: 'over-decline-under-B', stratum: 'S3', uid: p.uid, link, source: p.source, A: bodyText(firstText('A')).slice(0, 220), B: firstText('B').replace(/\s+/g, ' ').slice(0, 260) });
  }

  const actual = rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0);
  const result = {
    issue: 4195, preregistration: 'scripts/eval/PREREGISTRATION-ocr-v18-blank-insert.md', at: new Date().toISOString(), model: MODEL, k: K, seed: SEED,
    prompts: est.prompts, generation: est.generation, image: est.image,
    batch_jobs: rec.jobs.map(({ arm, job_name, requests, outcomes, in_tokens, out_tokens, cost_usd, terminal_state }) => ({ arm, job_name, requests, outcomes, in_tokens, out_tokens, cost_usd: r4(cost_usd), terminal_state })),
    cost: { estimate_usd: est.usd, actual_usd: r4(actual) },
    pages: { drawn: pages.length, live: live.length, dropped_image_fetch: dropped },
    run_outcomes: runOutcomeCounts,
    strata, loop, decision: { clauses, all_pass: all, recommendation: all ? 'promote (recommendation only; the default is Derek\'s call)' : 'not established' },
    examples,
    per_page: live.map((p) => ({ uid: p.uid, stratum: p.stratum, book_id: p.book_id, page_number: p.page_number, source: p.source, language: p.language,
      arms: Object.fromEntries(ARMS.map((a) => [a, { n_runs: per.get(p.uid)[a].n_runs, ...Object.fromEntries(Object.entries(per.get(p.uid)[a].mean).map(([k, v]) => [k, r4(v)])), page_types: per.get(p.uid)[a].page_types }])) })),
  };
  fs.writeFileSync(RESULTS_JSON, JSON.stringify(result, null, 1));
  // raw reads + the drawn pages, for re-scoring without a re-buy
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, 'reads.jsonl.gz'), zlib.gzipSync(fs.readFileSync(F('reads.jsonl'))));
  writeJsonl(path.join(RESULTS_DIR, 'pages.jsonl'), pages.map(({ ref, ...p }) => ({ ...p, ref_chars: ref ? ref.length : undefined })));
  fs.copyFileSync(F('draw-log.json'), path.join(RESULTS_DIR, 'draw-log.json'));

  console.log(`\n== OCR v18 A/B (#4195)  model ${MODEL}  k=${K}  pages ${live.length} (dropped ${dropped.length})  cost $${r4(actual)} (est $${est.usd})`);
  console.log('run outcomes:', JSON.stringify(runOutcomeCounts));
  for (const [S, s] of Object.entries(strata)) {
    console.log(`\n[${S}] ${s.outcome}  n=${s.n_scored}/${s.n_pages}${s.abstained.length ? ` (abstained ${s.abstained.length})` : ''}  floor(p90|A−A2|)=${s.noise_floor_p90_abs_A_A2} (identical ${s.aa_identical}/${s.aa_pages})`);
    for (const a of ARMS) console.log(`   ${a.padEnd(3)} mean ${s.arms[a].mean}  spread_k ${s.arms[a].spread_k}  declared_blank ${s.declared_blank[a].mean}  body_nonloop ${s.body_chars_nonloop[a].mean}`);
    console.log(`   A−B: mean ${s.a_minus_b.mean} median ${s.a_minus_b.median}  B lower ${s.a_minus_b.b_lower} / B higher ${s.a_minus_b.b_higher} / tie ${s.a_minus_b.ties}  sign p ${s.a_minus_b.sign_p}`);
    for (const [g, v] of Object.entries(s.secondary)) console.log(`   ${g}: ${ARMS.map((a) => `${a} ${v[a].mean}`).join('  ')}`);
  }
  console.log('\nloop (runs, Wilson 95%):', ARMS.map((a) => `${a} ${loop[a].k}/${loop[a].n} [${loop[a].lo}, ${loop[a].hi}]`).join('  '));
  console.log('\ndecision:'); for (const [i, c] of Object.entries(clauses)) console.log(`  ${i}. ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.test}`);
  console.log(`  → ${result.decision.recommendation}`);
  console.log(`\nexamples: ${examples.length} (${JSON.stringify(examples.reduce((a, e) => ((a[e.kind] = (a[e.kind] || 0) + 1), a), {}))})`);
}

const STAGES = { draw: stageDraw, build: stageBuild, submit: stageSubmit, poll: stagePoll, score: stageScore };
const stage = Object.keys(STAGES).find((s) => flag(s));
if (!stage) { console.error(`usage: --${Object.keys(STAGES).join(' | --')}`); process.exit(2); }
await STAGES[stage]();
