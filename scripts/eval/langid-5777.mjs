#!/usr/bin/env node
/**
 * langid-5777.mjs — name the script and language of every book whose `language` is
 * `und` / `Unknown`, from ONE interior page image per book (#5777).
 *
 * PRIOR ART: scripts/maintenance/detect-language-from-pages.mjs (#4696) and
 * scripts/audit/detect-book-languages.mjs (#4117) — both read the `<language>` tag out
 * of OCR TEXT, so they cannot see the ~95% of these pages that were never transcribed,
 * and both name a language, never a SCRIPT (the question here is "do we have a lane for
 * this writing system?"). This reads the IMAGE. Batch submit/collect shape follows
 * scripts/eval/illegible-gate-5305.mjs; fetching goes through scripts/lib/iiif-utils.mjs.
 *
 * READ-ONLY on Mongo. Writes nothing to `books` or `pages` (#4654, #4711, #5335 own
 * `books.language`). Output: scripts/eval/results/langid-5777/.
 *
 * Phases (each resumable):
 *   --pick               enumerate + choose candidate pages             FREE  → picks.jsonl
 *   --fetch [--round N]  download + downscale one image per book        FREE  → <work>/img, fetched.jsonl
 *   --submit [--round N] Batch job(s), gemini-3.1-flash-lite            PAID, needs --approved-usd ≥ estimate
 *            [--retry]   resubmit only the round's requests with no answer yet (cancelled / errored)
 *   --collect [--wait-min M]  poll, download, meter to gemini_usage     FREE  → raw.jsonl
 *   --ia-meta            archive.org `language` for the books whose page 403s (lending-only scans)
 *                                                                        FREE  → ia-metadata.jsonl
 *   --summary            one row per book + distribution                FREE  → results.jsonl, summary.json
 *
 * eye-check.jsonl is hand-written (the by-eye readings); --summary folds it in as `script_final`.
 *
 * Round 2 re-reads, on the next candidate page, the books whose round-1 page came back
 * blank / cover / no text / errored.
 *
 *   node --env-file=.env.production.local scripts/eval/langid-5777.mjs --pick
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { getPageSource, isUsableImageUrl } from '../lib/page-image-url.mjs';
import { rateLimitedFetch, capDomainLimit, repairIiifV3Size } from '../lib/iiif-utils.mjs';
import { priceFor, BATCH_MULTIPLIER } from '../lib/model-pricing.mjs';
import { createThenDeleteInput } from '../lib/gemini-batch-input-file.mjs';

const DIR = path.resolve('scripts/eval/results/langid-5777');
const WORK = process.env.LANGID_WORK_DIR || '/data/scratch/sl/langid-5777';
const IMG = path.join(WORK, 'img');
const MODEL = 'gemini-3.1-flash-lite';
const API = 'https://generativelanguage.googleapis.com';
const NO_LANGUAGE = ['und', 'Unknown'];
const TARGET_FRACTION = 0.4;
const MAX_EDGE = 1024;
const CHUNK = Number(process.env.LANGID_CHUNK || 150);
const SKIP_TYPES = /blank|cover|binding|endpaper|flyleaf|spine|colou?r.?(chart|target)|calibration/i;

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const opt = (f, d) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : d; };
const ROUND = Number(opt('round', 1));

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const inDir = (f) => path.join(DIR, f);
const writeJson = (f, o) => fs.writeFileSync(inDir(f), JSON.stringify(o, null, 2) + '\n');

export const PROMPT = `You are looking at one page from a digitised historical book or manuscript. Identify the writing on it. Do not transcribe it.

Return ONLY a JSON object with these keys:
- "script": the main writing system of the page's body text. Use one of: Latin, Greek, Cyrillic, Hebrew, Arabic, Syriac, Coptic, Ge'ez, Armenian, Georgian, Devanagari, Bengali, Gujarati, Gurmukhi, Tamil, Telugu, Kannada, Malayalam, Sinhala, Tibetan, Mongolian, Manchu, Han, Kana, Hangul, Thai, Lao, Khmer, Burmese, Javanese, Balinese, Batak, Samaritan, Glagolitic, Runic, Cuneiform, Egyptian hieroglyphs — or name another script exactly. Use "none" when the page carries no writing. Arabic script covers Persian, Ottoman Turkish and Urdu. Vertical script written in connected columns is Mongolian or Manchu: say which only if you can tell, otherwise "Mongolian or Manchu".
- "other_scripts": array of any other writing systems clearly present on the page (may be empty).
- "language": the language of the body text in English (e.g. "Latin", "German", "Classical Chinese", "Persian", "Ottoman Turkish", "Church Slavonic"). Use "unknown" if you can name the script but not the language, and "none" if there is no text.
- "production": "print", "manuscript", "mixed" (print with substantial handwriting), or "none".
- "content": "text" (mainly writing), "mostly_image" (a picture, map, diagram, music or table with little running text), "no_text" (blank page, cover, binding, colour chart, or image without writing).
- "confidence": your confidence in "script" AND "language" together, from 0 to 1.
- "note": at most 12 words on anything unusual (optional, may be "").`;

// ── --pick ─────────────────────────────────────────────────────────────────────────────────────

/** Candidate page numbers, nearest the 40% mark first: t, t+1, …, then t-1, t-2, … */
export function candidateOrder(pagesCount, k = 8) {
  const t = Math.min(pagesCount, Math.max(1, Math.round(pagesCount * TARGET_FRACTION)));
  const out = [];
  for (let d = 0; out.length < Math.min(k, pagesCount) && d <= pagesCount; d++) {
    if (t + d <= pagesCount) out.push(t + d);
    if (d > 0 && d > Math.floor(k / 2) && t - (d - Math.floor(k / 2)) >= 1) out.push(t - (d - Math.floor(k / 2)));
  }
  if (out.length < Math.min(k, pagesCount)) for (let p = t - 1; p >= 1 && out.length < Math.min(k, pagesCount); p--) if (!out.includes(p)) out.push(p);
  return out.slice(0, k);
}

/** The image the reader shows, at a size worth sending: the stored display variant, else the source. */
export function imageUrlFor(page) {
  const split = isUsableImageUrl(page.cropped_photo) || page.split_from_spread || page.crop;
  if (!split && isUsableImageUrl(page.display_photo)) return { url: page.display_photo, via: 'display_photo' };
  const src = getPageSource(page);
  if (!src) return null;
  if (/images\.sourcelibrary\.org/.test(src)) return { url: src, via: 'r2_source' };
  let url = repairIiifV3Size(src);
  if (/\/full\/(?:full|max|pct:\d+|\d+,\d*|,\d+)\/\d+\/(?:default|native)\./.test(url)) {
    url = url.replace(/\/full\/(?:full|max|pct:\d+|\d+,\d*|,\d+)\//, `/full/${MAX_EDGE},/`);
    return { url, via: 'iiif_sized' };
  }
  return { url, via: 'source' };
}

async function phasePick() {
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = await db.collection('books').find(
    { pages_count: { $gt: 0 }, language: { $in: NO_LANGUAGE } },
    { projection: { id: 1, title: 1, author: 1, language: 1, pages_count: 1, pages_ocr: 1, visible: 1, year: 1, 'image_source.provider': 1, contributing_library: 1 } },
  ).sort({ id: 1 }).toArray();
  console.log(`books with language in ${JSON.stringify(NO_LANGUAGE)} and pages_count > 0: ${books.length}`);
  const pages = db.collection('pages');
  const out = fs.createWriteStream(inDir('picks.jsonl'));
  let noCandidate = 0;
  for (const b of books) {
    const order = candidateOrder(b.pages_count);
    const docs = await pages.find({ book_id: b.id, page_number: { $in: order } }, {
      projection: { id: 1, page_number: 1, photo: 1, photo_original: 1, display_photo: 1, archived_photo: 1, enhanced_photo: 1, cropped_photo: 1, split_from_spread: 1, crop: 1, page_type: 1, 'image_characteristics.flags.is_blank': 1, 'ocr.data': 1, 'ocr.model': 1 },
    }).toArray();
    const byNum = new Map(docs.map((d) => [d.page_number, d]));
    const good = [], poor = [];
    for (const n of order) {
      const p = byNum.get(n); if (!p) continue;
      const img = imageUrlFor(p); if (!img) continue;
      const ocr = typeof p.ocr?.data === 'string' ? p.ocr.data : '';
      const tagType = /<page-type>([^<]*)<\/page-type>/.exec(ocr)?.[1] || null;
      const tagLang = /<language>([^<]*)<\/language>/.exec(ocr)?.[1] || null;
      const skip = !!p.image_characteristics?.flags?.is_blank || SKIP_TYPES.test(p.page_type || '') || SKIP_TYPES.test(tagType || '');
      (skip ? poor : good).push({ page_number: n, page_id: p.id, ...img, page_type: p.page_type || tagType || null, ocr_language_tag: tagLang, has_ocr: !!p.ocr?.model, flagged_blank_or_cover: skip });
    }
    const candidates = [...good, ...poor];
    if (!candidates.length) noCandidate++;
    out.write(JSON.stringify({
      book_id: b.id, title: b.title || null, author: b.author || null, stored_language: b.language, pages_count: b.pages_count,
      pages_ocr: b.pages_ocr || 0, visible: !!b.visible, year: b.year ?? null, provider: b.image_source?.provider || null,
      target_page: order[0], candidates,
    }) + '\n');
  }
  await new Promise((r) => out.end(r));
  await client.close();
  console.log(`picks.jsonl written; ${noCandidate} book(s) with no fetchable candidate page`);
}

// ── --fetch ────────────────────────────────────────────────────────────────────────────────────

async function phaseFetch() {
  fs.mkdirSync(IMG, { recursive: true });
  // digi.vatlib.it robots.txt asks for a crawl delay; the shared table's 3/s is the archiver's.
  capDomainLimit('digi.vatlib.it', Number(opt('vatican-rate', 0.25)));
  const picks = readJsonl(inDir('picks.jsonl'));
  const fetchedPath = path.join(WORK, 'fetched.jsonl');
  const fetched = readJsonl(fetchedPath);
  const doneThisRound = new Set(fetched.filter((f) => f.round === ROUND).map((f) => f.book_id));
  const usedPages = new Map();
  for (const f of fetched) { if (!usedPages.has(f.book_id)) usedPages.set(f.book_id, new Set()); for (const n of f.tried) usedPages.get(f.book_id).add(n); }
  let todo = picks.filter((p) => !doneThisRound.has(p.book_id));
  if (ROUND > 1) {
    const retry = new Set(needsAnotherPage(ROUND - 1));
    todo = todo.filter((p) => retry.has(p.book_id));
  }
  console.log(`round ${ROUND}: ${todo.length} book(s) to fetch`);
  let i = 0, ok = 0, failed = 0;
  const worker = async () => {
    for (;;) {
      const p = todo[i++]; if (!p) return;
      const used = usedPages.get(p.book_id) || new Set();
      const tried = []; let rec = null, lastErr = null;
      for (const c of p.candidates.filter((x) => !used.has(x.page_number)).slice(0, 3)) {
        tried.push(c.page_number);
        try {
          const buf = await rateLimitedFetch(c.url, { timeout: 60000, retries: 2 });
          const img = sharp(buf, { failOn: 'none' }).rotate();
          const small = await img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
          const st = await sharp(small.data).greyscale().stats();
          const stdev = +st.channels[0].stdev.toFixed(1);
          // A flat frame (blank leaf, uniform board) carries no writing to classify; try the next page.
          if (stdev < 5 && tried.length < 3) { lastErr = `flat image (stdev ${stdev})`; continue; }
          const file = `${p.book_id}.r${ROUND}.jpg`;
          fs.writeFileSync(path.join(IMG, file), small.data);
          rec = { book_id: p.book_id, round: ROUND, page_number: c.page_number, page_id: c.page_id, url: c.url, via: c.via, file, bytes: small.data.length, width: small.info.width, height: small.info.height, stdev, sha256: createHash('sha256').update(small.data).digest('hex').slice(0, 16), tried };
          break;
        } catch (e) { lastErr = e.message; }
      }
      if (!rec) { rec = { book_id: p.book_id, round: ROUND, page_number: null, error: lastErr || 'no untried candidate', tried }; failed++; } else ok++;
      fs.appendFileSync(fetchedPath, JSON.stringify(rec) + '\n');
      if ((ok + failed) % 50 === 0) console.log(`  ${ok + failed}/${todo.length} (${failed} failed)`);
    }
  };
  await Promise.all(Array.from({ length: Number(opt('concurrency', 6)) }, worker));
  console.log(`fetch round ${ROUND} done: ${ok} ok, ${failed} failed`);
}

// ── verdict parsing ────────────────────────────────────────────────────────────────────────────

export function parseVerdict(text) {
  if (!text) return null;
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return {
      script: String(j.script ?? '').trim() || 'none',
      other_scripts: Array.isArray(j.other_scripts) ? j.other_scripts.map(String) : [],
      language: String(j.language ?? '').trim() || 'unknown',
      production: String(j.production ?? '').trim().toLowerCase() || 'none',
      content: String(j.content ?? '').trim().toLowerCase() || 'text',
      confidence: Number.isFinite(Number(j.confidence)) ? Number(j.confidence) : null,
      note: String(j.note ?? '').slice(0, 160),
    };
  } catch { return null; }
}

const isUnread = (v) => !v || v.content === 'no_text' || /^none$/i.test(v.script);

/** Books whose round-N read gave nothing to classify (blank, cover, error, no row). */
function needsAnotherPage(round) {
  const raw = readJsonl(inDir('raw.jsonl')).filter((r) => r.round === round);
  const byBook = new Map();
  for (const r of raw) if (!byBook.has(r.book_id) || byBook.get(r.book_id).error) byBook.set(r.book_id, r); // an answer beats a cancelled attempt
  const fetched = readJsonl(path.join(WORK, 'fetched.jsonl')).filter((f) => f.round === round);
  const out = [];
  for (const f of fetched) {
    const r = byBook.get(f.book_id);
    if (!f.page_number || !r || r.error || isUnread(r.verdict)) out.push(f.book_id);
  }
  return out;
}

// ── --submit / --collect (Batch API, metered) ──────────────────────────────────────────────────

const batchKeyEnv = () => (process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY');
const batchRecPath = () => inDir('batch.json');
const loadBatchRec = () => (fs.existsSync(batchRecPath()) ? JSON.parse(fs.readFileSync(batchRecPath(), 'utf8')) : { model: MODEL, jobs: [] });

async function phaseSubmit() {
  const rec = loadBatchRec();
  const retry = has('retry');
  if (!retry && rec.jobs.some((j) => j.round === ROUND)) throw new Error(`round ${ROUND} already submitted (batch.json); --retry resubmits the unanswered`);
  if (rec.jobs.some((j) => !j.collected_at)) throw new Error('uncollected job(s) in batch.json; run --collect first');
  // A Batch job can end SUCCEEDED or CANCELLED with requests inside it answered "The operation was
  // cancelled." (translate-batch-seam.mjs records the same on 2026-09-24). --retry sends only those again.
  const answered = new Set(readJsonl(inDir('raw.jsonl')).filter((r) => !r.error).map((r) => `${r.book_id}:${r.page_number}`));
  const attempt = rec.jobs.filter((j) => j.round === ROUND).reduce((m, j) => Math.max(m, j.attempt || 1), 0) + 1;
  const items = readJsonl(path.join(WORK, 'fetched.jsonl')).filter((f) => f.round === ROUND && f.page_number && !answered.has(`${f.book_id}:${f.page_number}`));
  if (!items.length) { console.log('nothing to submit'); return; }
  // Estimate: one ≤1024px image (~1,100 tokens at default media resolution) + prompt (~450) in, ~90 out.
  const p = priceFor(MODEL);
  const estimate = items.length * BATCH_MULTIPLIER * ((1550 / 1e6) * p.input + (90 / 1e6) * p.output);
  const approved = Number(opt('approved-usd', 0));
  console.log(`round ${ROUND}: ${items.length} requests; ESTIMATE (Batch, ${MODEL}): $${estimate.toFixed(3)}`);
  if (!(approved >= estimate)) throw new Error(`--approved-usd ${approved} is below the estimate $${estimate.toFixed(3)}`);
  const envName = batchKeyEnv(), key = process.env[envName];
  if (!key) throw new Error(`${envName} not set`);
  for (let c = 0; c * CHUNK < items.length; c++) {
    const chunk = items.slice(c * CHUNK, (c + 1) * CHUNK);
    const jsonl = chunk.map((f) => JSON.stringify({
      key: `${f.book_id}:${f.page_number}`,
      request: {
        contents: [{ parts: [{ inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(path.join(IMG, f.file)).toString('base64') } }, { text: PROMPT }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 400, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
      },
    })).join('\n');
    const bytes = Buffer.byteLength(jsonl);
    const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'text/plain' },
      body: JSON.stringify({ file: { display_name: `langid-5777-r${ROUND}a${attempt}-${c}` } }),
    });
    if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
    const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: jsonl });
    if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
    const fileName = (await up.json()).file?.name;
    if (!fileName) throw new Error('upload response missing file.name');
    const job = await createThenDeleteInput({
      fileName, apiKey: key,
      create: async () => {
        const r = await fetch(`${API}/v1beta/models/${MODEL}:batchGenerateContent?key=${key}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: { display_name: `langid-5777-r${ROUND}a${attempt}-${c}`, input_config: { file_name: fileName } } }),
        });
        if (!r.ok) throw new Error(`batch create ${r.status} ${(await r.text()).slice(0, 500)}`);
        return r.json();
      },
    });
    rec.key_env = envName;
    rec.jobs.push({ round: ROUND, attempt, chunk: c, job_name: job.name, requests: chunk.length, input_mb: +(bytes / 1e6).toFixed(1), estimate_usd: +(estimate * chunk.length / items.length).toFixed(4), approved_usd: approved, submitted_at: new Date().toISOString() });
    writeJson('batch.json', rec);
    console.log(`submitted ${job.name} (${chunk.length} requests, ${(bytes / 1e6).toFixed(1)} MB)`);
  }
}

async function phaseCollect() {
  const rec = loadBatchRec();
  const key = process.env[rec.key_env];
  const waitMax = Number(opt('wait-min', 0)) * 60e3, t0 = Date.now();
  const round = new Map(readJsonl(path.join(WORK, 'fetched.jsonl')).map((f) => [`${f.book_id}:${f.page_number}`, f.round]));
  const p = priceFor(MODEL);
  for (;;) {
    let pending = 0;
    for (const j of rec.jobs) {
      if (j.collected_at) continue;
      const data = await (await fetch(`${API}/v1beta/${j.job_name}?key=${key}`)).json();
      const state = data.metadata?.state || data.state;
      console.log(`${j.job_name} ${state}`);
      const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
      if (!rf && /FAILED|CANCELLED|EXPIRED/.test(state || '')) {
        // A dead job hands back no responses file, so even its answered requests are lost; --submit --retry resends them.
        Object.assign(j, { collected_at: new Date().toISOString(), state, responses: 0, errors: j.requests, in_tokens: 0, out_tokens: 0, cost_usd: 0, batch_stats: data.metadata?.batchStats || null, dead: JSON.stringify(data.error || '').slice(0, 200) });
        writeJson('batch.json', rec);
        continue;
      }
      if (!rf) { pending++; continue; }
      const text = await (await fetch(`${API}/download/v1beta/${rf}:download?alt=media&key=${key}`)).text();
      let inTok = 0, outTok = 0, n = 0, errors = 0;
      for (const line of text.split('\n').filter(Boolean)) {
        const r = JSON.parse(line); const k = r.key || r.metadata?.key; const [book_id, page] = k.split(':');
        const resp = r.response, u = resp?.usageMetadata || {};
        const it = { book_id, page_number: Number(page), round: round.get(k) ?? j.round };
        if (r.error || !resp) { it.error = JSON.stringify(r.error || 'no response').slice(0, 300); errors++; }
        else {
          const out = (resp.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
          it.verdict = parseVerdict(out);
          it.finish = resp.candidates?.[0]?.finishReason || null;
          if (!it.verdict) { it.error = `unparseable: ${out.slice(0, 200)}`; errors++; }
          const i = u.promptTokenCount || 0, o = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
          inTok += i; outTok += o;
        }
        fs.appendFileSync(inDir('raw.jsonl'), JSON.stringify(it) + '\n'); n++;
      }
      Object.assign(j, { collected_at: new Date().toISOString(), state, responses: n, errors, in_tokens: inTok, out_tokens: outTok,
        cost_usd: +(BATCH_MULTIPLIER * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output)).toFixed(5) });
      console.log(`collected ${n} (${errors} errors) $${j.cost_usd}`);
      try {
        const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
        await logUsage({ type: 'eval', mode: 'batch', model: MODEL, page_count: n - errors, input_tokens: inTok, output_tokens: outTok, batch_job_id: j.job_name, endpoint: 'eval/langid-5777', triggered_by: 'manual', prompt_version: 'eval-5777-langid' });
      } catch (e) { console.warn(`logUsage failed: ${e.message}`); }
      writeJson('batch.json', rec);
    }
    if (!pending) { console.log(`all collected; actual $${rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4)}`); return; }
    if (Date.now() - t0 > waitMax) { console.log(`${pending} job(s) pending; re-run --collect`); return; }
    await new Promise((r) => setTimeout(r, 60e3));
  }
}

// ── --ia-meta ──────────────────────────────────────────────────────────────────────────────────

/** A lending-only archive.org scan serves no page image (HTTP 403), but its catalogue record names the language. */
async function phaseIaMeta() {
  const picks = readJsonl(inDir('picks.jsonl'));
  const fetchedOk = new Set(readJsonl(path.join(WORK, 'fetched.jsonl')).filter((f) => f.page_number).map((f) => f.book_id));
  const out = [];
  for (const p of picks.filter((x) => !fetchedOk.has(x.book_id))) {
    const ident = /archive\.org\/download\/([^/]+)\//.exec(p.candidates[0]?.url || '')?.[1];
    if (!ident) continue;
    try {
      const md = (await (await fetch(`https://archive.org/metadata/${ident}/metadata`)).json()).result || {};
      out.push({ book_id: p.book_id, ia_identifier: ident, ia_language: [].concat(md.language || []), ia_date: md.date || null, ia_access_restricted: md['access-restricted-item'] === 'true' });
    } catch (e) { out.push({ book_id: p.book_id, ia_identifier: ident, error: e.message }); }
    await new Promise((r) => setTimeout(r, 300));
  }
  fs.writeFileSync(inDir('ia-metadata.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  console.log(`ia-metadata.jsonl: ${out.length} rows`);
}

// ── --summary ──────────────────────────────────────────────────────────────────────────────────

/** Fold the model's free-text script names onto one label per writing system. */
export function normScript(s) {
  const t = String(s || '').trim();
  if (!t || /^(none|n\/a|null)$/i.test(t)) return 'none';
  if (/mongolian or manchu/i.test(t)) return 'Mongolian or Manchu';
  const table = [[/^latin/i, 'Latin'], [/^greek/i, 'Greek'], [/cyrillic/i, 'Cyrillic'], [/^hebrew/i, 'Hebrew'], [/^(arabic|perso)/i, 'Arabic'], [/syriac/i, 'Syriac'], [/coptic/i, 'Coptic'],
    [/ge.?ez|ethiopic/i, "Ge'ez"], [/armenian/i, 'Armenian'], [/georgian/i, 'Georgian'], [/devanagari/i, 'Devanagari'], [/tibetan/i, 'Tibetan'], [/^manchu/i, 'Manchu'], [/^mongol/i, 'Mongolian'],
    [/^(han|chinese|cjk)/i, 'Han'], [/kana|japanese/i, 'Kana'], [/hangul|korean/i, 'Hangul']];
  for (const [re, name] of table) if (re.test(t)) return name;
  return t;
}

function phaseSummary() {
  const picks = readJsonl(inDir('picks.jsonl'));
  const fetched = readJsonl(path.join(WORK, 'fetched.jsonl'));
  const raw = readJsonl(inDir('raw.jsonl'));
  const eye = new Map(readJsonl(inDir('eye-check.jsonl')).map((e) => [e.book_id, e]));
  const ia = new Map(readJsonl(inDir('ia-metadata.jsonl')).map((e) => [e.book_id, e]));
  const rows = [];
  for (const p of picks) {
    const reads = raw.filter((r) => r.book_id === p.book_id).sort((a, b) => a.round - b.round);
    const usable = reads.filter((r) => !r.error && !isUnread(r.verdict));
    const best = usable[0] || reads.filter((r) => !r.error).at(-1) || null; // first page that carried writing, else the last look
    const f = best ? fetched.find((x) => x.book_id === p.book_id && x.page_number === best.page_number) : fetched.filter((x) => x.book_id === p.book_id).at(-1);
    const v = best?.verdict || null;
    const cand = p.candidates.find((c) => c.page_number === best?.page_number);
    const e = eye.get(p.book_id);
    // Turfan fragments (Berlin shelfmarks M / MIK / So, via IDP): the model's script label is not usable there —
    // by eye 1 of 9 right, at confidence 0.8–1.0 — so they are one stratum, named from the shelfmark.
    const turfan = p.provider === 'idp_dunhuang';
    const scriptModel = v ? normScript(v.script) : null;
    const scriptFinal = !v || isUnread(v) ? null : turfan ? 'Turfan fragment (script unverified)' : e?.script_verdict === 'disagree' ? e.eye_script : scriptModel;
    rows.push({
      book_id: p.book_id, title: p.title, stored_language: p.stored_language, provider: p.provider, visible: p.visible,
      pages_count: p.pages_count, pages_ocr: p.pages_ocr, page_number: best?.page_number ?? null, image_url: f?.url || null, image_via: f?.via || null,
      rounds: reads.length, status: v ? (isUnread(v) ? 'no_text_found' : 'classified') : (f?.error ? 'fetch_failed' : 'no_verdict'),
      script: scriptModel, script_final: scriptFinal, script_final_basis: !scriptFinal ? null : turfan ? 'stratum' : e && e.script_verdict !== 'unjudged' ? 'by eye' : 'model',
      language_final: !scriptFinal ? null : turfan ? 'unknown' : e?.language_verdict === 'disagree' ? e.eye_language : (v?.language ?? null),
      ia_language: ia.get(p.book_id)?.ia_language ?? null, script_raw: v?.script ?? null, other_scripts: v?.other_scripts ?? [], language: v?.language ?? null,
      production: v?.production ?? null, content: v?.content ?? null, confidence: v?.confidence ?? null, note: v?.note || '',
      ocr_language_tag: cand?.ocr_language_tag ?? null, error: !v ? (reads.at(-1)?.error || f?.error || null) : null, model: MODEL,
    });
  }
  fs.writeFileSync(inDir('results.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const tally = (keyFn, src = rows) => {
    const m = new Map();
    for (const r of src) { const k = keyFn(r); const e = m.get(k) || { books: 0, pages: 0, pages_ocr: 0 }; e.books++; e.pages += r.pages_count; e.pages_ocr += r.pages_ocr; m.set(k, e); }
    return Object.fromEntries([...m].sort((a, b) => b[1].books - a[1].books));
  };
  const cls = rows.filter((r) => r.status === 'classified');
  const rec = loadBatchRec();
  const summary = {
    generated_at: new Date().toISOString(), model: MODEL, filter: { language: NO_LANGUAGE, pages_count: '> 0' },
    books: rows.length, pages: rows.reduce((s, r) => s + r.pages_count, 0), pages_ocr: rows.reduce((s, r) => s + r.pages_ocr, 0),
    by_stored_language: tally((r) => r.stored_language), by_status: tally((r) => r.status),
    by_script_final: tally((r) => r.script_final, cls), by_language_final: tally((r) => r.language_final, cls), by_script_language_final: tally((r) => `${r.script_final} / ${r.language_final}`, cls),
    by_script_production_final: tally((r) => `${r.script_final} / ${r.production}`, cls),
    by_script_model: tally((r) => r.script, cls), by_language_model: tally((r) => r.language, cls),
    turfan_fragments_model_labels: tally((r) => r.script, cls.filter((r) => r.provider === 'idp_dunhuang')),
    turfan_fragments_by_shelfmark: tally((r) => (/^[A-Za-z]+/.exec(r.title || '')?.[0] || '(none)'), rows.filter((r) => r.provider === 'idp_dunhuang')),
    fetch_failed_ia_language: tally((r) => (r.ia_language || ['(not archive.org)']).join('+'), rows.filter((r) => r.status === 'fetch_failed')),
    ocr_tag_check: (() => { const t = cls.filter((r) => r.ocr_language_tag && r.provider !== 'idp_dunhuang'); const norm = (x) => String(x).toLowerCase().split(/[\s,;/(]/)[0]; return { books_with_ocr_language_tag: t.length, model_language_matches_tag: t.filter((r) => norm(r.ocr_language_tag) === norm(r.language)).length }; })(),
    eye_check: (() => { const a = [...eye.values()]; const c = (f) => a.filter(f).length; const st = (o) => o.set === 'stratified'; return {
      stratified: { books: c(st), script_agree: c((o) => st(o) && o.script_verdict === 'agree'), script_disagree: c((o) => st(o) && o.script_verdict === 'disagree'), unjudged: c((o) => st(o) && o.script_verdict === 'unjudged') },
      stratified_excluding_turfan: { books: c((o) => st(o) && o.provider !== 'idp_dunhuang'), script_agree: c((o) => st(o) && o.provider !== 'idp_dunhuang' && o.script_verdict === 'agree'), script_disagree: c((o) => st(o) && o.provider !== 'idp_dunhuang' && o.script_verdict === 'disagree'), unjudged: c((o) => st(o) && o.provider !== 'idp_dunhuang' && o.script_verdict === 'unjudged') },
      stratified_turfan: { books: c((o) => st(o) && o.provider === 'idp_dunhuang'), script_agree: c((o) => st(o) && o.provider === 'idp_dunhuang' && o.script_verdict === 'agree'), script_disagree: c((o) => st(o) && o.provider === 'idp_dunhuang' && o.script_verdict === 'disagree') },
      rare_label_follow_up: { books: c((o) => !st(o)), script_agree: c((o) => !st(o) && o.script_verdict === 'agree'), script_disagree: c((o) => !st(o) && o.script_verdict === 'disagree'), unjudged: c((o) => !st(o) && o.script_verdict === 'unjudged') },
    }; })(),
    by_production: tally((r) => r.production, cls), by_content: tally((r) => r.content, cls), by_provider: tally((r) => r.provider),
    low_confidence_books: cls.filter((r) => r.confidence != null && r.confidence < 0.7).length,
    spend: { jobs: rec.jobs.length, requests: rec.jobs.reduce((s, j) => s + (j.responses || 0), 0), in_tokens: rec.jobs.reduce((s, j) => s + (j.in_tokens || 0), 0), out_tokens: rec.jobs.reduce((s, j) => s + (j.out_tokens || 0), 0), cost_usd: +rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4) },
  };
  writeJson('summary.json', summary);
  const flat = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v.books}b/${v.pages}p`).join(' | ');
  for (const k of ['by_status', 'turfan_fragments_by_shelfmark', 'by_script_final', 'by_language_final', 'by_script_production_final', 'by_content', 'fetch_failed_ia_language']) console.log(`${k} → ${flat(summary[k])}`);
  console.log(JSON.stringify({ books: summary.books, pages: summary.pages, ocr_tag_check: summary.ocr_tag_check, eye_check: summary.eye_check, spend: summary.spend }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(DIR, { recursive: true });
  if (has('pick')) await phasePick();
  else if (has('fetch')) await phaseFetch();
  else if (has('submit')) await phaseSubmit();
  else if (has('collect')) await phaseCollect();
  else if (has('ia-meta')) await phaseIaMeta();
  else if (has('summary')) phaseSummary();
  else console.log('usage: --pick | --fetch [--round N] | --submit [--round N] --approved-usd X | --collect [--wait-min M] | --ia-meta | --summary');
}
