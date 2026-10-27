#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/localize-metadata.mjs — the same title gloss into
 * the same map (`books.localized.<lang>.title`), but realtime, one call per book:
 * right for the ~100 books with an edition, about $14 for all ~70K live books.
 * scripts/batch/concept-abstracts.mjs — the Batch API submit/collect shape, the
 * spend gate and the usage rows this copies; it writes a per-page field, not a
 * book's title. Neither could be pointed at "every live book's title" (#7496).
 *
 * ── What it does ──────────────────────────────────────────────────────────────
 *
 * Writes a title gloss in <lang> for every live book that has none, through the
 * Gemini Batch API on flash-lite, TITLES_PER_REQUEST titles per request. A gloss
 * is chrome, not an edition: the card on /es shows it with the original title
 * beneath it, and the link still goes where hasLocalizedEdition() says. Books
 * WRITTEN in <lang> are skipped (their original already reads in it).
 *
 * Read side: `localizedTitle()` in src/lib/localized.ts. A gloss is written only
 * where none exists at collect time, so a hand-written or realtime gloss is never
 * overwritten. One sweep_log row per write (sweep `localize-titles-batch-<lang>`).
 *
 * ── Subcommands (state in --dir and in Mongo `localize_title_jobs`) ───────────
 *
 *   select  --dir D [--lang es] [--limit N]   Write D/books.jsonl (the books to gloss).
 *   submit  --dir D [--lang es] [--job-requests 400] [--max-usd 8]
 *           Asks the dial (or a lane-wide localize-titles envelope) before each job, prices it at submit on gemini_usage
 *           (one row per job), stops at --max-usd committed by this run.
 *   collect --dir D [--lang es]   Write finished jobs' glosses; close the usage rows. Free.
 *   status  --dir D [--lang es]
 *
 *   node --env-file=.env.production.local scripts/batch/localize-titles-batch.mjs select --dir /root/loc-es
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';
import { budgetAllowsDispatchScoped } from '../lib/spend-guard.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';
import { createThenDeleteInput, uploadBatchInputFile, streamBatchResponses } from '../lib/gemini-batch-input-file.mjs';
import { logUsage, completeBatchUsage, calculateUsageCost, outputTokensFrom } from '../workers/lib/supabase-usage-logger.mjs';

const args = process.argv.slice(2);
const CMD = args[0];
const arg = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const DIR = arg('--dir');
if (!DIR) { console.error('--dir D required'); process.exit(1); }
fs.mkdirSync(DIR, { recursive: true });

const LANGUAGE_NAMES = { es: 'Spanish' };
// The `books.language` values whose books are already in <lang> — mirrors
// NATIVE_EDITION_LANGUAGE in src/lib/localized.ts (anchored: "Spanish-Latin" is glossed).
const NATIVE = { es: /^(spanish|español|castilian|castellano)$/i };
const LANG = arg('--lang', 'es');
if (!LANGUAGE_NAMES[LANG]) { console.error(`--lang must be one of ${Object.keys(LANGUAGE_NAMES).join(', ')}`); process.exit(2); }
const LANGUAGE = LANGUAGE_NAMES[LANG];

const MODEL = 'gemini-3.1-flash-lite';
// v3 after reading two 200-title tests side by side (#7496). v1 translated well but
// cut "Opera" loose from its author, dropped shelfmarks and read Chinese 卷 sections
// as volumes. v2 fixed those in the prompt and broke more: it translated less, added
// authors everywhere, and replaced some Chinese titles with "Obras de <author>". So
// the volume and the "Obras de" check moved into code (volumeOf, acceptGloss).
const PROMPT_VERSION = 'localize-titles-v3';
const TITLES_PER_REQUEST = 40;
const OUT_TOKENS_PER_TITLE = 25;
const RUN = arg('--run', `localize-titles-${LANG}-7496`);
const SWEEP = `localize-titles-batch-${LANG}`;
const ENDPOINT = 'batch/localize-titles';
const JOBS = 'localize_title_jobs';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// No thinking: a title gloss needs none, and 3.x thinks (and bills it) by default.
const GEN_CONFIG = { temperature: 0.2, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } };

const HEAD = `You write catalogue title glosses for a digital library of historical primary sources.
For each book below give the ${LANGUAGE} gloss of its title: the short, natural title a ${LANGUAGE}-speaking reader would expect on a catalogue card, as a published ${LANGUAGE} translation would be titled.
Rules:
- Translate the MEANING of the title into ${LANGUAGE}, whatever its language (Latin, German, Chinese, English…). Keep the original wording only for a proper name or a work customarily cited by its original title (Picatrix, Syntagma musicum, Enchiridion).
- Proper names in their customary ${LANGUAGE} form (Iamblichus → Jámblico).
- The author is context only. Do not add the author's name, except when the whole title is just "Opera" / "Works" / "Œuvres" / "Werke": then "Obras de <author>".
- Keep a manuscript shelfmark exactly as written, in parentheses at the end: (Cod. Pal. germ. 109), (Vat.ebr.339).
- Leave out volume numbers and Chinese 卷 section numbers; they are added separately.
- Shorten long baroque titles to their main title. Do not add subtitles, dates, publishers or explanations.
Return ONLY a JSON array of strings, one gloss per book, in the same order (N items).`;

function buildPrompt(books) {
  const lines = books.map((b, i) => {
    const bits = [`${i + 1}. Original title: ${b.title}`];
    if (b.display_title && b.display_title !== b.title) bits.push(`English gloss: ${b.display_title}`);
    if (b.author) bits.push(`Author: ${b.author}`);
    if (b.language) bits.push(`Language: ${b.language}`);
    return bits.join(' | ');
  });
  return `${HEAD.replace('N items', `${books.length} items`)}\n\n${lines.join('\n')}`;
}

/** The volume a title names, from "(vol 18)", "Vol. 2", "Vol-VI" or a trailing "(三十)". */
const CJK_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cjkNumber(s) {
  // 三十五 → 35, 十二 → 12, 二十 → 20; anything else (百, 千) is left alone.
  if (!/^[一二三四五六七八九十]+$/.test(s)) return null;
  const [tens, units] = s.includes('十') ? s.split('十') : ['', s];
  return (s.includes('十') ? (tens ? CJK_NUM[tens] : 1) * 10 : 0) + (units ? CJK_NUM[units] : 0);
}
const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
function roman(s) { let n = 0; for (let i = 0; i < s.length; i++) { const v = ROMAN[s[i]], w = ROMAN[s[i + 1]] || 0; n += v < w ? -v : v; } return n; }
export function volumeOf(title) {
  const t = String(title || '');
  let m = t.match(/\(vol\.?\s*(\d+)\)\s*$/i) || t.match(/\bvol(?:ume)?[.\s-]*(\d+)\b/i);
  if (m) return Number(m[1]);
  m = t.match(/\b[Vv]ol(?:ume)?[.\s-]*([IVXLC]+)\b/);
  if (m) return roman(m[1]);
  m = t.match(/[(（]([一二三四五六七八九十]+)[)）]\s*$/);
  return m ? cjkNumber(m[1]) : null;
}

/** The gloss as stored: null when it fails a check the prompt cannot be trusted with. */
export function acceptGloss(book, raw) {
  let g = cleanGloss(raw);
  if (!g || g.length > 200) return null;
  // "Obras de <author>" only for a title that IS "works" (v2 replaced Chinese titles with it).
  // The full run rejected 354, mostly real collected works in words this list lacked
  // (Opere, Opuscula, Wercken, omnia): widened after reading them.
  if (/^obras de\b/i.test(g) && !/\b(opera|opere|opuscula|omnia|works|œuvres|oeuvres|werke|wercken|werken|obras|schriften)\b/i.test(book.title)) return null;
  g = g.replace(/[,(]?\s*vol(?:umen|úmenes|\.)?\s*[\dIVXLC-]+\)?\s*$/i, '').trim();
  // "Tengyur (Derge Tengyur, vol. 173)" loses its ")" with the volume: drop the open bracket too.
  if ((g.match(/\(/g) || []).length > (g.match(/\)/g) || []).length) g = g.slice(0, g.lastIndexOf('(')).replace(/[\s,:]+$/, '');
  if (!g) return null;
  const vol = volumeOf(book.title);
  return vol ? `${g}, volumen ${vol}` : g;
}

function cleanGloss(t) {
  return String(t || '').replace(/^["'«»\s]+|["'«»\s.]+$/g, '').replace(/\s+/g, ' ').trim();
}

/** Parsed glosses, or null when the response is not an array of the right length. */
function parseGlosses(text, n) {
  try {
    const arr = JSON.parse(String(text).replace(/^```(?:json)?\s*|```\s*$/g, ''));
    if (!Array.isArray(arr) || arr.length !== n) return null;
    return arr.map((s) => (typeof s === 'string' ? cleanGloss(s) : ''));
  } catch { return null; }
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const booksFile = path.join(DIR, 'books.jsonl');

async function* readRequests() {
  const rl = readline.createInterface({ input: fs.createReadStream(booksFile), crlfDelay: Infinity });
  let cur = []; let n = 0;
  for await (const l of rl) {
    if (!l.trim()) continue;
    cur.push(JSON.parse(l));
    if (cur.length >= TITLES_PER_REQUEST) { yield { n: n++, books: cur }; cur = []; }
  }
  if (cur.length) yield { n: n++, books: cur };
}

// ── select ──────────────────────────────────────────────────────────────────
async function select() {
  const limit = Number(arg('--limit', 0));
  const cursor = db.collection('books').find(
    { visible: true, pages_count: { $gt: 0 }, title: { $type: 'string', $ne: '' }, [`localized.${LANG}.title`]: { $exists: false } },
    { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1 }, batchSize: 2000 },
  ).sort({ id: 1 });
  if (limit) cursor.limit(limit);
  const out = fs.createWriteStream(booksFile);
  let n = 0; let native = 0;
  for await (const b of cursor) {
    if (!b.id) continue;
    if (NATIVE[LANG].test(String(b.language || '').trim())) { native++; continue; }
    out.write(JSON.stringify({ id: b.id, title: String(b.title).slice(0, 300), display_title: b.display_title ? String(b.display_title).slice(0, 300) : null, author: b.author ? String(b.author).slice(0, 120) : null, language: b.language || null }) + '\n');
    n++;
  }
  await new Promise((r) => out.end(r));
  // Rough price, the same arithmetic submit uses per job.
  let inTok = 0;
  for await (const r of readRequests()) inTok += Math.ceil(buildPrompt(r.books).length / 3.5);
  const est = calculateUsageCost(MODEL, inTok, n * OUT_TOKENS_PER_TITLE, true);
  console.log(`selected ${n} books (skipped ${native} written in ${LANGUAGE}); ~${inTok} input tokens; est $${est.toFixed(2)} → ${booksFile}`);
}

// ── submit ──────────────────────────────────────────────────────────────────
async function committedUsd() {
  const rows = await db.collection(JOBS).find({ run: RUN }).project({ est_usd: 1, actual_usd: 1, status: 1 }).toArray();
  return rows.reduce((s, j) => s + (j.status === 'collected' ? (j.actual_usd ?? j.est_usd ?? 0) : j.status === 'failed' ? 0 : (j.est_usd || 0)), 0);
}

async function createJob(body, displayName) {
  const fileName = await uploadBatchInputFile(body, displayName, KEY);
  return createThenDeleteInput({
    fileName, apiKey: KEY,
    create: async () => {
      for (let attempt = 0; ; attempt++) {
        const r = await fetch(`${API}/models/${MODEL}:batchGenerateContent?key=${KEY}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: { display_name: displayName, input_config: { file_name: fileName } } }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) return j;
        if (r.status === 429 && attempt < 3) { await sleep(60000 * (attempt + 1)); continue; }
        throw new Error(`batch create ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
      }
    },
  });
}

async function submit() {
  const jobReqs = Number(arg('--job-requests', 400));
  const maxUsd = Number(arg('--max-usd', 8));
  const jobs = db.collection(JOBS);
  await jobs.createIndex({ run: 1, status: 1 }).catch(() => {});
  const done = new Set((await jobs.find({ run: RUN, status: { $ne: 'failed' } }).project({ request_range: 1 }).toArray())
    .flatMap((j) => { const out = []; for (let k = j.request_range[0]; k <= j.request_range[1]; k++) out.push(k); return out; }));
  let batch = [];
  const flush = async () => {
    if (!batch.length) return true;
    const reqs = batch; batch = [];
    let inTok = 0; let titles = 0;
    const lines = reqs.map((r) => {
      const prompt = buildPrompt(r.books);
      inTok += Math.ceil(prompt.length / 3.5); titles += r.books.length;
      return JSON.stringify({ key: String(r.n), request: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: GEN_CONFIG } });
    });
    const estUsd = calculateUsageCost(MODEL, inTok, titles * OUT_TOKENS_PER_TITLE, true);
    const committed = await committedUsd();
    if (committed + estUsd > maxUsd) { console.log(`STOP: committed $${committed.toFixed(2)} + this job $${estUsd.toFixed(2)} > cap $${maxUsd}`); return false; }
    // Open on the global dial, or on a lane-wide envelope for this lane (set-scope --all-books
    // --lanes localize-titles --meter-endpoints batch/localize-titles). A book-scoped envelope
    // (envelopeIds set) does not cover a sweep over every live book, so it does not open this.
    const gate = await budgetAllowsDispatchScoped(db, 'localize-titles submit');
    if (!gate.allowed || gate.envelopeIds) { console.log('STOP: the daily dial is closed and no localize-titles envelope has room'); return false; }
    const jobId = `lt-${RUN}-${Date.now().toString(36)}`;
    let created;
    try { created = await createJob(lines.join('\n') + '\n', jobId); }
    catch (e) { console.error(`  ${jobId}: create failed: ${e.message}`); return false; }
    await jobs.insertOne({
      _id: jobId, run: RUN, lang: LANG, gemini_name: created.name, model: MODEL, status: 'submitted', created_at: new Date(),
      request_range: [reqs[0].n, reqs[reqs.length - 1].n], requests: reqs.length, titles, est_usd: +estUsd.toFixed(4), prompt_version: PROMPT_VERSION,
    });
    await logUsage({
      type: 'localize_titles', mode: 'batch', model: MODEL, book_id: null, page_count: 0, batch_job_id: jobId,
      input_tokens: 0, output_tokens: 0, status: 'submitted', endpoint: ENDPOINT, prompt_version: PROMPT_VERSION,
      cost_usd: +estUsd.toFixed(6),
    }, db);
    console.log(`submitted ${jobId} → ${created.name}: ${reqs.length} requests, ${titles} titles, est $${estUsd.toFixed(3)} (committed before $${committed.toFixed(2)})`);
    return true;
  };
  for await (const r of readRequests()) {
    if (done.has(r.n)) continue;
    batch.push(r);
    if (batch.length >= jobReqs && !(await flush())) return;
  }
  await flush();
}

// ── collect ─────────────────────────────────────────────────────────────────
async function batchState(name) {
  const r = await (await fetch(`${API}/${name}?key=${KEY}`)).json();
  return { state: r.metadata?.state || r.state || 'UNKNOWN', responsesFile: r.response?.responsesFile || r.metadata?.output?.responsesFile || null, stats: r.metadata?.batchStats || null };
}

async function collect() {
  const jobs = db.collection(JOBS);
  const todo = await jobs.find({ run: RUN, status: 'submitted' }).sort({ created_at: 1 }).toArray();
  if (!todo.length) { console.log('nothing to collect'); return; }
  const want = new Set(todo.flatMap((j) => { const o = []; for (let k = j.request_range[0]; k <= j.request_range[1]; k++) o.push(k); return o; }));
  const reqBooks = new Map();
  for await (const r of readRequests()) if (want.has(r.n)) reqBooks.set(r.n, r.books);
  for (const job of todo) {
    const st = await batchState(job.gemini_name);
    if (/FAILED|CANCELLED|EXPIRED/.test(st.state)) {
      await jobs.updateOne({ _id: job._id }, { $set: { status: 'failed', state: st.state, collected_at: new Date() } });
      await completeBatchUsage({ batch_job_id: job._id, model: MODEL, input_tokens: 0, output_tokens: 0, status: 'failed', error_message: st.state, insertIfMissing: false }, db);
      console.log(`${job._id}: ${st.state} — its requests go back to submit`);
      continue;
    }
    if (!/SUCCEEDED/.test(st.state) || !st.responsesFile) { console.log(`${job._id}: ${st.state} ${JSON.stringify(st.stats || {})}`); continue; }
    const claim = await jobs.updateOne({ _id: job._id, status: 'submitted' }, { $set: { status: 'collecting', collecting_at: new Date() } });
    if (!claim.modifiedCount) continue;
    const c = { responses: 0, unparsed: 0, errors: 0, empty: 0, rejected: 0, written: 0, already: 0 };
    const tok = { in: 0, out: 0 };
    let ops = []; let sweep = [];
    const flushOps = async () => {
      if (!ops.length) return;
      const res = await db.collection('books').bulkWrite(ops, { ordered: false });
      c.written += res.modifiedCount; c.already += ops.length - res.modifiedCount;
      // The filter skips books that gained a gloss since select; log only what was written.
      if (res.modifiedCount === ops.length) await recordSweepActions(db, sweep);
      else {
        const stored = new Map((await db.collection('books').find({ id: { $in: sweep.map((x) => x.book_id) } })
          .project({ id: 1, localized: 1 }).toArray()).map((b) => [b.id, b.localized?.[LANG]?.title]));
        await recordSweepActions(db, sweep.filter((x) => stored.get(x.book_id) === x.detail.gloss));
      }
      ops = []; sweep = [];
    };
    for await (const line of streamBatchResponses(st.responsesFile, KEY)) {
      c.responses++;
      const usage = line.response?.usageMetadata;
      tok.in += usage?.promptTokenCount || 0; tok.out += outputTokensFrom(usage);
      const books = reqBooks.get(Number(line.key ?? line.metadata?.key));
      if (!books || line.error || !line.response) { c.errors++; continue; }
      const text = line.response.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      const glosses = parseGlosses(text, books.length);
      if (!glosses) { c.unparsed++; continue; }
      books.forEach((b, i) => {
        if (!glosses[i]) { c.empty++; return; }
        const g = acceptGloss(b, glosses[i]);
        if (!g) { c.rejected++; return; }
        ops.push({ updateOne: {
          filter: { id: b.id, [`localized.${LANG}.title`]: { $exists: false } },
          update: { $set: { [`localized.${LANG}.title`]: g, updated_at: new Date() } },
        } });
        sweep.push({ sweep: SWEEP, book_id: b.id, action: 'set-localized-title', detail: { lang: LANG, gloss: g, job: job._id, model: MODEL, prompt_version: PROMPT_VERSION } });
      });
      if (ops.length >= 1000) await flushOps();
    }
    await flushOps();
    const actual = calculateUsageCost(MODEL, tok.in, tok.out, true);
    await completeBatchUsage({ batch_job_id: job._id, model: MODEL, input_tokens: tok.in, output_tokens: tok.out, status: tok.in ? 'success' : 'failed', type: 'localize_titles', mode: 'batch', endpoint: ENDPOINT }, db);
    await jobs.updateOne({ _id: job._id }, { $set: { status: 'collected', state: st.state, collected_at: new Date(), actual_usd: +actual.toFixed(4), counts: c, tokens: tok } });
    console.log(`${job._id}: ${JSON.stringify(c)} billed $${actual.toFixed(4)} (est $${job.est_usd})`);
  }
}

async function status() {
  const rows = await db.collection(JOBS).find({ run: RUN }).sort({ created_at: 1 }).toArray();
  for (const j of rows) console.log(`${j._id}  ${j.status}  ${j.titles} titles  est $${j.est_usd}${j.actual_usd != null ? `  billed $${j.actual_usd}` : ''}${j.counts ? `  ${JSON.stringify(j.counts)}` : ''}`);
  const live = await db.collection('books').countDocuments({ visible: true, pages_count: { $gt: 0 }, [`localized.${LANG}.title`]: { $type: 'string' } });
  console.log(`${rows.length} jobs, committed $${(await committedUsd()).toFixed(2)}; live books with a ${LANGUAGE} title: ${live}`);
}

try {
  if (CMD === 'select') await select();
  else if (CMD === 'submit') await submit();
  else if (CMD === 'collect') await collect();
  else if (CMD === 'status') await status();
  else { console.error('usage: select | submit | collect | status  --dir D [--lang es]'); process.exitCode = 1; }
} finally {
  await client.close();
}
