#!/usr/bin/env node
// PRIOR ART: scripts/eval/estimator/ocr/refusal-census.mjs — the per-book walk and the RECITATION stamps, but lite
// only, OCR only, and no page_revisions. scripts/audit/ocr-revision-provenance.mjs — page_revisions by `source`, to
// separate re-OCR from maintenance; it counts rows, it does not pair a draft with what replaced it or score either.
// scripts/eval/ocr-routing/stored-census.mjs — pages per language by the engine whose text they carry now; no failures,
// no revisions, no era. scripts/eval/en-ocr-reference-5124.mjs scorePage — the scorer, reused here unchanged (exported for this).
// scripts/eval/benchmark-refs.mjs + scripts/eval/benchmark/refs/ — the references, built for experiments; this scores
// the reads PRODUCTION stored for those pages, which no experiment did. None of them turns what every production route
// already did into estimator rows (#6740).
/**
 * route-census — what production's routes already did, as estimator evidence (#6740). Read-only on Mongo; no model
 * calls; $0. Every stage checkpoints under --out and a rerun resumes.
 *
 *   node --env-file=.env.production.local scripts/eval/estimator/ocr/route-census.mjs --out=DIR --stage=S [--concurrency=6]
 *
 * STAGES (in order; `all` runs them in turn)
 *   books       per book: live ocr / translation state grouped by model x source x call site x page kind x outcome
 *               -> DIR/books.jsonl (one line per book; a rerun skips books already written)
 *   revisions   page_revisions without the text: who wrote the superseded text, why it was superseded, its length
 *               -> DIR/revisions/<chunk>.tsv.gz (one chunk per week of ObjectId time; a chunk is written whole or not)
 *   live        the live ocr / translation state of every page that has a revision -> DIR/live/<chunk>.tsv.gz
 *   pairs       (local) each revision beside the state that replaced it, classified -> DIR/pairs-summary.json and
 *               DIR/pairs-sample.jsonl (the pairs drawn for the change stage)
 *   change      texts of the drawn correction / re-read pairs, scored with scorePage -> DIR/change.jsonl
 *   refs        every stored read (live + revisions) of each benchmark reference page and each volunteer-corrected
 *               page, scored against the reference -> DIR/refs-scored.jsonl
 *   throughput  pages written per route per hour over the last --days (default 60) -> DIR/throughput/<field>-<day>.json
 *   emit        the estimator inputs -> DIR/out/*.jsonl (see the experiment write-up for the formats)
 *
 * WHAT THE DENOMINATORS ARE. Did-not-read: a route's own attempts that the live page records — pages it wrote plus
 * pages it left refused / failed / empty under its own model stamp. A page refused by one Gemini route and later read
 * by another engine carries the stamp but not the refusing model: it is counted apart ('refusing model not recorded'),
 * never charged to the engine that read it. Guard refusals (blank / loop / health gates) live only in page_revisions,
 * so they are a second rate with its own denominator (distinct pages the route ever wrote, live or superseded).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import { publicationYear } from '../../../lib/ia-ocr-cohort.mjs';
import { normalizeLanguageToken } from '../../../lib/language-normalize.mjs';
import { scorePage } from '../../en-ocr-reference-5124.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.join(HERE, '..', '..', 'benchmark');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d ?? ''}`).split('=').slice(1).join('=');
const OUT = arg('out');
const STAGE = arg('stage', 'all');
const CONC = +arg('concurrency', '6');
const DAYS = +arg('days', '60');
const MAX_BOOKS = +arg('max-books', '0') || Infinity;
const NOW = new Date(arg('now', new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
if (!OUT) { console.error('--out=DIR required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const F = (...p) => path.join(OUT, ...p);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- classification (shared by every stage)
/** Sources that mean "an engine read this page"; anything else on a live field is a sweep or a copied text. */
const READ_SOURCES = new Set(['batch_api', 'ai', 'pipeline_preview', 'paddle', 'bdrc', 'ia_djvu', 'mineru', 'ndl-koten',
  'realtime_api_sequential', 'batch_api_recovery', 'kraken', 'broadsheet-ocr', 'paddle-zh-guarded-6871']);
const GUARD_SOURCE = /guard-refused|health-gate-refused/;
/** Not model output at all (data-provenance.md): a public or human text. */
const NOT_MODEL = /^(wikisource|corpus|manual|manual-backfill|volunteer-correction|system|skip|empty)$/;

export function era(year) {
  if (year == null) return 'unknown';
  return year < 1700 ? 'before 1700' : year < 1880 ? '1700-1879' : '1880 on';
}
const SCRIPT = {
  Latin: 'latin', English: 'latin', German: 'latin', French: 'latin', Italian: 'latin', Spanish: 'latin', Dutch: 'latin',
  Portuguese: 'latin', Polish: 'latin', Czech: 'latin', Swedish: 'latin', Danish: 'latin', Hungarian: 'latin', Nahuatl: 'latin',
  Greek: 'greek', 'Ancient Greek': 'greek', Chinese: 'han', 'Classical Chinese': 'han', Japanese: 'japanese', Korean: 'korean',
  Hebrew: 'hebrew', Aramaic: 'hebrew', Yiddish: 'hebrew', Arabic: 'arabic', Persian: 'arabic', Ottoman: 'arabic', Urdu: 'arabic',
  Syriac: 'syriac', Tibetan: 'tibetan', Sanskrit: 'indic', Armenian: 'armenian', Russian: 'cyrillic', 'Church Slavonic': 'cyrillic',
  Coptic: 'coptic', Georgian: 'georgian', Ethiopic: 'ethiopic', "Ge'ez": 'ethiopic', Malayalam: 'indic', Tamil: 'indic',
  Sumerian: 'cuneiform', Akkadian: 'cuneiform',
};
export function firstLanguage(book) {
  const raw = Array.isArray(book.language) ? book.language[0] : String(book.language ?? '').split(/[,;/]/)[0];
  return normalizeLanguageToken(raw) ?? null;
}
/** The Pareto chart a page would sit on (build-ocr-pareto.mjs SCRIPTS), else 'other:<script>'. */
export function chartOf(language, script, kind) {
  if (language === 'Latin') return 'latin';
  if (language === 'English') return 'english';
  if (script === 'latin') return 'latin-script-other';
  if (script === 'han') return /manuscript/.test(kind ?? '') ? 'chinese-manuscript' : 'chinese-print';
  if (['greek', 'japanese', 'armenian', 'hebrew', 'syriac'].includes(script)) return script;
  return `other:${script ?? 'unknown'}`;
}
const GEMINI = /gemini/i;
const familyOf = (m) => {
  const s = String(m ?? '');
  if (/flash-lite/.test(s)) return 'gemini-lite';
  if (/antigravity|agy/.test(s)) return 'gemini-cli';
  if (GEMINI.test(s)) return 'gemini';
  if (/claude|opus|sonnet|fable|haiku/i.test(s)) return 'claude';
  if (/paddle/i.test(s)) return 'paddle';
  if (/^ia-ocr|tesseract|abbyy/i.test(s)) return 'archive-text';
  if (/kraken|omnisyr|qoruyo|sophro/i.test(s)) return 'kraken';
  if (/bdrc|yigdzin|woodblock/i.test(s)) return 'bdrc';
  if (/ndl/i.test(s)) return 'ndl';
  if (/mineru/i.test(s)) return 'mineru';
  if (s === 'human') return 'human';
  return s ? 'other' : 'none';
};
/** `ia-ocr/0.0.18` -> `ia-ocr` so the Archive's engine versions do not split one route into twelve. */
const routeName = (m) => (/^ia-ocr\//.test(m ?? '') ? 'ia-ocr' : m ?? null);

/**
 * What replaced a superseded text. `draft` is the revision row, `next` the state written after it (the next revision,
 * or the live field). Order matters: a guard refusal is checked first, then relocation sweeps, then human and model
 * correction, then a different engine's read; what is left is an edit of the same read (cleanup, long-s pass, markup).
 */
const RELOCATION = /shift|relocat|leaf-break|leaf_repair|spread_split|spread-split|stranded|contamination|withhold|seam-repair|same-language-copy|text shift/i;
// Word-initial: 'stuck at preview' is not a review.
const CORRECTION_REASON = /\bcorrect|\breview|adjudic|twopass|two_read|best-of|by-eye/i;
export function classifyPair(draft, next) {
  const reason = `${draft.reason ?? ''} ${draft.source ?? ''}`;
  if (GUARD_SOURCE.test(draft.source ?? '')) return 'guard_refused';
  if (/^(skip|empty)$/.test(draft.source ?? '') || !(draft.len > 0)) return 'filled_empty';
  if (RELOCATION.test(reason) && !CORRECTION_REASON.test(draft.reason ?? '')) return 'relocation';
  if (next.model === 'human' || /volunteer/.test(reason)) return 'human_correction';
  if (familyOf(next.model) === 'claude' && familyOf(draft.model) !== 'claude') return 'model_correction';
  if (CORRECTION_REASON.test(draft.reason ?? '') && !/long-s|longs/.test(reason)) return 'model_correction';
  if (routeName(next.model) && routeName(next.model) !== routeName(draft.model) && READ_SOURCES.has(next.source ?? '')) return 'reread';
  if (/reocr|reread|re-read|retranslate|translate_cli|fresh/i.test(draft.reason ?? '')) return 'reread_same_model';
  return 'edit_same_read';
}

// ---------------------------------------------------------------- helpers
const gzLines = async function* (file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const l of rl) if (l) yield l;
};
const writeGzAtomic = (file, lines) => {
  fs.writeFileSync(file + '.part', zlib.gzipSync(lines.join('\n') + (lines.length ? '\n' : '')));
  fs.renameSync(file + '.part', file);
};
const tsv = (v) => (v == null ? '' : String(v).replace(/[\t\n\r]/g, ' '));
const iso = (d) => (d instanceof Date && !Number.isNaN(+d) ? d.toISOString() : '');
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
async function withDb(fn) {
  const c = await new MongoClient(process.env.MONGODB_URI, { maxPoolSize: CONC + 2 }).connect();
  try { return await fn(c.db('bookstore')); } finally { await c.close(); }
}
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// ---------------------------------------------------------------- stage: books
const HAS_TEXT = (f) => ({ $and: [{ $eq: [{ $type: `$${f}.data` }, 'string'] }, { $regexMatch: { input: `$${f}.data`, regex: '\\S' } }] });
const OCR_REFUSED = { $or: [{ $gte: [{ $ifNull: ['$ocr.recitation_count', 0] }, 1] }, { $eq: ['$ocr.recitation_blocked', true] },
  { $eq: ['$ocr.last_skip.reason', 'recitation'] }] };
const OCR_FAILED = { $or: [{ $eq: ['$ocr.fail_blocked', true] }, { $gt: [{ $ifNull: ['$ocr.fail_count', 0] }, 0] }, { $ne: [{ $ifNull: ['$ocr.fail_reason', null] }, null] }] };
const OCR_STATUS = { $switch: { branches: [
  { case: { $ne: [{ $type: '$ocr' }, 'object'] }, then: 'none' },
  { case: { $eq: ['$ocr.unreadable', true] }, then: 'unreadable' },
  { case: { $and: [HAS_TEXT('ocr'), OCR_REFUSED] }, then: 'read_after_refusal' },
  { case: { $and: [HAS_TEXT('ocr'), OCR_FAILED] }, then: 'read_after_failure' },
  { case: HAS_TEXT('ocr'), then: 'read' },
  { case: OCR_REFUSED, then: 'refused' },
  { case: OCR_FAILED, then: 'failed' },
], default: 'empty' } };
const TR_STATUS = { $switch: { branches: [
  { case: { $ne: [{ $type: '$translation' }, 'object'] }, then: 'none' },
  { case: { $eq: ['$translation.recitation_blocked', true] }, then: 'refused' },
  { case: { $eq: ['$translation.safety_blocked', true] }, then: 'safety_blocked' },
  { case: { $ne: [{ $ifNull: ['$translation.health_blocked', null] }, null] }, then: 'guard_refused' },
  { case: { $ne: [{ $ifNull: ['$translation.loop_quarantine_reason', null] }, null] }, then: 'quarantined' },
  { case: HAS_TEXT('translation'), then: 'read' },
  { case: { $ne: [{ $ifNull: ['$translation.fail_reason', null] }, null] }, then: 'failed' },
], default: 'empty' } };

async function stageBooks(db) {
  const file = F('books.jsonl');
  const done = new Set(readJsonl(file).map((r) => r.id));
  const books = await db.collection('books').find({ pages_count: { $gt: 0 } },
    { projection: { id: 1, language: 1, year: 1, published: 1, visible: 1, pages_count: 1, book_class: 1, content_type: 1, work_id: 1, ia_identifier: 1 } }).toArray();
  const todo = books.map((b) => ({ ...b, id: b.id ?? String(b._id) })).filter((b) => !done.has(b.id)).slice(0, MAX_BOOKS);
  log(`books with pages ${books.length}; to walk ${todo.length}`);
  const out = fs.createWriteStream(file, { flags: 'a' });
  let n = 0;
  await pool(todo, CONC, async (b) => {
    let agg;
    for (let attempt = 0; ; attempt++) {
      try {
        [agg] = await db.collection('pages').aggregate([{ $match: { book_id: b.id } }, { $facet: {
          ocr: [{ $group: { _id: { m: '$ocr.model', s: '$ocr.source', cs: { $ifNull: ['$ocr.engine.call_site', '$ocr.engine.name'] },
            k: '$script_type', st: OCR_STATUS, rm: { $ifNull: ['$ocr.last_skip.model', '$ocr.fail_blocked_model'] } }, n: { $sum: 1 } } }],
          tr: [{ $group: { _id: { m: '$translation.model', s: '$translation.source', cs: '$translation.engine.call_site', st: TR_STATUS,
            hb: '$translation.health_blocked' }, n: { $sum: 1 } } }],
        } }], { maxTimeMS: 600000 }).toArray();
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        log(`  ${b.id}: ${e.message} (retry ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      }
    }
    const lang = firstLanguage(b);
    const year = publicationYear(b);
    out.write(JSON.stringify({ id: b.id, language: lang, script: SCRIPT[lang] ?? (lang ? 'other' : 'unknown'), year, era: era(year),
      visible: b.visible === true, pages: b.pages_count, ia: !!b.ia_identifier,
      // book-class-5768: printed | handwritten, and the script family read off a contact sheet of the book's pages
      book_class: b.book_class?.class ?? null, script_family: b.book_class?.script_family ?? null,
      ocr: agg.ocr.map((g) => [g._id.m ?? null, g._id.s ?? null, g._id.cs ?? null, g._id.k ?? null, g._id.st, g._id.rm ?? null, g.n]),
      tr: agg.tr.map((g) => [g._id.m ?? null, g._id.s ?? null, g._id.cs ?? null, g._id.st, g._id.hb ?? null, g.n]) }) + '\n');
    if (++n % 2000 === 0) log(`  ${n}/${todo.length}`);
  });
  await new Promise((r) => out.end(r));
  log(`books: wrote ${n}`);
}

// ---------------------------------------------------------------- stage: revisions
const REV_COLS = ['_id', 'page_id', 'book_id', 'field', 'source', 'model', 'reason', 'by', 'created_at', 'original_date', 'len', 'hash', 'cs'];
function revChunks() {
  const chunks = [{ name: 'string-ids', match: { _id: { $type: 'string' } } }];
  for (let t = Date.UTC(2025, 0, 1); t < Date.now() + 864e5 * 7; t += 864e5 * 7) {
    const a = ObjectId.createFromTime(Math.floor(t / 1000)), b = ObjectId.createFromTime(Math.floor((t + 864e5 * 7) / 1000));
    chunks.push({ name: new Date(t).toISOString().slice(0, 10), match: { _id: { $gte: a, $lt: b } } });
  }
  chunks.push({ name: 'pre-2025', match: { _id: { $type: 'objectId', $lt: ObjectId.createFromTime(Date.UTC(2025, 0, 1) / 1000) } } });
  return chunks;
}
async function stageRevisions(db) {
  fs.mkdirSync(F('revisions'), { recursive: true });
  const chunks = revChunks().filter((c) => !fs.existsSync(F('revisions', `${c.name}.tsv.gz`)));
  log(`revision chunks to read ${chunks.length}`);
  await pool(chunks, Math.min(CONC, 4), async (c) => {
    const rows = [];
    const cur = db.collection('page_revisions').aggregate([{ $match: c.match }, { $project: {
      page_id: 1, book_id: 1, field: 1, source: 1, model: 1, reason: { $substrCP: [{ $ifNull: ['$reason', ''] }, 0, 160] }, by: 1,
      created_at: 1, original_date: 1, hash: '$content_hash', cs: { $ifNull: ['$engine.call_site', '$engine.name'] },
      len: { $cond: [{ $eq: [{ $type: '$data' }, 'string'] }, { $strLenCP: '$data' }, -1] } } }], { maxTimeMS: 3600000, allowDiskUse: true });
    for await (const r of cur) {
      rows.push(REV_COLS.map((k) => (k === 'created_at' || k === 'original_date' ? iso(r[k] instanceof Date ? r[k] : r[k] ? new Date(r[k]) : null)
        : k === '_id' ? String(r._id) : tsv(r[k] && typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k]))).join('\t'));
    }
    writeGzAtomic(F('revisions', `${c.name}.tsv.gz`), rows);
    log(`  revisions ${c.name}: ${rows.length}`);
  });
}

// ---------------------------------------------------------------- stage: live
const LIVE_COLS = ['page_id', 'book_id', 'kind', 'o_model', 'o_source', 'o_cs', 'o_len', 'o_hash', 'o_at', 't_model', 't_source', 't_cs', 't_len', 't_hash', 't_at'];
async function stageLive(db) {
  fs.mkdirSync(F('live'), { recursive: true });
  const ids = new Set();
  for (const f of fs.readdirSync(F('revisions')).filter((x) => x.endsWith('.tsv.gz'))) for await (const l of gzLines(F('revisions', f))) ids.add(l.split('\t')[1]);
  const all = [...ids].filter(Boolean).sort();
  const SIZE = 50000;
  log(`pages with a revision ${all.length}; ${Math.ceil(all.length / SIZE)} chunks`);
  const chunks = [];
  for (let i = 0; i < all.length; i += SIZE) chunks.push({ name: String(i / SIZE).padStart(4, '0'), ids: all.slice(i, i + SIZE) });
  await pool(chunks.filter((c) => !fs.existsSync(F('live', `${c.name}.tsv.gz`))), Math.min(CONC, 4), async (c) => {
    const rows = [];
    for (let j = 0; j < c.ids.length; j += 1000) {
      const part = c.ids.slice(j, j + 1000);
      const docs = await db.collection('pages').aggregate([{ $match: { id: { $in: part } } }, { $project: {
        id: 1, book_id: 1, kind: '$script_type', om: '$ocr.model', os: '$ocr.source', ocs: { $ifNull: ['$ocr.engine.call_site', '$ocr.engine.name'] },
        ol: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, -1] }, oh: '$ocr.content_hash', oa: '$ocr.updated_at',
        tm: '$translation.model', ts: '$translation.source', tcs: '$translation.engine.call_site',
        tl: { $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, { $strLenCP: '$translation.data' }, -1] }, th: '$translation.content_hash', ta: '$translation.updated_at' } }],
      { maxTimeMS: 600000 }).toArray();
      for (const d of docs) rows.push([d.id, d.book_id, d.kind, d.om, d.os, d.ocs, d.ol, d.oh, iso(d.oa ? new Date(d.oa) : null), d.tm, d.ts, d.tcs, d.tl, d.th, iso(d.ta ? new Date(d.ta) : null)].map(tsv).join('\t'));
    }
    writeGzAtomic(F('live', `${c.name}.tsv.gz`), rows);
    log(`  live ${c.name}: ${rows.length}/${c.ids.length}`);
  });
}

// ---------------------------------------------------------------- stage: pairs (local)
function bookMap() {
  const m = new Map();
  for (const b of readJsonl(F('books.jsonl'))) m.set(b.id, { language: b.language, script: b.script, era: b.era, year: b.year });
  return m;
}
/** One stream sorted by page, field, time: every revision, then the live state (time '~' sorts after any ISO date). */
function sortedStream() {
  const merged = F('pairs-input.tsv');
  if (!fs.existsSync(merged + '.sorted')) {
    const w = fs.openSync(merged, 'w');
    const revs = fs.readdirSync(F('revisions')).filter((x) => x.endsWith('.tsv.gz'));
    for (const f of revs) {
      const lines = zlib.gunzipSync(fs.readFileSync(F('revisions', f))).toString('utf8').split('\n').filter(Boolean);
      for (const l of lines) {
        const r = Object.fromEntries(l.split('\t').map((v, i) => [REV_COLS[i], v]));
        fs.writeSync(w, [r.page_id, r.field, r.created_at || '0', 'R', r._id, r.book_id, r.source, r.model, r.reason, r.by, r.original_date, r.len, r.hash, r.cs].join('\t') + '\n');
      }
    }
    for (const f of fs.readdirSync(F('live')).filter((x) => x.endsWith('.tsv.gz'))) {
      const lines = zlib.gunzipSync(fs.readFileSync(F('live', f))).toString('utf8').split('\n').filter(Boolean);
      for (const l of lines) {
        const r = Object.fromEntries(l.split('\t').map((v, i) => [LIVE_COLS[i], v]));
        fs.writeSync(w, [r.page_id, 'ocr', '~', 'L', '', r.book_id, r.o_source, r.o_model, '', '', r.o_at, r.o_len, r.o_hash, r.o_cs, r.kind].join('\t') + '\n');
        fs.writeSync(w, [r.page_id, 'translation', '~', 'L', '', r.book_id, r.t_source, r.t_model, '', '', r.t_at, r.t_len, r.t_hash, r.t_cs, r.kind].join('\t') + '\n');
      }
    }
    fs.closeSync(w);
    execFileSync('sort', ['-t', '\t', '-k1,1', '-k2,2', '-k3,3', '-S', '1G', '-T', OUT, '-o', merged + '.sorted', merged], { env: { ...process.env, LC_ALL: 'C' } });
    fs.unlinkSync(merged);
  }
  return merged + '.sorted';
}
const PAIR_COLS = ['page_id', 'field', 'at', 'kind', 'rev_id', 'book_id', 'source', 'model', 'reason', 'by', 'original_date', 'len', 'hash', 'cs', 'page_kind'];
/** Deterministic hash in [0,1) for drawing pages without $sample (biased toward big documents). */
const unit = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

async function stagePairs() {
  const books = bookMap();
  const file = sortedStream();
  const cells = new Map();         // class|field|draft|next|lang|kind -> {n, books:Set}
  const guard = new Map();         // field|model|lang|era|kind -> {refusedPages:Set, wrotePages:Set}
  const delivered = new Map();     // field|route|source|day -> n  (superseded reads written in the window)
  const drawn = new Map();         // cell -> [{...}] candidates for the change stage, one page per book first
  const winFrom = new Date(+NOW - DAYS * 864e5).toISOString();
  let group = [], key = null;
  const flush = () => {
    if (!group.length) return;
    const live = group[group.length - 1].kind === 'L' ? group[group.length - 1] : null;
    const revs = group.filter((r) => r.kind === 'R');
    const bk = books.get(revs[0]?.book_id || live?.book_id) ?? {};
    const lang = bk.language ?? 'unknown', kind = live?.page_kind || 'unknown';
    const pageModels = new Set(), refusedBy = new Set();
    for (let i = 0; i < revs.length; i++) {
      const d = revs[i], nx = revs[i + 1] ?? live ?? {};
      d.len = +d.len;
      const cls = classifyPair(d, nx);
      const dr = routeName(d.model) ?? 'none', nr = routeName(nx.model) ?? 'none';
      const ck = [cls, d.field, dr, nr, lang, kind].join('|');
      if (!cells.has(ck)) cells.set(ck, { n: 0, books: new Set(), reasons: new Map() });
      const c = cells.get(ck); c.n++; c.books.add(d.book_id);
      const rs = (d.reason || '').slice(0, 60); c.reasons.set(rs, (c.reasons.get(rs) ?? 0) + 1);
      if (cls === 'guard_refused') refusedBy.add(dr); else if (d.len > 0 && READ_SOURCES.has(d.source)) pageModels.add(dr);
      // A superseded read is a delivered page on the day it was written, unless what replaced it was the same read
      // edited (then the live row already counts it).
      if (d.original_date >= winFrom && !['edit_same_read', 'relocation'].includes(cls) && d.len > 0)
        { const k = [d.field, dr, READ_SOURCES.has(d.source) ? d.source : 'sweep', d.original_date.slice(0, 10)].join('|'); delivered.set(k, (delivered.get(k) ?? 0) + 1); }
      if (['model_correction', 'human_correction', 'reread'].includes(cls)) {
        if (!drawn.has(ck)) drawn.set(ck, []);
        drawn.get(ck).push({ u: unit(d.rev_id), book_id: d.book_id, page_id: d.page_id, field: d.field, rev_id: d.rev_id,
          next_rev_id: revs[i + 1]?.rev_id ?? null, draft: d.model, next: nx.model, next_source: nx.source, reason: d.reason, lang, kind, era: bk.era });
      }
    }
    if (live && +live.len > 0 && READ_SOURCES.has(live.source)) pageModels.add(routeName(live.model));
    for (const m of new Set([...pageModels, ...refusedBy])) {
      const gk = [revs[0]?.field ?? live?.field, m, lang, bk.era ?? 'unknown', kind].join('|');
      if (!guard.has(gk)) guard.set(gk, { refused: 0, wrote: 0, books: new Set(), refusedBooks: new Set() });
      const g = guard.get(gk); g.books.add(revs[0]?.book_id);
      if (refusedBy.has(m) && !pageModels.has(m)) { g.refused++; g.refusedBooks.add(revs[0]?.book_id); }
      else if (refusedBy.has(m)) { g.refused_then_wrote = (g.refused_then_wrote ?? 0) + 1; g.wrote++; } else g.wrote++;
    }
    group = [];
  };
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let lines = 0;
  for await (const l of rl) {
    const v = l.split('\t'); const r = Object.fromEntries(PAIR_COLS.map((k, i) => [k, v[i] ?? '']));
    const k = r.page_id + '|' + r.field;
    if (k !== key) { flush(); key = k; }
    group.push(r);
    if (++lines % 1e6 === 0) log(`  pairs: ${lines} lines`);
  }
  flush();
  const ser = (m, f) => [...m].map(([k, v]) => f(k, v));
  const summary = {
    generated: new Date().toISOString(), lines,
    cells: ser(cells, (k, v) => { const [cls, field, draft, next, language, kind] = k.split('|');
      return { cls, field, draft, next, language, kind, pairs: v.n, books: v.books.size, top_reasons: [...v.reasons].sort((a, b) => b[1] - a[1]).slice(0, 3) }; })
      .sort((a, b) => b.pairs - a.pairs),
    guard: ser(guard, (k, v) => { const [field, model, language, eraV, kind] = k.split('|');
      return { field, model, language, era: eraV, kind, guard_refused_pages: v.refused, refused_then_wrote: v.refused_then_wrote ?? 0,
        pages_written: v.wrote, books: v.books.size, refused_books: v.refusedBooks.size }; }),
    delivered_superseded: ser(delivered, (k, n) => { const [field, route, source, day] = k.split('|'); return { field, route, source, day, n }; }),
  };
  fs.writeFileSync(F('pairs-summary.json'), JSON.stringify(summary));
  // The change draw: per cell, one page per book first (lowest hash), then a second page per book, up to 300.
  const sample = [];
  for (const [ck, rows] of drawn) {
    rows.sort((a, b) => a.u - b.u);
    const per = new Map(); const pick = [];
    for (const round of [0, 1]) for (const r of rows) {
      if (pick.length >= 300) break;
      const c = per.get(r.book_id) ?? 0;
      if (c === round) { pick.push({ cell: ck, ...r }); per.set(r.book_id, c + 1); }
    }
    sample.push(...pick);
  }
  fs.writeFileSync(F('pairs-sample.jsonl'), sample.map((r) => JSON.stringify(r)).join('\n') + '\n');
  log(`pairs: ${summary.cells.length} cells, ${summary.guard.length} guard cells, ${sample.length} pairs drawn for change`);
}

// ---------------------------------------------------------------- stage: change
async function stageChange(db) {
  const file = F('change.jsonl');
  const done = new Set(readJsonl(file).map((r) => r.rev_id));
  // OCR pairs only for the re-read cells (translation re-reads are another measure); corrections on both fields.
  const todo = readJsonl(F('pairs-sample.jsonl')).filter((r) => !done.has(r.rev_id))
    .filter((r) => r.field === 'ocr' || !r.cell.startsWith('reread'));
  log(`change: ${todo.length} pairs to fetch`);
  const out = fs.createWriteStream(file, { flags: 'a' });
  const R = db.collection('page_revisions');
  for (let i = 0; i < todo.length; i += 200) {
    const part = todo.slice(i, i + 200);
    const revIds = part.flatMap((r) => [r.rev_id, r.next_rev_id]).filter(Boolean);
    const ids = revIds.map((x) => (/^[0-9a-f]{24}$/.test(x) ? new ObjectId(x) : x));
    const revDocs = new Map((await R.find({ _id: { $in: [...ids, ...revIds] } },
      { projection: { data: 1, 'engine.input.draft': 1, 'engine.call_site': 1, 'meta.pipeline': 1, 'meta.review': 1 } }).toArray()).map((d) => [String(d._id), d]));
    const lives = new Map((await db.collection('pages').find({ id: { $in: part.filter((r) => !r.next_rev_id).map((r) => r.page_id) } },
      { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1, 'ocr.pipeline': 1, 'ocr.engine.input.draft': 1, 'ocr.engine.call_site': 1,
        'translation.engine.input.draft': 1, 'translation.engine.call_site': 1, 'translation.review': 1, 'translation.pipeline': 1 } }).toArray()).map((d) => [d.id, d]));
    for (const r of part) {
      const a = revDocs.get(r.rev_id)?.data;
      const nextDoc = r.next_rev_id ? revDocs.get(r.next_rev_id) : lives.get(r.page_id)?.[r.field];
      const b = nextDoc?.data;
      // Correct mode vs a fresh read: the writer names the draft it was given (cli-ocr CORRECT MODE: engine.input.draft,
      // ocr.pipeline = the lane), or the field carries a review block (twopass-review). Otherwise the next text is a read.
      const nx = r.next_rev_id ? { draft: nextDoc?.engine?.input?.draft, pipeline: nextDoc?.meta?.pipeline, review: nextDoc?.meta?.review, cs: nextDoc?.engine?.call_site }
        : { draft: nextDoc?.engine?.input?.draft, pipeline: nextDoc?.pipeline, review: nextDoc?.review, cs: nextDoc?.engine?.call_site };
      const mode = nx.draft || nx.review || /correct|review/i.test(String(nx.pipeline ?? '')) || /correct|review/i.test(r.reason ?? '') ? 'correct' : 'read';
      Object.assign(r, { mode, next_pipeline: nx.pipeline ?? null, next_call_site: nx.cs ?? null });
      if (typeof a !== 'string' || typeof b !== 'string') { out.write(JSON.stringify({ ...r, missing: true }) + '\n'); continue; }
      const s = scorePage(b, a);   // the later text as the "reference": a CHANGE rate, never an accuracy
      out.write(JSON.stringify({ ...r, change_cer: s.cer, change_wer: s.wer, len_ratio: s.len_ratio, ref_chars: s.ref_alnum_chars,
        num_changed: s.num_sub + s.num_drop + s.num_ins, num_ref: s.num_ref, identical: a === b }) + '\n');
    }
    if ((i / 200) % 10 === 0) log(`  change ${i + part.length}/${todo.length}`);
  }
  await new Promise((r) => out.end(r));
}

// ---------------------------------------------------------------- stage: refs
/** Every benchmark reference page we hold, with the stratum it was sealed in and its provenance. */
function benchmarkRefs() {
  const byslug = new Map();
  for (const f of fs.readdirSync(BENCH).filter((x) => x.endsWith('.json'))) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(BENCH, f), 'utf8')); } catch { continue; }
    const rows = Array.isArray(d) ? d : Array.isArray(d.rows) ? d.rows : Array.isArray(d.pages) ? d.pages : [];
    for (const r of rows) if (r?.slug) byslug.set(r.slug, { ...r, stratum: f.replace(/\.json$/, ''), substratum: r.stratum ?? r.substratum ?? null });
  }
  const refs = [];
  const dir = path.join(BENCH, 'refs');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const slug = f.replace(/\.json$/, '');
    const txt = path.join(dir, `${slug}.txt`);
    if (!fs.existsSync(txt)) continue;
    let meta; try { meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const s = byslug.get(slug) ?? {};
    const book_id = meta.book_id ?? s.book_id ?? slug.match(/[0-9a-f]{24}/)?.[0];
    const page_number = meta.page_number ?? s.page_number ?? (+(slug.match(/-p(\d+)$/)?.[1] ?? NaN) || null);
    if (!book_id || !page_number) continue;
    const text = fs.readFileSync(txt, 'utf8');
    if (!text.trim()) continue;
    const kind = meta.reference_kind ?? meta.kind ?? s.source ?? null;
    refs.push({ slug, stratum: s.stratum ?? slug.split('-')[0], substratum: s.substratum ?? null, book_id, page_number, page_id: meta.page_id ?? s.page_id ?? null, text,
      ref_kind: kind, ref_source: meta.source ?? s.source ?? null, anchored: !!(meta.window?.probe && /production/.test(meta.window.probe)) || kind === 'corrected-served-ocr',
      // A public e-text (Wikisource, Perseus, Kanripo, CBETA, Gutenberg, EEBO-TCP, CAMENA ...) is exactly what the
      // recitation filter knows; a transcription made for us from the leaf is not on the web.
      fame_web: /same-leaf|corrected-served|model-transcription|by-eye/.test(`${kind} ${meta.source ?? ''}`) ? 0 : 1,
      year: meta.year ?? s.year ?? null, script_hint: meta.script ?? null });
  }
  return refs;
}
async function stageRefs(db) {
  const file = F('refs-scored.jsonl');
  const done = new Set(readJsonl(file).map((r) => r.slug));
  const books = new Map((await db.collection('books').find({}, { projection: { id: 1, language: 1, year: 1, published: 1 } }).toArray())
    .map((b) => [b.id ?? String(b._id), b]));
  const refs = benchmarkRefs().filter((r) => !done.has(r.slug));
  // Volunteer corrections: the superseded model text against the corrected text (a reference on the edited spans only).
  const vol = await db.collection('page_revisions').find({ reason: 'volunteer_correction', field: 'ocr' }).toArray();
  log(`refs: ${refs.length} benchmark pages, ${vol.length} volunteer-corrected ocr revisions`);
  const out = fs.createWriteStream(file, { flags: 'a' });
  await pool(refs, CONC, async (ref) => {
    const page = ref.page_id ? await db.collection('pages').findOne({ id: ref.page_id }, { projection: { id: 1, script_type: 1, ocr: 1 } })
      : await db.collection('pages').findOne({ book_id: ref.book_id, page_number: ref.page_number }, { projection: { id: 1, script_type: 1, ocr: 1 } });
    const b = books.get(ref.book_id) ?? {};
    const base = { slug: ref.slug, stratum: ref.stratum, substratum: ref.substratum, book_id: ref.book_id, page_number: ref.page_number, ref_kind: ref.ref_kind,
      ref_source: ref.ref_source, anchored: ref.anchored, fame_web: ref.fame_web, language: firstLanguage(b), year: publicationYear(b) ?? ref.year };
    if (!page) { out.write(JSON.stringify({ ...base, missing: 'page' }) + '\n'); return; }
    const revs = await db.collection('page_revisions').find({ page_id: page.id, field: 'ocr' }, { projection: { data: 1, model: 1, source: 1, reason: 1, created_at: 1, original_date: 1 } })
      .sort({ created_at: 1 }).toArray();
    const versions = [...revs.map((r) => ({ version: 'revision', at: r.original_date ?? null, superseded_at: r.created_at, model: r.model, source: r.source, reason: r.reason ?? null, data: r.data })),
      { version: 'live', at: page.ocr?.updated_at ?? null, model: page.ocr?.model, source: page.ocr?.source, reason: null, data: page.ocr?.data }];
    const seen = new Set();
    const scored = [];
    for (const v of versions) {
      if (typeof v.data !== 'string' || !v.data.trim()) { scored.push({ version: v.version, model: v.model ?? null, source: v.source ?? null, empty: true }); continue; }
      if (seen.has(v.data)) continue; seen.add(v.data);
      const s = scorePage(ref.text, v.data);
      scored.push({ version: v.version, model: v.model ?? null, source: v.source ?? null, reason: v.reason ? String(v.reason).slice(0, 80) : null,
        at: v.at, cer: s.cer, wer: s.wer, ref_chars: s.ref_alnum_chars, len_ratio: s.len_ratio, num_ref: s.num_ref, num_sub: s.num_sub, num_drop: s.num_drop, num_ins: s.num_ins });
    }
    out.write(JSON.stringify({ ...base, page_id: page.id, kind: page.script_type ?? null, recitation: (page.ocr?.recitation_count ?? 0) > 0 || page.ocr?.recitation_blocked === true, versions: scored }) + '\n');
  });
  const R = db.collection('page_revisions');
  for (const v of vol) {
    if (done.has(`volunteer:${v._id}`)) continue;
    const next = await R.find({ page_id: v.page_id, field: 'ocr', created_at: { $gt: v.created_at } }).sort({ created_at: 1 }).limit(1).toArray();
    const page = await db.collection('pages').findOne({ id: v.page_id }, { projection: { 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, script_type: 1 } });
    const corrected = next[0]?.data ?? page?.ocr?.data;
    const b = books.get(v.book_id) ?? {};
    const s = typeof corrected === 'string' && typeof v.data === 'string' ? scorePage(corrected, v.data) : null;
    out.write(JSON.stringify({ slug: `volunteer:${v._id}`, stratum: 'volunteer-correction', book_id: v.book_id, page_id: v.page_id, ref_kind: 'volunteer-span-correction',
      ref_source: 'page_revisions reason volunteer_correction (the corrected text right after it)', anchored: true, fame_web: 0,
      language: firstLanguage(b), year: publicationYear(b), kind: page?.script_type ?? null,
      versions: s ? [{ version: 'revision', model: v.model, source: v.source, cer: s.cer, wer: s.wer, ref_chars: s.ref_alnum_chars, len_ratio: s.len_ratio,
        num_ref: s.num_ref, num_sub: s.num_sub, num_drop: s.num_drop, num_ins: s.num_ins }] : [] }) + '\n');
  }
  await new Promise((r) => out.end(r));
}

// ---------------------------------------------------------------- stage: throughput
async function stageThroughput(db) {
  fs.mkdirSync(F('throughput'), { recursive: true });
  const days = [];
  for (let d = 1; d <= DAYS; d++) days.push(new Date(+NOW - d * 864e5));
  const jobs = days.flatMap((d) => ['ocr', 'translation'].map((field) => ({ field, d, file: F('throughput', `${field}-${d.toISOString().slice(0, 10)}.json`) })))
    .filter((j) => !fs.existsSync(j.file));
  log(`throughput: ${jobs.length} day x field slices`);
  await pool(jobs, Math.min(CONC, 4), async ({ field, d, file }) => {
    const rows = await db.collection('pages').aggregate([
      { $match: { [`${field}.updated_at`]: { $gte: d, $lt: new Date(+d + 864e5) } } },
      { $group: { _id: { m: `$${field}.model`, s: `$${field}.source`, cs: { $ifNull: [`$${field}.engine.call_site`, `$${field}.engine.name`] },
        h: { $hour: `$${field}.updated_at` }, text: HAS_TEXT(field) }, n: { $sum: 1 } } }], { maxTimeMS: 1800000, allowDiskUse: true }).toArray();
    fs.writeFileSync(file + '.part', JSON.stringify(rows.map((r) => ({ ...r._id, n: r.n }))));
    fs.renameSync(file + '.part', file);
    log(`  ${field} ${d.toISOString().slice(0, 10)}: ${rows.reduce((a, r) => a + r.n, 0)} pages`);
  });
}

// ---------------------------------------------------------------- stage: emit
async function stageEmit() {
  const { emit } = await import('./route-census-emit.mjs');
  await emit({ OUT, NOW, DAYS, helpers: { era, chartOf, familyOf, routeName, READ_SOURCES, NOT_MODEL, GEMINI } });
}

const STAGES = { books: stageBooks, revisions: stageRevisions, live: stageLive, pairs: stagePairs, change: stageChange,
  refs: stageRefs, throughput: stageThroughput, emit: stageEmit };
const LOCAL = new Set(['pairs', 'emit']);
if (import.meta.url === `file://${process.argv[1]}`) {
  const run = STAGE === 'all' ? Object.keys(STAGES) : STAGE.split(',');
  for (const s of run) {
    if (!STAGES[s]) { console.error(`unknown stage ${s}`); process.exit(2); }
    log(`stage ${s}`);
    if (LOCAL.has(s)) await STAGES[s](); else await withDb(STAGES[s]);
  }
}
