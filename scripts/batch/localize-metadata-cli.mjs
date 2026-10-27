#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/localize-metadata.mjs — the realtime (paid API) writer of these two fields, one call
// per book per field; its prompts (localizeSummary, localizeChapters) and checks are the base here. scripts/batch/
// localize-titles-batch.mjs — the many-books-per-request sibling for titles (write only where the field is missing,
// sweep_log rows). scripts/lib/agy-cli.mjs + scripts/batch/cli-translate.mjs — the subscription CLI call, the tool
// gate, the sentinels and the stop-on-quota rule. None of them writes summaries and chapters for every live book at $0.
/**
 * Spanish (--lang=es, the default) or Simplified Chinese (--lang=zh) summaries and chapter titles for live books, through
 * the Gemini subscription CLI (`agy -p`), many books per call (#7496). Read side: the book page (/es/book/<slug>,
 * /zh/book/<slug>) shows `books.localized.<lang>.summary` and
 * `.chapters` (aligned by index with `books.chapters[]`, '' = fall back to the English title), else the English text
 * labelled as English.
 *
 *   count [--lang=es|zh]
 *   run   --field=summary|chapters [--lang=es|zh] [--limit=N] [--apply] [--concurrency=4] [--out=DIR] [--book-ids=a,b]
 *         Dry run unless --apply: the calls are made either way, and every result (English beside the translation, verdict) is
 *         appended to DIR/<lang>-<field>-results.jsonl so a dry run can be read and then written without calling again.
 *   apply --field=summary|chapters --from=DIR/<lang>-<field>-results.jsonl
 *         Writes the accepted results of an earlier run (a dry run read by eye). Re-checks that the English source is
 *         unchanged and the field still missing.
 *
 * Selection: visible, pages_count > 0, an English source (summary: index.bookSummary.brief, else `summary` or
 * `summary.data`; chapters: `titleEn || title` per entry), the field missing in <lang>, the book not written in <lang>;
 * most-read first. A write filters on the field still being missing, so an existing gloss is never overwritten and the
 * missing-field filter is the resume point. A book rejected twice (DIR/<lang>-<field>-rejected.jsonl) is not asked again.
 *
 * Calls: one per pack of books (about 12K characters of English for summaries, 16K for chapter lists, at most 30 books). Each call is counted in
 * DIR/calls.jsonl; the run stops at --max-calls-day (UTC day, default 1200) or --max-calls-total (default 4500, every language together: one ledger per DIR), and on
 * the first quota reply (exit 3), never retrying into it. Model: agy-guard's default, gemini-3.8-flash-low.
 *
 *   node --env-file=.env.production.local scripts/batch/localize-metadata-cli.mjs run --field=summary --limit=30 --out=$JOB_SCRATCH
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { CLI, gatedTextCall, TRANSLATE_SUFFIX } from '../lib/agy-cli.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const CMD = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const has = (f) => process.argv.includes(`--${f}`);
const FIELD = arg('field');
const APPLY = has('apply');
const OUT = path.resolve(arg('out', process.env.JOB_SCRATCH || path.join(os.tmpdir(), 'localize-metadata-cli')));
const MODEL = 'gemini-3.8-flash-low';
const LANG = arg('lang', 'es');
// Per language: its name, the `books.language` values whose readers read the original (skipped), and the examples the
// prompts give. es: localize-titles-batch.mjs NATIVE. zh: src/lib/localized.ts NATIVE_EDITION_LANGUAGE.zh, plus
// Classical/Literary Chinese, whose readers on /zh read the original too (#7496).
const LANGS = {
  es: {
    name: 'Spanish',
    native: /^\s*(spanish|espa(?:ñ|n)ol|castilian|castellano)\s*$/i,
    names: 'Iamblichus → Jámblico, Paracelsus → Paracelso, Hermes Trismegistus → Hermes Trismegisto, Albertus Magnus → Alberto Magno',
    style: 'Standard, neutral Spanish with correct accents and Spanish quotation marks or the source\'s.',
    contents: '"Chapter IV" → "Capítulo IV", "Book II" → "Libro II", "Part 1" → "Parte 1", "Preface" → "Prefacio", "Index" → "Índice"',
  },
  zh: {
    name: 'Simplified Chinese',
    native: /^\s*((classical|literary|traditional|simplified)\s+)?(chinese|zho|chi|mandarin|cmn)\s*$/i,
    names: 'Iamblichus → 杨布里科斯, Paracelsus → 帕拉塞尔苏斯, Hermes Trismegistus → 赫尔墨斯·特里斯墨吉斯忒斯, Albertus Magnus → 大阿尔伯特, Robert Fludd → 罗伯特·弗拉德',
    style: 'Standard written Simplified Chinese (简体中文), full-width punctuation; a translated book title in 《》.',
    contents: '"Chapter IV" → "第四章", "Book II" → "第二卷", "Part 1" → "第一部分", "Preface" → "序言", "Index" → "索引"',
  },
};
if (!LANGS[LANG]) { console.error(`--lang must be one of ${Object.keys(LANGS).join(', ')}`); process.exit(2); }
const L = LANGS[LANG];
const LANGUAGE = L.name;
const NATIVE = L.native;
const SWEEP = `localize-metadata-cli-${LANG}`;
const PROMPT_VERSION = { summary: `${LANG}-summary-cli-v1`, chapters: `${LANG}-chapters-cli-v1` };
const MAX_CALLS_DAY = Number(arg('max-calls-day', 1200));
// One ledger for every language run from the same --out: Derek's cap is 4,500 calls for es + zh together (#7496).
const MAX_CALLS_TOTAL = Number(arg('max-calls-total', 4500));
const CONCURRENCY = Number(arg('concurrency', 4));
// 24K-character chapter packs came back cut before <<<END>>> on 36 of 302 calls (2026-10-27): 16K is the size the gate passed.
const PACK_CHARS = { summary: 12000, chapters: 16000 };
const PACK_BOOKS = 30;
const CHAPTER_PART = 250; // a book with more entries is sent in parts of this many, and written only when every part passes
const CALL_LOG = '/var/log/sourcelibrary/agy-calls.jsonl';
const JOB = process.env.CLI_JOB_NAME || 'localize-metadata-cli-7496';

if (!['run', 'apply', 'count'].includes(CMD) || (CMD !== 'count' && !['summary', 'chapters'].includes(FIELD))) {
  console.error('usage: localize-metadata-cli.mjs count | run --field=summary|chapters [--lang=es|zh] [--limit=N] [--apply] | apply --field=… --from=FILE');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const LEDGER = path.join(OUT, 'calls.jsonl');
const RESULTS = path.join(OUT, `${LANG}-${FIELD}-results.jsonl`);
const REJECTED = path.join(OUT, `${LANG}-${FIELD}-rejected.jsonl`);

const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
function callsUsed() {
  const rows = readJsonl(LEDGER);
  const today = new Date().toISOString().slice(0, 10);
  return { total: rows.length, today: rows.filter((r) => r.ts.startsWith(today)).length };
}

// ── sources ────────────────────────────────────────────────────────────────
export function summarySource(b) {
  const s = b.index?.bookSummary?.brief || (typeof b.summary === 'string' ? b.summary : b.summary?.data);
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}
export function chapterSource(b) {
  const t = (b.chapters || []).map((c) => String(c?.titleEn || c?.title || '').trim());
  return t.some(Boolean) ? t : null;
}

// ── prompts (localize-metadata.mjs's rules, many books per call) ──────────────
const SUMMARY_HEAD = `You translate short catalogue summaries of historical books into ${LANGUAGE}, for a digital library of primary sources.
Rules:
- Translate each summary faithfully, sentence by sentence: same length and same register (editorial, concise). Do not add, drop, soften or embellish anything; no marketing.
- Proper names in their customary ${LANGUAGE} form where one exists (${L.names}); otherwise keep the name as written.
- A book title in its original language stays as written; an English rendering of a title (often in parentheses) is translated into ${LANGUAGE}.
- ${L.style}
The input is a JSON object mapping a book id to its English summary. Return ONE JSON object with exactly the same keys, each mapped to its ${LANGUAGE} translation (a plain string).`;

const CHAPTERS_HEAD = `You translate table-of-contents entries of historical books into ${LANGUAGE}, for a digital library of primary sources.
Rules:
- Each list is one book's contents, in order. Return the same number of entries in the same order: never merge, split, drop or reorder entries. An empty string stays an empty string.
- Translate the meaning, concisely, as a ${LANGUAGE} edition would print its contents: ${L.contents}. Keep numerals, folio and page numbers exactly as written.
- Proper names in their customary ${LANGUAGE} form where one exists (${L.names}); a Latin or other foreign term used as a name or title stays as written.
- Do not add explanations, quotation marks or numbering that is not there.
The input is a JSON object mapping a key to a list of English entries. Return ONE JSON object with exactly the same keys, each mapped to a JSON array of ${LANGUAGE} strings of the same length.`;

function buildPrompt(field, input) {
  return `${field === 'summary' ? SUMMARY_HEAD : CHAPTERS_HEAD}\n\n${JSON.stringify(input, null, 1)}` + TRANSLATE_SUFFIX;
}

// ── checks ───────────────────────────────────────────────────────────────────
const EN_WORDS = new Set(['the', 'and', 'of', 'which', 'with', 'this', 'that', 'is', 'are', 'was', 'from', 'by', 'its', 'into', 'work', 'book']);
const ES_WORDS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'que', 'en', 'un', 'una', 'por', 'con', 'su', 'sus', 'se', 'es', 'para', 'como', 'al']);
function englishShare(text) {
  const w = String(text).toLowerCase().match(/[a-záéíóúñü]+/g) || [];
  if (w.length < 8) return { en: 0, es: 1 };
  return { en: w.filter((x) => EN_WORDS.has(x)).length / w.length, es: w.filter((x) => ES_WORDS.has(x)).length / w.length };
}

const CJK = /[\u3400-\u9fff]/g;
/** Share of a text's letters that are CJK ideographs (Latin letters count against it). */
function cjkShare(text) {
  const c = (String(text).match(CJK) || []).length;
  const l = (String(text).match(/[A-Za-z]/g) || []).length;
  return c + l ? c / (c + l / 4) : 0; // ~4 Latin letters to a word, one ideograph to a syllable
}

/** null when the summary in LANG may be written, else why not. */
export function summaryProblem(en, es, title = '', lang = 'es') {
  if (typeof es !== 'string' || !es.trim()) return 'empty';
  const t = es.trim();
  // "[Arabic] Alphabetum arabicum …" opens many summaries; JSON opens with {" or [".
  if (/<<<|```|^\s*(\{\s*"|\[\s*")/.test(t)) return 'wrapper or JSON left in the text';
  if (t === en.trim()) return 'identical to the English';
  const r = t.length / en.length;
  // Chinese runs about a third of the English in characters.
  const [lo, hi] = lang === 'zh' ? [0.15, 0.9] : [0.75, 1.8];
  if (r < lo || r > hi) return `length ${t.length} vs English ${en.length}`;
  // A title in English is kept as written ("The pictorial key to the tarot … es un manual"): not English prose. It is
  // the book's title, or whatever opening the Spanish copies verbatim from the English.
  const tt = String(title || '').trim();
  let body = tt.length > 10 && t.includes(tt) ? t.replace(tt, ' ') : t;
  let k = 0;
  while (k < en.length && k < body.length && en[k] === body[k]) k++;
  if (k >= 15) body = body.slice(k);
  if (lang === 'zh') { const z = cjkShare(body); return z < 0.6 ? `does not read as Chinese (cjk ${z.toFixed(2)})` : null; }
  const s = englishShare(body);
  if (s.en > 0.06 || s.es < 0.12) return `does not read as ${LANGUAGE} (en ${s.en.toFixed(2)}, es ${s.es.toFixed(2)})`;
  return null;
}

/** null when the entries in LANG may be written, else why not. */
export function chaptersProblem(en, es, lang = 'es') {
  if (!Array.isArray(es)) return 'not an array';
  if (es.length !== en.length) return `${es.length} entries for ${en.length}`;
  if (!es.every((x) => typeof x === 'string')) return 'non-string entry';
  let same = 0, wordy = 0;
  for (let i = 0; i < en.length; i++) {
    const a = en[i], b = es[i].trim();
    if (!a) continue;
    if (!b) return `entry ${i} empty`;
    if (b.length > a.length * 3 + 30) return `entry ${i} far longer than its English`;
    if (/<<<|```/.test(b)) return `entry ${i} carries a wrapper`;
    if (a.split(/\s+/).length >= 4) { wordy++; if (a.toLowerCase() === b.toLowerCase()) same++; }
  }
  if (wordy >= 3 && same / wordy > 0.3) return `${same} of ${wordy} entries left in English`;
  if (lang === 'zh') {
    // A wordy English entry must come back with ideographs in it.
    const bare = en.filter((a, i) => a && a.split(/\s+/).length >= 4 && !/[\u3400-\u9fff]/.test(es[i])).length;
    return wordy >= 3 && bare / wordy > 0.3 ? `${bare} of ${wordy} entries have no Chinese` : null;
  }
  const s = englishShare(es.join(' . '));
  if (s.en > 0.08) return `reads as English (en ${s.en.toFixed(2)})`;
  return null;
}

/** Strip a code fence and parse the object the model returned. */
function parseReply(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { const o = JSON.parse(t); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}

// ── Mongo ────────────────────────────────────────────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const LIVE = { visible: true, pages_count: { $gt: 0 } };
const SOURCE_FILTER = {
  summary: { $or: [{ 'index.bookSummary.brief': { $type: 'string', $ne: '' } }, { summary: { $type: 'string', $ne: '' } }, { 'summary.data': { $type: 'string', $ne: '' } }] },
  chapters: { 'chapters.0': { $exists: true } },
};
const PROJECTION = {
  summary: { _id: 0, id: 1, slug: 1, title: 1, language: 1, read_count: 1, 'index.bookSummary.brief': 1, summary: 1 },
  chapters: { _id: 0, id: 1, slug: 1, title: 1, language: 1, read_count: 1, 'chapters.title': 1, 'chapters.titleEn': 1 },
};
const missing = (field) => ({ [`localized.${LANG}.${field}`]: { $exists: false } });
const sourceOf = (field, b) => (field === 'summary' ? summarySource(b) : chapterSource(b));

async function writeOne(field, b, value, cliVersion) {
  const r = await books.updateOne({ id: b.id, ...LIVE, ...missing(field) }, { $set: { [`localized.${LANG}.${field}`]: value, updated_at: new Date() } });
  if (!r.modifiedCount) return false;
  await recordSweepActions(db, [{
    sweep: SWEEP, book_id: b.id, action: `set-localized-${field}`,
    detail: { lang: LANG, model: MODEL, prompt_version: PROMPT_VERSION[field], cli: `${CLI} ${cliVersion}`, ...(field === 'summary' ? { chars: value.length } : { entries: value.length }) },
  }]);
  return true;
}

if (CMD === 'count') {
  for (const field of ['summary', 'chapters']) {
    const q = { ...LIVE, ...SOURCE_FILTER[field], language: { $not: NATIVE } };
    const [eligible, done] = await Promise.all([books.countDocuments(q), books.countDocuments({ ...q, [`localized.${LANG}.${field}`]: { $exists: true } })]);
    const rej = new Set(readJsonl(path.join(OUT, `${LANG}-${field}-rejected.jsonl`)).map((r) => r.id));
    console.log(`${field}: ${eligible} eligible (not ${LANGUAGE}), ${done} have localized.${LANG}.${field}, ${eligible - done} to go; ${rej.size} rejected at least once`);
  }
  const u = callsUsed(); // every language together
  console.log(`calls: ${u.today} today (cap ${MAX_CALLS_DAY}), ${u.total} total (cap ${MAX_CALLS_TOTAL}) in ${LEDGER}`);
  await client.close();
  process.exit(0);
}

const cliVersion = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';

if (CMD === 'apply') {
  const from = arg('from');
  if (!from) { console.error('--from=FILE required'); process.exit(2); }
  const rows = readJsonl(from).filter((r) => r.field === FIELD && !r.problem);
  let written = 0, changed = 0, already = 0;
  for (const r of rows) {
    const b = await books.findOne({ id: r.id }, { projection: PROJECTION[FIELD] });
    if (!b || JSON.stringify(sourceOf(FIELD, b)) !== JSON.stringify(r.en)) { changed++; console.log(`  skip ${r.id}: English source changed or book gone`); continue; }
    if (!APPLY) { written++; continue; }
    if (await writeOne(FIELD, b, r.es, r.cli_version || cliVersion)) written++; else already++;
  }
  console.log(`${APPLY ? 'written' : 'would write'} ${written}, source changed ${changed}, already had the field ${already}${APPLY ? '' : ' (dry; add --apply)'}`);
  await client.close();
  process.exit(0);
}

// ── run ──────────────────────────────────────────────────────────────────────
const limit = Number(arg('limit', 0));
const rejectedTwice = (() => { const n = {}; for (const r of readJsonl(REJECTED)) n[r.id] = (n[r.id] || 0) + 1; return new Set(Object.keys(n).filter((k) => n[k] >= 2)); })();
const q = { ...LIVE, ...SOURCE_FILTER[FIELD], ...missing(FIELD), language: { $not: NATIVE } };
if (arg('book-ids')) q.id = { $in: arg('book-ids').split(',').map((s) => s.trim()) };
const selected = [];
for await (const b of books.find(q, { projection: PROJECTION[FIELD], batchSize: 2000 }).sort({ read_count: -1, id: 1 })) {
  if (!b.id || rejectedTwice.has(b.id)) continue;
  const src = sourceOf(FIELD, b);
  if (!src) continue;
  selected.push({ ...b, src });
  if (limit && selected.length >= limit) break;
}

// Units: a summary, or one book's chapter list (in parts when long). Packs: units up to PACK_CHARS / PACK_BOOKS.
const units = [];
for (const b of selected) {
  if (FIELD === 'summary') units.push({ key: b.id, book: b, input: b.src.slice(0, 2500) });
  else for (let i = 0, p = 0; i < b.src.length; i += CHAPTER_PART, p++) {
    const parts = Math.ceil(b.src.length / CHAPTER_PART);
    units.push({ key: parts > 1 ? `${b.id}#${p}` : b.id, book: b, part: p, parts, input: b.src.slice(i, i + CHAPTER_PART) });
  }
}
const packs = [];
let cur = [], chars = 0;
for (const u of units) {
  const c = JSON.stringify(u.input).length;
  if (cur.length && (chars + c > PACK_CHARS[FIELD] || cur.length >= PACK_BOOKS)) { packs.push(cur); cur = []; chars = 0; }
  cur.push(u); chars += c;
}
if (cur.length) packs.push(cur);
console.log(`${FIELD}: ${selected.length} books, ${units.length} units, ${packs.length} calls planned; ${APPLY ? 'WRITING' : 'dry run'}; model ${MODEL}; ${CLI} ${cliVersion}; out ${OUT}`);

const tally = { calls: 0, written: 0, accepted: 0, rejected: 0, already: 0, failed_calls: 0 };
const pendingParts = new Map(); // book id -> { got: [], need }
let stop = null;

async function handleBook(b, es, problem) {
  const row = { at: new Date().toISOString(), field: FIELD, id: b.id, slug: b.slug, title: String(b.title || '').slice(0, 120), en: b.src, es, problem, model: MODEL, prompt_version: PROMPT_VERSION[FIELD], cli_version: cliVersion };
  fs.appendFileSync(RESULTS, JSON.stringify(row) + '\n');
  if (problem) { tally.rejected++; fs.appendFileSync(REJECTED, JSON.stringify({ at: row.at, id: b.id, problem }) + '\n'); console.log(`  reject ${b.id}: ${problem}`); return; }
  tally.accepted++;
  if (!APPLY) return;
  if (await writeOne(FIELD, b, es, cliVersion)) tally.written++; else tally.already++;
}

async function doPack(pack) {
  const used = callsUsed();
  if (used.today >= MAX_CALLS_DAY) { stop = stop || `daily call cap ${MAX_CALLS_DAY} reached`; return; }
  if (used.total >= MAX_CALLS_TOTAL) { stop = stop || `total call cap ${MAX_CALLS_TOTAL} reached`; return; }
  const input = Object.fromEntries(pack.map((u) => [u.key, u.input]));
  const r = await gatedTextCall(buildPrompt(FIELD, input), {
    model: MODEL, task: 'translate', attempts: 2,
    onCall: (c) => {
      tally.calls++;
      const rec = { ts: new Date().toISOString(), job: JOB, kind: `localize-${LANG}-${FIELD}`, model: MODEL, seconds: Math.round(c.secs), ok: !c.cls, error_class: c.cls, books: pack.length, usage: c.usage };
      fs.appendFileSync(LEDGER, JSON.stringify(rec) + '\n');
      try { fs.appendFileSync(CALL_LOG, JSON.stringify(rec) + '\n'); } catch { /* the box has the log dir; a laptop need not */ }
    },
  });
  if (r.cls === 'quota') { stop = `QUOTA: ${String(r.err || r.text).slice(0, 200)}`; return; }
  const obj = r.cls || r.problem ? null : parseReply(r.answer);
  if (!obj) { tally.failed_calls++; console.log(`  call failed (${r.cls || r.problem || 'reply is not a JSON object'}): ${pack.length} units left for the next run`); return; }
  for (const u of pack) {
    const es = obj[u.key];
    if (FIELD === 'summary') { await handleBook(u.book, typeof es === 'string' ? es.trim() : es, es === undefined ? 'missing from the reply' : summaryProblem(u.book.src, es, u.book.title, LANG)); continue; }
    const problem = es === undefined ? 'missing from the reply' : chaptersProblem(u.input, es, LANG);
    const clean = Array.isArray(es) ? es.map((x) => (typeof x === 'string' ? x.trim() : x)) : es;
    if (u.parts === 1) { await handleBook(u.book, clean, problem); continue; }
    const st = pendingParts.get(u.book.id) || { got: [], problems: [], seen: 0 };
    st.got[u.part] = clean; st.seen++; if (problem) st.problems.push(`part ${u.part}: ${problem}`);
    pendingParts.set(u.book.id, st);
    if (st.seen === u.parts) { pendingParts.delete(u.book.id); await handleBook(u.book, st.problems.length ? null : st.got.flat(), st.problems[0] || null); }
  }
}

const queue = packs.slice();
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
  for (let p = queue.shift(); p && !stop; p = queue.shift()) {
    await doPack(p);
    if (tally.calls && tally.calls % 20 === 0) console.log(`  … ${JSON.stringify(tally)}`);
  }
}));
console.log(`\n${FIELD}: ${JSON.stringify(tally)}${stop ? `\nSTOPPED: ${stop}` : ''}`);
await client.close();
process.exit(stop?.startsWith('QUOTA') ? 3 : stop ? 4 : 0);
