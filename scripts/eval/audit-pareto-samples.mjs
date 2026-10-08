#!/usr/bin/env node
/**
 * audit-pareto-samples.mjs — do the pages behind each /quality/pareto panel suit the measure? (#6304)
 *
 * PRIOR ART: scripts/eval/build-ocr-pareto.mjs and build-translation-pareto.mjs build the panels and
 * (with --dump-sets / --exclude / --out, added for this audit) say which pages sit in each and rebuild
 * a panel without some of them; this script never recomputes a score itself. scripts/eval/pareto-6182/
 * score-xl.py scores the #6182 packet but asks nothing of the pages. scripts/eval/benchmark-score.mjs
 * records CER per page × engine, which this reads. The #5695 tracks' write-ups checked their own
 * references by hand; nothing checks the panels' samples as a whole.
 *
 * $0: no model call of any kind. Mongo is read only (books + pages metadata and stored OCR text).
 * Reads: both build scripts' panel sets; /root/pareto-6182 (xl records, judge outputs, Tengyur packets);
 * scripts/eval/benchmark (sealed registries, refs); scripts/eval/results/benchmark (per-page CER).
 * Writes to --out (default $JOB_SCRATCH/audit): pages.jsonl.gz (one row per panel page, flags and
 * measurements, no text), panels.json (per panel: checks 1–8), sensitivity.json, draw.json (the by-eye
 * draw, with image paths and text excerpts for the readers; NEVER committed — it holds reference text),
 * and summary.json (numbers and page ids only, safe to commit).
 * The by-eye verdicts (Opus readers on the subscription, one per stratum group, reading draw.json against the
 * page image) live in results/pareto-sample-audit-6304/eye.json, with no reference text. With --write this
 * also writes that directory's drops.json (pages that do not suit the measure, and generated panel notes),
 * which both build scripts read, and a copy of summary.json.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/audit-pareto-samples.mjs [--out=<dir>] [--no-images] [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import { loadRefText } from './lib/private-refs.mjs';
import { readBenchmarkRows, BENCHMARK_DIR } from './lib/benchmark-rows.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const argOf = (n, d) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const OUT = argOf('out', path.join(process.env.JOB_SCRATCH || '/tmp', 'audit'));
const P6182 = argOf('packets', '/root/pareto-6182');
const OCR_BENCH = argOf('ocr-bench', '/mnt/HC_Volume_105839809/jobs/ocr-pareto-6293/bench');
fs.mkdirSync(OUT, { recursive: true });
const jsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const pkey = id => String(id).replace(/_0*(\d+)$/, '_$1');
const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const median = xs => { const s = [...xs].filter(x => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const count = (xs, f = x => x) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const log = (...a) => console.log(...a);

// ── 0. panel membership, straight from the build scripts ──────────────────────────────────────
const run = (script, args) => execFileSync('node', [path.join(__dirname, script), ...args], { cwd: REPO, encoding: 'utf8' });
// Every build here runs with --keep-dropped: the audit reads the whole sample, before its own drops.
run('build-translation-pareto.mjs', ['--keep-dropped', `--dump-sets=${OUT}/tr-sets.json`]);
run('build-ocr-pareto.mjs', ['--keep-dropped', `--dump-sets=${OUT}/ocr-sets.json`]);
fs.writeFileSync(`${OUT}/none.json`, '[]');
run('build-translation-pareto.mjs', ['--keep-dropped', `--exclude=${OUT}/none.json`, `--out=${OUT}/tr-base.json`]);
run('build-ocr-pareto.mjs', ['--keep-dropped', `--exclude=${OUT}/none.json`, `--out=${OUT}/ocr-base.json`]);
const RESULTS = path.join(__dirname, 'results', 'pareto-sample-audit-6304');
const trSets = JSON.parse(fs.readFileSync(`${OUT}/tr-sets.json`, 'utf8'));
const ocrSets = JSON.parse(fs.readFileSync(`${OUT}/ocr-sets.json`, 'utf8'));
const trChart = JSON.parse(fs.readFileSync(`${OUT}/tr-base.json`, 'utf8'));
const ocrChart = JSON.parse(fs.readFileSync(`${OUT}/ocr-base.json`, 'utf8'));

// ── text heuristics ─────────────────────────────────────────────────────────────────────────
const SCRIPTS = { Latin: /\p{Script=Latin}/u, Greek: /\p{Script=Greek}/u, Hebrew: /\p{Script=Hebrew}/u, Arabic: /\p{Script=Arabic}/u, Han: /\p{Script=Han}/u,
  Tibetan: /\p{Script=Tibetan}/u, Devanagari: /\p{Script=Devanagari}/u, Syriac: /\p{Script=Syriac}/u, Armenian: /\p{Script=Armenian}/u,
  Sinhala: /\p{Script=Sinhala}/u, Myanmar: /\p{Script=Myanmar}/u, Thai: /\p{Script=Thai}/u, Khmer: /\p{Script=Khmer}/u, Bengali: /\p{Script=Bengali}/u, Kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u };
const stripTags = s => String(s || '').replace(/<(meta|note|image-desc|figure|warning|scan-quality|language|page-type|columns|detected-images|vocab|summary|keywords)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
function scriptShares(text) {
  const c = {}; let n = 0;
  for (const ch of stripTags(text)) { if (!/\p{L}/u.test(ch)) continue; n++; for (const [k, re] of Object.entries(SCRIPTS)) if (re.test(ch)) { c[k] = (c[k] || 0) + 1; break; } }
  const sh = {}; for (const [k, v] of Object.entries(c)) sh[k] = r3(v / n);
  return { letters: n, shares: sh, top: Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null };
}
const STOP = {
  Latin: 'est et quod cum qui quae ut sed enim autem vel uel sunt esse hoc etiam quam nec atque ab ad ex ita quia siue sive eius ac igitur ergo', English: 'the and of that is which with this be it was are from by have not',
  German: 'der die und das ist nicht mit den sich auch ein eine zu von dem des wie auf daß dass oder', French: 'le les et des est que qui une dans pour du au pas sont il elle ce sur ou',
  Italian: 'il che di non per una del della sono gli con nel si delle alla come ma questo', Spanish: 'el que y los las en es por con del se una para como su al',
  Dutch: 'het een en van dat niet zijn met die op voor wordt ook als aan bij',
};
const STOPSETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]));
function langid(text) {
  const toks = stripTags(text).toLowerCase().match(/\p{Script=Latin}+/gu) || [];
  const hits = {}; for (const [k, s] of Object.entries(STOPSETS)) hits[k] = toks.filter(t => s.has(t)).length;
  const top = Object.entries(hits).sort((a, b) => b[1] - a[1])[0];
  return { tokens: toks.length, hits, top: top[1] ? top[0] : null };
}
const CJK = /^(Han|Tibetan|Kana)$/;
const EXPECT_SCRIPT = { Latin: ['Latin'], English: ['Latin'], German: ['Latin'], French: ['Latin'], Italian: ['Latin'], Dutch: ['Latin'], Spanish: ['Latin'], Greek: ['Greek'],
  Hebrew: ['Hebrew'], Aramaic: ['Hebrew', 'Syriac'], Arabic: ['Arabic'], Persian: ['Arabic'], Sanskrit: ['Devanagari', 'Latin', 'Bengali'], Pali: ['Latin', 'Sinhala', 'Myanmar', 'Thai', 'Khmer', 'Devanagari'],
  Chinese: ['Han'], Tibetan: ['Tibetan'], Armenian: ['Armenian'], Syriac: ['Syriac'] };
const LATIN_LANGS = new Set(Object.keys(STOP));

/** Checks 1–2 on a text that is the page: kind and language/script. Returns { m, hard[], soft[] }. */
function pageChecks(text, lang, { pageType } = {}) {
  const sc = scriptShares(text), li = langid(text);
  const raw = stripTags(text);
  const digits = (raw.match(/\d/g) || []).length, nonSpace = raw.replace(/\s/g, '').length || 1;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const shortLines = lines.filter(l => l.length < 25).length;
  const expScripts = EXPECT_SCRIPT[lang] || [];
  const expShare = expScripts.reduce((s, k) => s + (sc.shares[k] || 0), 0);
  const cjk = CJK.test(expScripts[0] || '');
  const minLetters = cjk ? 100 : 300;
  const m = { letters: sc.letters, top_script: sc.top, expected_script_share: r3(expShare), latin_share: sc.shares.Latin || 0, digit_share: r3(digits / nonSpace),
    short_line_share: lines.length ? r3(shortLines / lines.length) : null, lang_top: li.top, lang_hits: li.hits, page_type: pageType ?? null };
  const hard = [], soft = [];
  if (sc.letters < minLetters / 3) hard.push('near-empty');
  else if (sc.letters < minLetters) soft.push('short');
  if (pageType && !/^(text|body|content|null)$/i.test(pageType)) soft.push(`page-type:${pageType}`);
  if (m.digit_share > 0.2) soft.push('numeric');
  if (expScripts.length && expShare < 0.4) hard.push(`script:${sc.top}`);
  else if (expScripts.length && !expScripts.includes('Latin') && (sc.shares.Latin || 0) >= 0.25) soft.push('mixed-latin');
  if (LATIN_LANGS.has(lang) && li.top && li.top !== lang) {
    const own = li.hits[lang] || 0, other = li.hits[li.top];
    if (other >= 8 && other >= 2 * own) hard.push(`language:${li.top}`);
    else if (other >= 6 && other >= 1.3 * own) soft.push(`language?:${li.top}`);
  }
  if (!LATIN_LANGS.has(lang) && expScripts.includes('Latin') && ['English', 'German', 'French', 'Italian'].includes(li.top) && li.hits[li.top] >= 10) hard.push(`language:${li.top}`);
  return { m, hard, soft };
}

// Famous texts: a published English is widely reproduced, so a model may recall it (check 6).
const FAMOUS = /utopia|principia|revolutionibus|aene|vergil|virgil|biblia|bible|vulgat|psalm|evangel|confession|consolatio|metamorph|iliad|ilias|odyss|homer|plato|platon|timae|aristot|euclid|bhagavad|gita|dhammapada|analect|論語|道德|老子|孫子|孟子|大學|中庸|quran|koran|qur|masnavi|mathnawi|rumi|hafez|hafiz|rubai|khayyam|talmud|mishna|zohar|perplex|dante|commedia|principe|machiavel|quixot|montaigne|essais|descartes|spinoza|thesen|luther|hermes|hermetic|pimander|poimandres|galen|hippocrat|thucydid|herodot|plutarch|augustin|boethius|cicero|caesar|gallico|seneca|lucret|ovid|tacit|xenophon|sophocl|euripid|aeschyl|epictet|marcus aurel|heart sutra|shurangama|楞嚴|金剛|法華|心經|avatamsaka|lankavatara|yoga sutra|upanishad|ramayana|mahabharata|shakuntala|kalidasa|meghaduta|gulistan|bustan|shahnameh|shahnama|ibn sina|avicenna|averro|maimonides|gita|tao te/i;

// ── 1. translation pages ────────────────────────────────────────────────────────────────────
log('translation: loading packets');
const xlRec = new Map(jsonl(`${P6182}/xl/records.jsonl`).map(r => [pkey(r.id), r]));
// judge outputs: reference_fit per judge, candidate spans per judge
const xlKey = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/pareto-6182/xljudge/key.json'), 'utf8')).items;
const xlJudge = new Map();   // pkey → { J1: {fit, spans:[]}, J2: ... }
for (const f of fs.readdirSync(`${P6182}/xljudge`).filter(f => /^out-J/.test(f))) {
  const judge = f.startsWith('out-J1') ? 'J1' : 'J2';
  for (const o of jsonl(`${P6182}/xljudge/${f}`)) {
    const k = xlKey[o.id]; if (!k || k.kind !== 'ARMS') continue;
    const id = pkey(k.page_id), e = xlJudge.get(id) || {};
    e[judge] = { fit: o.reference_fit, spans: Object.values(o.scores || {}).map(s => (Array.isArray(s.span) ? s.span.join('+') : s.span)) };
    xlJudge.set(id, e);
  }
}
const tibKey = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/pareto-6182/tibjudge/key.json'), 'utf8'));
const tibIn = new Map(), tibJudge = new Map();
for (const f of fs.readdirSync(`${P6182}/tibjudge`).filter(f => /^(in|out)-J/.test(f))) {
  const judge = f.includes('J1') ? 'J1' : 'J2';
  for (const o of jsonl(`${P6182}/tibjudge/${f}`)) {
    const k = tibKey[o.id]; if (!k?.page_id) continue;
    if (f.startsWith('in-')) tibIn.set(k.page_id, { ...o, set: k.set });
    else { const e = tibJudge.get(k.page_id) || {}; e[judge] = { spans: Object.values(o.scores || {}).map(s => (Array.isArray(s.span) ? s.span.join('+') : s.span)) }; tibJudge.set(k.page_id, e); }
  }
}
const tibAlign = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, 'results/tengyur-levers-6121/ref-alignment.json'), 'utf8')).sides.map(s => [s.page_id, s]));

// ── 2. OCR pages ────────────────────────────────────────────────────────────────────────────
log('ocr: loading registries, refs, scored rows');
const registry = new Map();
for (const f of fs.readdirSync(path.join(__dirname, 'benchmark')).filter(f => f.endsWith('.json'))) {
  const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'benchmark', f), 'utf8')).pages;
  for (const p of Array.isArray(pages) ? pages : []) registry.set(p.slug, { ...p, registry: f });
}
const REFS = path.join(__dirname, 'benchmark', 'refs');
// Three reference stores, as benchmark-score.mjs reads them: the ref tiers keep a passage per page in
// ground-truth*/<slug>.json; the #5547 cohort keeps one jsonl of {record, text}; the rest benchmark/refs.
const cohortRefs = new Map(jsonl(path.join(REFS, 'chinese-cohort-5547.refs.jsonl')).map(r => [r.slug, r]));
const gtOf = (stratum, slug) => { const f = path.join(__dirname, stratum === 'ref-pinned' ? 'ground-truth' : 'ground-truth-ws', `${slug}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
function refOf(stratum, slug) {
  if (stratum === 'ref-ws' || stratum === 'ref-pinned') { const g = gtOf(stratum, slug); return { rec: g, text: g?.ocr_ground_truth || null, skipped: g ? null : 'no-ground-truth' }; }
  if (stratum === 'chinese-cohort-5547') { const c = cohortRefs.get(slug); return { rec: c?.record || null, text: c?.text || null, skipped: c ? null : 'no-cohort-ref' }; }
  const f = path.join(REFS, `${slug}.json`), rec = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  const lt = loadRefText(REFS, slug);
  return { rec, text: lt.text, private: lt.private, skipped: lt.skipped };
}
// every scored engine row, same reader as the build (store first, then the open-engine dirs)
const scored = new Map();   // stratum|slug → { meta, engines: {engine: cer} }
for (const dir of [BENCHMARK_DIR, ...['open-engine-print-5660/scored', 'open-engine-print-5660/scored-olmocr', 'engine-wave1-6011/scored', 'engine-wave2-6011/scored'].map(d => path.join(__dirname, 'results', d))]) {
  const { rows } = readBenchmarkRows(dir);
  for (const r of rows) {
    if (!r.referenced || r.cer == null || /-b$/.test(r.engine)) continue;
    const k = `${r.stratum}|${r.slug}`, e = scored.get(k) || { meta: r, engines: {} };
    if (!(r.engine in e.engines)) e.engines[r.engine] = r.cer;
    scored.set(k, e);
  }
}
const syr = JSON.parse(fs.readFileSync(path.join(BENCHMARK_DIR, 'syriac-retest-2026-09-16/score.json'), 'utf8'))['syriac-gt'];

// ── 3. Mongo (read only) ────────────────────────────────────────────────────────────────────
const trBooks = new Set(), trPages = [], ocrBookPages = [];
for (const s of trSets) for (const p of s.pages) if (s.chart !== 'tibetan') { trBooks.add(p.book); const m = p.page.match(/^(.*)_(\d+)$/); trPages.push({ book: m[1], n: +m[2], key: p.page }); }
for (const v of Object.values(ocrSets)) for (const k of v.pages) { const reg = registry.get(k.split('|')[1]); if (reg?.book_id) ocrBookPages.push({ book: reg.book_id, n: reg.page_number, key: k }); }
const tibPageIds = [...new Set(trSets.filter(s => s.chart === 'tibetan').flatMap(s => s.pages.map(p => p.page)))];
log(`mongo: ${trBooks.size} translation books, ${ocrBookPages.length} OCR book pages, ${tibPageIds.length} Tibetan sides`);
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const asIds = ids => [...new Set(ids)].flatMap(id => (/^[0-9a-f]{24}$/.test(id) ? [id, new ObjectId(id)] : [id]));
const BOOK_PROJ = { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, languages: 1, 'image_source.provider': 1, 'image_source.contributing_library': 1, contributing_library: 1, book_class: 1, tradition: 1, categories: 1, work_id: 1, work_title: 1, pages_count: 1, visible: 1, edition_key: 1 };
const tibSides = await db.collection('pages').find({ _id: { $in: asIds(tibPageIds) } }, { projection: { book_id: 1, page_number: 1, page_type: 1, photo: 1, archived_photo: 1 } }).toArray();
const tibSide = new Map(tibSides.map(p => [String(p._id), p]));
const allBookIds = [...trBooks, ...ocrBookPages.map(p => p.book), ...tibSides.map(p => p.book_id)];
const books = await db.collection('books').find({ $or: [{ id: { $in: [...new Set(allBookIds)] } }, { _id: { $in: asIds(allBookIds) } }] }, { projection: BOOK_PROJ }).toArray();
const bookOf = new Map(); for (const b of books) { bookOf.set(String(b.id), b); bookOf.set(String(b._id), b); }
async function pagesFor(list, withText) {
  const out = new Map();
  const byBook = new Map(); for (const p of list) { if (!byBook.has(p.book)) byBook.set(p.book, []); byBook.get(p.book).push(p); }
  const ids = [...byBook.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const ors = chunk.flatMap(b => { const bk = bookOf.get(b); const keys = new Set([b, bk?.id, bk && String(bk._id)].filter(Boolean)); return [...keys].map(k => ({ book_id: k, page_number: { $in: byBook.get(b).map(p => p.n) } })); });
    const rows = await db.collection('pages').find({ $or: ors, page_number: { $gt: 0 } }, { projection: { book_id: 1, page_number: 1, page_type: 1, photo: 1, archived_photo: 1, ...(withText ? { 'ocr.data': 1 } : {}) } }).toArray();
    for (const r of rows) { const bk = bookOf.get(String(r.book_id)); for (const k of [String(r.book_id), bk?.id, bk && String(bk._id)].filter(Boolean)) out.set(`${k}|${r.page_number}`, r); }
  }
  return out;
}
const trPageDocs = await pagesFor(trPages, false);
const ocrPageDocs = await pagesFor(ocrBookPages, true);

// Production corpus per language (check 5): live books, weighted by pages.
const CORPUS_LANGS = { Latin: ['Latin'], Greek: ['Greek', 'Ancient Greek'], German: ['German'], French: ['French'], Italian: ['Italian'], Dutch: ['Dutch'], Spanish: ['Spanish'], Hebrew: ['Hebrew'], Aramaic: ['Aramaic'],
  Arabic: ['Arabic'], Persian: ['Persian'], Sanskrit: ['Sanskrit'], Pali: ['Pali'], Chinese: ['Chinese', 'Classical Chinese'], Tibetan: ['Tibetan'], English: ['English'], Armenian: ['Armenian'], Syriac: ['Syriac'] };
const century = y => (typeof y === 'number' && y > 0 && y < 2100 ? `${Math.floor(y / 100) + 1}c` : 'unknown');
const dims = b => ({ century: century(b?.year), provider: b?.image_source?.provider || 'unknown', tradition: (b?.tradition || [])[0] || 'unknown', genre: (b?.categories || [])[0] || 'unknown',
  hand: b?.book_class?.class || 'unclassified' });
const corpus = {};
for (const [lang, names] of Object.entries(CORPUS_LANGS)) {
  const agg = await db.collection('books').aggregate([{ $match: { visible: true, pages_count: { $gt: 0 }, language: { $in: names } } },
    { $project: { year: 1, pages_count: 1, p: '$image_source.provider', t: { $arrayElemAt: ['$tradition', 0] }, g: { $arrayElemAt: ['$categories', 0] }, h: '$book_class.class' } }]).toArray();
  const d = { books: agg.length, pages: 0, century: {}, provider: {}, tradition: {}, genre: {}, hand: {} };
  for (const b of agg) {
    const w = b.pages_count; d.pages += w;
    const x = { century: century(b.year), provider: b.p || 'unknown', tradition: b.t || 'unknown', genre: b.g || 'unknown', hand: b.h || 'unclassified' };
    for (const [k, v] of Object.entries(x)) d[k][v] = (d[k][v] || 0) + w;
  }
  corpus[lang] = d;
}
await client.close();
log('mongo: done');

// ── 4. one row per panel page ───────────────────────────────────────────────────────────────
const rows = [];
const trLangOf = { latin: 'Latin', greek: 'Greek', german: 'German', french: 'French', italian: 'Italian', dutch: 'Dutch', spanish: 'Spanish', hebrew: 'Hebrew', aramaic: 'Aramaic', arabic: 'Arabic', persian: 'Persian', sanskrit: 'Sanskrit', pali: 'Pali', chinese: 'Chinese', tibetan: 'Tibetan' };
const ratioByLang = {};
const trText = new Map();   // for the draw only
for (const s of trSets) {
  const lang = trLangOf[s.chart];
  for (const p of s.pages) {
    const row = { family: 'translation', chart: s.chart, panel: s.kind, page: p.page, lang, hard: [], soft: [] };
    let src, ref, meta = {};
    if (lang === 'Tibetan') {
      const t = tibIn.get(p.page), side = tibSide.get(p.page), b = side && bookOf.get(String(side.book_id));
      src = t?.source; ref = t?.reference;
      row.book = p.book; row.work = p.book; row.book_id = side ? String(side.book_id) : null; row.page_number = side?.page_number ?? null;
      row.title = t?.text_title || b?.title || p.book; row.dims = dims(b); row.page_type = side?.page_type ?? null;
      row.reference = t?.reference_source || null; row.set = t?.set || null;
      row.famous = row.set === 'tib-ref113' ? '84000 English online' : null;   // 84000 publishes its English openly
      const j = tibJudge.get(p.page) || {};
      const spans = Object.values(j).flatMap(x => x.spans);
      row.span_off_share = spans.length ? r3(spans.filter(x => x !== 'same').length / spans.length) : null;
      if (row.span_off_share >= 0.5) row.soft.push('side-boundary');   // most candidates off the side: the cut, not the engines
      const al = tibAlign.get(p.page); if (al) row.ref_alignment = { verse_share: al.verse_share, ref_lang: al.ref_lang };
      row.image = side?.archived_photo || side?.photo || null;
    } else {
      const r = xlRec.get(p.page);
      src = r?.ocr_text; ref = r?.reference_text; meta = r?.reference_meta || {};
      const b = bookOf.get(r?.book_id || p.book), doc = trPageDocs.get(`${r?.book_id || p.book}|${r?.page_number}`);
      row.book = p.book; row.book_id = r?.book_id; row.page_number = r?.page_number; row.title = r?.book?.display_title || r?.book?.title || b?.title;
      row.work = b?.work_id || `book:${p.book}`; row.dims = dims(b); row.page_type = doc?.page_type ?? null; row.image = doc?.archived_photo || doc?.photo || null;
      row.reference = [meta.title, meta.translator, meta.year].filter(Boolean).join(', '); row.reference_style = meta.style || null;
      row.reference_kind = meta.reference_kind || null;
      if (meta.reference_kind && meta.reference_kind !== 'translation') row.soft.push(`ref-kind:${meta.reference_kind}`);
      row.canonical = !!meta.canonical;
      row.famous = meta.canonical ? 'canonical reference' : (FAMOUS.test(`${row.title} ${meta.title || ''}`) ? 'famous title' : null);
      const j = xlJudge.get(p.page) || {};
      row.reference_fit = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v.fit]));
      const fits = Object.values(row.reference_fit);
      if (fits.some(f => ['wrong', 'offset', 'cant_tell'].includes(f))) row.hard.push(`ref-fit:${fits.find(f => ['wrong', 'offset', 'cant_tell'].includes(f))}`);
      else if (fits.includes('narrower')) row.soft.push('ref-narrower');
      const spans = Object.values(j).flatMap(x => x.spans);
      row.span_off_share = spans.length ? r3(spans.filter(x => x !== 'same').length / spans.length) : null;
      if (row.span_off_share >= 0.5) row.soft.push('span-off');
    }
    const pc = pageChecks(src || '', lang, { pageType: row.page_type });
    Object.assign(row, pc.m); row.hard.push(...pc.hard); row.soft.push(...pc.soft);
    // check 3: alignment by length, numbers, names
    const srcLetters = pc.m.letters, refChars = (ref || '').replace(/\s/g, '').length;
    row.ref_chars = refChars; row.len_ratio = srcLetters ? r3(refChars / srcLetters) : null;
    const nums = s => new Set((stripTags(s || '').match(/\d{2,}/g) || []));
    const sn = nums(src), rn = nums(ref);
    row.numbers = { source: sn.size, in_reference: [...sn].filter(x => rn.has(x)).length };
    if (LATIN_LANGS.has(lang)) {
      const caps = s => (stripTags(s || '').match(/(?<=[\s,;:(])\p{Lu}\p{Ll}{4,}/gu) || []).map(w => w.slice(0, 4).toLowerCase());
      const sc = new Set(caps(src)), rc = new Set(caps(ref));
      row.names = { source: sc.size, in_reference: [...sc].filter(x => rc.has(x)).length };
    }
    // A packet that does not carry the text leaves the page unchecked; that is not a finding against it.
    row.unchecked = [!src && 'no-source-text', !ref && 'no-reference-text'].filter(Boolean);
    if (!src) row.hard = row.hard.filter(f => !/^(near-empty|script|language)/.test(f));
    (ratioByLang[lang] ||= []).push(row.len_ratio);
    trText.set(`${s.chart}|${p.page}`, { src, ref });
    rows.push(row);
  }
}
// length ratio outliers within a language (check 3)
for (const row of rows.filter(r => r.family === 'translation')) {
  const med = median(ratioByLang[row.lang]);
  row.len_ratio_vs_lang = med && row.len_ratio != null ? r3(row.len_ratio / med) : null;
  if (row.len_ratio_vs_lang != null && (row.len_ratio_vs_lang < 0.4 || row.len_ratio_vs_lang > 2.5)) row.soft.push('len-ratio');
  if (row.numbers.source >= 3 && row.numbers.in_reference === 0 && row.lang !== 'Tibetan') row.soft.push('numbers-unmatched');
}

const OCR_LANG = { latin: 'Latin', english: 'English', 'latin-script-other': null, greek: 'Greek', 'chinese-manuscript': 'Chinese', 'chinese-print': 'Chinese', armenian: 'Armenian', syriac: 'Syriac' };
const ocrText = new Map();
// normalisation signals (check 7): marks a scan keeps that an edited e-text expands or modernises
const ABBR = /[āēīōūȳãẽĩõũñꝑꝓꝗꝙꝯ⁊&]|̃|̄|q;|\bq̃/gu;
const normSignals = t => {
  const s = stripTags(t || '').normalize('NFC');
  const words = (s.toLowerCase().match(/\p{Script=Latin}+/gu) || []);
  const medialV = words.filter(w => /\Bv\B/.test(w)).length, medialU = words.filter(w => /^[^u]*[aeiou]u[aeiou]/.test(w)).length;
  return { words: words.length, abbr: (s.match(ABBR) || []).length, long_s: (s.match(/ſ/g) || []).length, medial_v: medialV, u_for_v: medialU, ae: (s.match(/[æœ]/g) || []).length };
};
for (const [chart, set] of Object.entries(ocrSets)) {
  for (const k of set.pages) {
    const [stratum, slug] = k.split('|');
    const reg = registry.get(slug), sc = scored.get(k);
    const rf = stratum === 'syriac-gt' ? {} : refOf(stratum, slug), rec = rf.rec;
    const row = { family: 'ocr', chart, panel: 'most-pages', page: k, stratum, hard: [], soft: [] };
    let ref = null;
    if (stratum === 'syriac-gt') {
      row.book = slug.split('-')[0]; row.work = row.book; row.title = `Syriac GT ${row.book}`;
      const engs = syr.pages[slug] || {}; row.cers = Object.fromEntries(Object.entries(engs).filter(([, e]) => typeof e.cer_n2 === 'number').map(([n, e]) => [n, Math.min(1, e.cer_n2)]));
      row.reference_kind = 'line-by-line ground truth of this manuscript';
      row.image = null;
    } else {
      ref = rf.text;
      row.ref_private = !!rf.private; row.unchecked = ref ? [] : [`no-reference-text:${rf.skipped}`];
      row.book_id = reg?.book_id || rec?.book_id || null; row.page_number = reg?.page_number ?? (rec?.page_number != null ? +rec.page_number : null);
      const b = row.book_id ? bookOf.get(row.book_id) : null;
      row.title = reg?.title || sc?.meta?.title || b?.title || slug; row.year = reg?.year ?? sc?.meta?.year ?? null;
      row.book = row.book_id || slug.replace(/-p\d+$/, '').replace(/-ws\d+$/, '');
      row.work = b?.work_id || rec?.work || reg?.work_id || row.book;
      row.dims = row.book_id ? dims(b) : { century: century(row.year), provider: stratum === 'ref-ws' ? 'wikisource (external scan)' : 'external', tradition: 'unknown', genre: 'unknown', hand: 'unclassified' };
      row.reference_kind = rec?.reference_kind || rec?.kind || rec?.source || null;
      row.reference_edition = rec?.edition || rec?.source || rec?.source_url || rec?.url || null;
      row.reference_source = [rec?.source, rec?.edition].filter(Boolean).join(' | ') || null;
      row.witness = rec?.witness || null; row.skqs_shape = reg?.skqs_shape ?? null;
      row.memorization_risk = rec?.memorization_risk || null; row.canonical = rec?.canonical ?? null;
      row.leaf_check = rec?.leaf_check?.status || null; row.overlap = rec?.overlap ?? rec?.window?.overlap ?? null;
      if (rec?.leaf_check && rec.leaf_check.status !== 'ok') row.hard.push(`leaf-check:${rec.leaf_check.status}`);
      row.cers = sc ? sc.engines : {};
      const doc = row.book_id ? ocrPageDocs.get(`${row.book_id}|${row.page_number}`) : null;
      row.page_type = doc?.page_type ?? null; row.image_url = doc?.archived_photo || doc?.photo || reg?.image_url || null;
      const lang = OCR_LANG[chart] || reg?.language?.split(/[;,]/)[0].replace(/^Ancient /, '') || sc?.meta?.language || 'German';
      row.lang = lang;
      const stored = doc?.ocr?.data || null;
      const pc = pageChecks(ref || '', lang, { pageType: row.page_type });
      Object.assign(row, pc.m);
      row.ref_chars = (ref || '').replace(/\s/g, '').length; row.page_chars = stored ? stripTags(stored).replace(/\s/g, '').length : null;
      row.ref_share_of_page = row.page_chars ? r3(row.ref_chars / row.page_chars) : null;
      // the reference is a passage of the page: the measure then covers that passage, not the page
      const passage = stratum === 'ref-ws' || stratum === 'ref-pinned';
      if (ref) {
        row.hard.push(...pc.hard.filter(f => !(passage && /^near-empty/.test(f))));
        row.soft.push(...pc.soft);
        if (row.ref_share_of_page != null && row.ref_share_of_page < 0.25) row.soft.push(`ref-covers:${row.ref_share_of_page}`);
        if (row.page_chars != null) { const kc = pageChecks(stored, lang, { pageType: row.page_type }); row.page_kind = kc.m; if (kc.m.letters < (/^chinese/.test(chart) ? 100 : 300)) row.soft.push('page-short'); if (kc.m.digit_share > 0.2) row.soft.push('page-numeric'); }
      }
      // check 7: is the reference a transcription of THIS scan?
      if (LATIN_LANGS.has(lang) && ref) {
        const a = normSignals(stored), b2 = normSignals(ref);
        row.norm = { scan: a, reference: b2 };
        // the scan abbreviates (≥ 5 marks per 1,000 words) and the reference keeps under a fifth as many
        if (a.words > 50 && b2.words > 50) {
          const ra = (1000 * a.abbr) / a.words, rb = (1000 * b2.abbr) / b2.words;
          if (ra >= 5 && rb < ra / 5) row.soft.push('ref-expands-abbreviations');
          const ua = a.u_for_v / a.words, ub = b2.u_for_v / b2.words;
          if (ua >= 0.02 && ub < ua / 4) row.soft.push('ref-normalises-u-v');
        }
      }
      const imgDir = path.join(OCR_BENCH, stratum);
      const img = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).find(f => f === `${slug}.jpg` || f.startsWith(`${slug}.`)) : null;
      row.image = img ? path.join(imgDir, img) : null;
      ocrText.set(k, { ref, stored });
    }
    const c = Object.values(row.cers || {});
    row.best_cer = c.length ? r3(Math.min(...c)) : null; row.median_cer_all = r3(median(c));
    const printed = !/manuscript|syriac/.test(chart);
    if (row.best_cer != null && row.best_cer > (printed ? 0.35 : 0.6)) row.hard.push(`best-engine-cer:${row.best_cer}`);
    else if (row.best_cer != null && row.best_cer > (printed ? 0.15 : 0.35)) row.soft.push(`best-engine-cer:${row.best_cer}`);
    if (row.overlap != null && row.overlap < 0.5) row.soft.push(`ref-overlap:${row.overlap}`);
    rows.push(row);
  }
}
// Reference nature by stratum (check 7): same scan, same edition, or another edition of the work.
const REF_NATURE = {
  'eebo-tcp-5488': 'same edition (EEBO-TCP keyed from the same microfilm; TCP expands some abbreviations and marks gaps)',
  'latin-period-5126': 'mixed: Wikisource page of the same printed edition, or a corrected transcription matched to the leaf',
  'ref-ws': 'same scan (Wikisource proofread transcription of the scan itself; page images are Wikisource\'s, not ours)',
  'ref-pinned': 'published e-text pinned to the leaf (often another edition)', greek: 'another edition: First1KGreek / Perseus TEI of the work',
  'greek-ext': 'another edition: First1KGreek / Perseus / el.wikisource TEI of the work', 'greek-ext2': 'another edition: First1KGreek / Perseus / el.wikisource TEI of the work',
  chinese: 'another witness: Kanripo (Siku Quanshu) or CBETA e-text of the work', 'chinese-ext': 'another witness: Kanripo (Siku Quanshu) or CBETA e-text of the work',
  'chinese-cohort-5547': 'Kanripo Siku Quanshu e-text: the same recension where the scan has the SKQS layout (skqs_shape), another witness where it does not', 'syriac-gt': 'same manuscript, line-by-line ground truth',
};
for (const r of rows.filter(r => r.family === 'ocr')) {
  r.reference_nature = REF_NATURE[r.stratum] || null;
  r.other_edition = r.stratum === 'chinese-cohort-5547' ? r.skqs_shape === false : (/^another/.test(r.reference_nature || '') || (r.stratum === 'ref-pinned' && !/same edition|page-scan|leaf itself/i.test(r.reference_source || '')));
}

// ── 5. per panel ────────────────────────────────────────────────────────────────────────────
const tvd = (a, b) => { const ta = Object.values(a).reduce((s, x) => s + x, 0) || 1, tb = Object.values(b).reduce((s, x) => s + x, 0) || 1; const ks = new Set([...Object.keys(a), ...Object.keys(b)]); let d = 0; for (const k of ks) d += Math.abs((a[k] || 0) / ta - (b[k] || 0) / tb); return r3(d / 2); };
const gaps = (a, b) => { const ta = Object.values(a).reduce((s, x) => s + x, 0) || 1, tb = Object.values(b).reduce((s, x) => s + x, 0) || 1; const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...ks].map(k => ({ k, sample: r3((a[k] || 0) / ta), corpus: r3((b[k] || 0) / tb) })).map(x => ({ ...x, d: r3(x.sample - x.corpus) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 3); };
const panelKey = r => `${r.family}|${r.chart}|${r.panel}`;
const panels = {};
for (const r of rows) (panels[panelKey(r)] ||= []).push(r);
const corpusLangOf = (fam, chart, rs) => (fam === 'translation' ? trLangOf[chart] : OCR_LANG[chart] || 'German');
const panelOut = {};
for (const [k, rs] of Object.entries(panels)) {
  const [fam, chart, panel] = k.split('|');
  const lang = corpusLangOf(fam, chart, rs);
  const perBook = count(rs, r => r.book), perWork = count(rs, r => r.work);
  const refDup = fam === 'translation' ? Object.entries(count(rs.filter(r => r.reference), r => r.reference)).filter(([, n]) => n > 1) : [];
  const sampleDims = {}; for (const r of rs) for (const [d, v] of Object.entries(r.dims || {})) { sampleDims[d] ||= {}; sampleDims[d][v] = (sampleDims[d][v] || 0) + 1; }
  const cov = {}; for (const d of ['century', 'provider', 'tradition', 'genre', 'hand']) cov[d] = { tvd: tvd(sampleDims[d] || {}, corpus[lang]?.[d] || {}), top_gaps: gaps(sampleDims[d] || {}, corpus[lang]?.[d] || {}) };
  panelOut[k] = {
    family: fam, chart, panel, lang, n: rs.length,
    unchecked: rs.filter(r => r.unchecked?.length).length, hard: rs.filter(r => r.hard.length).length, soft_only: rs.filter(r => !r.hard.length && r.soft.length).length,
    flags: count(rs.flatMap(r => [...r.hard.map(x => `H ${x.split(':')[0]}`), ...r.soft.map(x => `S ${x.split(':')[0]}`)])),
    letters: { median: median(rs.map(r => r.letters)), under_300: rs.filter(r => r.letters < 300).length },
    books: Object.keys(perBook).length, works: Object.keys(perWork).length, max_per_book: Math.max(...Object.values(perBook)), max_per_work: Math.max(...Object.values(perWork)),
    works_with_2plus: Object.entries(perWork).filter(([, n]) => n > 1).map(([w, n]) => [w, n]).slice(0, 12), reference_reused: refDup.slice(0, 12),
    famous: rs.filter(r => r.famous).length, coverage: cov, corpus_books: corpus[lang]?.books, corpus_pages: corpus[lang]?.pages,
    ...(fam === 'ocr' ? { reference_nature: count(rs, r => r.reference_nature), other_edition: rs.filter(r => r.other_edition).length, memorization_risk: count(rs, r => r.memorization_risk) } : {}),
    ...(fam === 'translation' ? { reference_fit_J1: count(rs, r => r.reference_fit?.J1 ?? 'none'), reference_styles: count(rs, r => r.reference_style) } : {}),
  };
}
// cross-panel duplicates (check 4): a book in more than one chart of the same family
const dupBooks = {};
for (const fam of ['translation', 'ocr']) {
  const byBook = {}; for (const r of rows.filter(r => r.family === fam)) (byBook[r.book] ||= new Set()).add(r.chart);
  dupBooks[fam] = Object.entries(byBook).filter(([, s]) => s.size > 1).map(([b, s]) => [b, [...s]]);
}

// ── 6. memorisation: do engine ranks differ between famous and obscure pages? (#6182 panels) ──
const sc6182 = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/pareto-6182/xljudge/scores.json'), 'utf8'));
const famousPage = new Map(rows.filter(r => r.family === 'translation').map(r => [r.page, !!r.famous]));
const ARMS = ['L31', 'L35', 'FP', 'G35', 'G36', 'G37', 'G38', 'PRO'];
const spearman = (a, b) => { const rank = xs => { const s = xs.map((x, i) => [x, i]).sort((p, q) => q[0] - p[0]); const r = []; s.forEach(([, i], j) => { r[i] = j + 1; }); return r; }; const ra = rank(a), rb = rank(b), n = a.length; let d = 0; for (let i = 0; i < n; i++) d += (ra[i] - rb[i]) ** 2; return r3(1 - (6 * d) / (n * (n * n - 1))); };
const fidOf = (r, a) => { const js = Object.values(r.J).map(j => j[a]?.fid).filter(x => typeof x === 'number'); return js.length ? js.reduce((s, x) => s + x, 0) / js.length : null; };
const pools = { Latin: ['Latin'], Greek: ['Greek'], T3: ['German', 'French', 'Italian', 'Dutch', 'Spanish'], T4: ['Hebrew', 'Aramaic', 'Arabic', 'Persian'], T5: ['Sanskrit', 'Pali', 'Chinese'] };
const memo = {};
for (const [pool, langs] of Object.entries(pools)) {
  const rs = sc6182.rows.filter(r => langs.includes(r.lang) && ARMS.every(a => r.arms.includes(a)));
  const split = { famous: rs.filter(r => famousPage.get(pkey(r.page_id))), obscure: rs.filter(r => !famousPage.get(pkey(r.page_id))) };
  const means = Object.fromEntries(Object.entries(split).map(([k, xs]) => [k, Object.fromEntries(ARMS.map(a => [a, r3(xs.map(r => fidOf(r, a)).filter(x => x != null).reduce((s, x, _, arr) => s + x / arr.length, 0))]))]));
  memo[pool] = { n_famous: split.famous.length, n_obscure: split.obscure.length, means, spearman: split.famous.length >= 5 ? spearman(ARMS.map(a => means.famous[a]), ARMS.map(a => means.obscure[a])) : null,
    top_famous: ARMS.reduce((b, a) => (means.famous[a] > means.famous[b] ? a : b)), top_obscure: ARMS.reduce((b, a) => (means.obscure[a] > means.obscure[b] ? a : b)) };
}
// OCR: engine order on high vs low memorisation-risk references, per chart where both are present
const memoOcr = {};
for (const [chart, set] of Object.entries(ocrSets)) {
  const rs = rows.filter(r => r.family === 'ocr' && r.chart === chart);
  const hi = rs.filter(r => r.memorization_risk === 'high'), lo = rs.filter(r => r.memorization_risk && r.memorization_risk !== 'high');
  if (hi.length < 5 || lo.length < 5) { memoOcr[chart] = { n_high: hi.length, n_low: lo.length }; continue; }
  const med = (xs, e) => r3(median(xs.map(r => r.cers?.[e]).filter(x => x != null)));
  const es = set.engines.filter(e => hi.every(r => r.cers?.[e] != null) && lo.every(r => r.cers?.[e] != null));
  memoOcr[chart] = { n_high: hi.length, n_low: lo.length, engines: Object.fromEntries(es.map(e => [e, { high: med(hi, e), low: med(lo, e) }])),
    spearman: es.length >= 3 ? spearman(es.map(e => -med(hi, e)), es.map(e => -med(lo, e))) : null };
}

// ── 7a. what the charts drop, and the limits they state ─────────────────────────────────────────
// Dropped: the reference does not cover the page (the judges' own reference_fit wrong / offset / cant_tell,
// or a by-eye reading), the page is mostly another language or script, or on a printed page no engine
// comes within 35% CER of the reference (Syriac is kept: its ground truth is of the same manuscript, and
// a page nothing reads is a finding about the engines). By-eye "unfit" pages are dropped unless the only
// cause is memorisation (stated as a limit instead) or the packet carries no reference text to check.
const EYE_FILE = path.join(RESULTS, 'eye.json');
const eye = fs.existsSync(EYE_FILE) ? JSON.parse(fs.readFileSync(EYE_FILE, 'utf8')) : [];
const eyeOf = new Map(eye.map(e => [`${e.family}|${e.family === 'translation' ? pkey(e.page) : e.page}`, e]));
const autoDrop = r => (r.family === 'translation' ? r.hard.filter(f => /^(ref-fit|script|language)/.test(f)) : (r.stratum === 'syriac-gt' ? [] : r.hard));
const eyeDrop = (r, e) => e && e.verdict === 'unfit' && !(r.unchecked || []).length
  && !(e.memorisation_risk === 'high' && e.page_kind === 'body' && /^same-(span|scan)$/.test(e.reference_fit));
const dropOf = new Map();
for (const r of rows) {
  const e = eyeOf.get(`${r.family}|${r.page}`);
  const why = [...autoDrop(r), ...(eyeDrop(r, e) ? [`by eye (${e.draw_id}): ${e.page_kind}, reference ${e.reference_fit}`] : [])];
  if (why.length && !dropOf.has(`${r.family}|${r.page}`)) dropOf.set(`${r.family}|${r.page}`, { family: r.family, chart: r.chart, page: r.page, why });
}
const dropped = r => dropOf.has(`${r.family}|${r.page}`);
// Panel notes: counted on the pages the chart keeps, worded per .claude/docs/quality-statements.md.
const pct = (a, b) => `${a} of ${b}`;
const notes = { translation: {}, ocr: {} };
const memoByLang = { Latin: 'Latin', Greek: 'Greek', German: 'T3', French: 'T3', Italian: 'T3', Dutch: 'T3', Spanish: 'T3', Hebrew: 'T4', Aramaic: 'T4', Arabic: 'T4', Persian: 'T4', Sanskrit: 'T5', Pali: 'T5', Chinese: 'T5' };
for (const [k, rsAll] of Object.entries(panels)) {
  const [fam, chart, panel] = k.split('|');
  const rs = rsAll.filter(r => !dropped(r)), n = rs.length, nd = rsAll.length - n, out = [];
  if (nd) out.push(`Sample check, 8 Oct 2026 (#6304): ${nd} of ${rsAll.length} pages left out because ${fam === 'translation' ? 'the published translation does not cover the page, or the page is mostly in another language' : 'the reference does not transcribe this page, or no engine came within 35% of it'}`);
  // The page already says so when pages share a book; this adds the case where books share a work.
  const works = new Set(rs.map(r => r.work)).size, books = new Set(rs.map(r => r.book)).size;
  if (books === n && works < 0.9 * n) out.push(`${n} pages come from ${works} works, so the intervals are too narrow`);
  if (fam === 'translation') {
    const narrower = rs.filter(r => r.reference_fit?.J1 === 'narrower').length;
    if (narrower >= 0.15 * n) out.push(`On ${pct(narrower, n)} pages the published translation covers less of the page than the engines translate (the judges' reading)`);
    const mixed = rs.filter(r => r.soft.includes('mixed-latin')).length;
    if (mixed >= 0.15 * n) out.push(`${pct(mixed, n)} pages carry Latin beside the ${rsAll[0].lang} (a quarter or more of the letters)`);
    const fam_ = rs.filter(r => r.famous).length, mm = memo[memoByLang[rsAll[0].lang]];
    if (fam_ >= 0.3 * n) out.push(`${pct(fam_, n)} pages are texts whose published translation is ${rsAll[0].lang === 'Tibetan' ? "84000's, which is openly online" : 'widely reproduced'}, so a model may recall it${mm?.spearman >= 0.8 && panel === 'gemini-models-6182' ? `; on those pages the engines keep the same order (rank correlation ${mm.spearman} with the other pages)` : ''}`);
    const short = rs.filter(r => r.letters < 300).length;
    if (short >= 0.3 * n) out.push(`${pct(short, n)} pages hold fewer than 300 characters of source text`);
  } else {
    const other = rs.filter(r => r.other_edition).length;
    if (other >= 0.15 * n) out.push(`On ${pct(other, n)} pages the reference is a modern edition or e-text of the work, not a transcription of this ${/manuscript/.test(chart) ? 'manuscript' : 'print'}, so the score is agreement with that text`);
    const norm = rs.filter(r => r.soft.some(f => /^ref-(expands|normalises)/.test(f))).length;
    if (norm >= 0.1 * n) out.push(`On ${pct(norm, n)} pages the reference expands abbreviations or modernises u and v where the print does not, which counts against an engine that copies the print`);
    const ext = rs.filter(r => r.stratum === 'ref-ws').length;
    if (ext >= 0.15 * n) out.push(`${pct(ext, n)} pages are Wikisource's own scans, not this library's`);
    const over = rs.filter(r => r.ref_share_of_page != null && r.ref_share_of_page > 1.15).length;
    if (over >= 0.1 * n) out.push(`On ${pct(over, n)} pages the reference runs more than 15% longer than the page's stored transcription, mostly text of the neighbouring leaf that no engine can match`);
  }
  if (out.length) notes[fam][`${chart}|${panel}`] = out;
}

// ── 7. sensitivity (check 8): rebuild every panel without the flagged pages ────────────────────
const SENS = {
  drops: r => dropped(r),
  hard: r => r.hard.length > 0,
  'hard+soft': r => r.hard.length > 0 || r.soft.length > 0,
  famous: r => !!r.famous || r.memorization_risk === 'high',
  'other-edition': r => !!r.other_edition,
  'normalised-ref': r => r.soft.some(f => /^ref-(expands-abbreviations|normalises-u-v)/.test(f)),
  'ref-misfit': r => r.hard.some(f => /^ref-fit/.test(f)) || r.soft.includes('ref-narrower'),
  'mixed-script': r => r.soft.includes('mixed-latin') || r.hard.some(f => /^(script|language):/.test(f)),
  'second-page-of-work': (() => { const seen = new Set(); return r => { const k = `${panelKey(r)}|${r.work}`; if (seen.has(k)) return true; seen.add(k); return false; }; })(),
};
const yOf = (fam, x) => (fam === 'ocr' ? x.accuracy : x.fidelity);
function comparePanels(fam, base, alt) {
  const out = [];
  for (const c of base.charts) for (const p of c.panels) {
    const a = alt.charts.find(x => x.id === c.id)?.panels.find(x => x.kind === p.kind);
    const rec = { chart: c.id, panel: p.kind, n: p.n_pages, n_after: a?.n_pages ?? 0 };
    if (!a) { rec.gone = true; out.push(rec); continue; }
    const order = q => [...q.placed].sort((x, y) => yOf(fam, y) - yOf(fam, x) || x.engine.localeCompare(y.engine)).map(x => x.engine);
    const ob = order(p), oa = order(a);
    rec.top_before = ob[0]; rec.top_after = oa[0];
    rec.frontier_before = p.placed.filter(x => x.on_frontier).map(x => x.engine).sort(); rec.frontier_after = a.placed.filter(x => x.on_frontier).map(x => x.engine).sort();
    rec.frontier_changed = rec.frontier_before.join() !== rec.frontier_after.join();
    const prod = p.placed.find(x => x.production)?.engine;
    rec.production_rank = prod ? [ob.indexOf(prod) + 1, oa.indexOf(prod) + 1] : null;
    // swapped pairs, with the gap before and after, so a swap of two engines already within noise reads as such
    const val = (q, e) => yOf(fam, q.placed.find(x => x.engine === e));
    rec.swaps = [];
    for (let i = 0; i < ob.length; i++) for (let j = i + 1; j < ob.length; j++) {
      const [e1, e2] = [ob[i], ob[j]];
      if (oa.indexOf(e1) > oa.indexOf(e2)) rec.swaps.push({ pair: [e1, e2], before: r3(val(p, e1) - val(p, e2)), after: r3(val(a, e1) - val(a, e2)) });
    }
    rec.ci_overlap_swaps = rec.swaps.filter(s => { const ci = e => (fam === 'ocr' ? p.placed.find(x => x.engine === e).accuracy_ci95 : p.placed.find(x => x.engine === e).fidelity_ci95); const c1 = ci(s.pair[0]), c2 = ci(s.pair[1]); return !c1 || !c2 || c1[0] <= c2[1]; }).length;
    rec.y_shift = Object.fromEntries(ob.map(e => [e, r3(val(a, e) - val(p, e))]));
    out.push(rec);
  }
  return out;
}
const sensitivity = {};
for (const [name, pred] of Object.entries(SENS)) {
  const ex = { translation: [...new Set(rows.filter(r => r.family === 'translation' && pred(r)).map(r => r.page))], ocr: [...new Set(rows.filter(r => r.family === 'ocr' && pred(r)).map(r => r.page))] };
  fs.writeFileSync(`${OUT}/exclude-${name}-tr.json`, JSON.stringify(ex.translation)); fs.writeFileSync(`${OUT}/exclude-${name}-ocr.json`, JSON.stringify(ex.ocr));
  run('build-translation-pareto.mjs', ['--keep-dropped', `--exclude=${OUT}/exclude-${name}-tr.json`, `--out=${OUT}/tr-${name}.json`]);
  run('build-ocr-pareto.mjs', ['--keep-dropped', `--exclude=${OUT}/exclude-${name}-ocr.json`, `--out=${OUT}/ocr-${name}.json`]);
  sensitivity[name] = {
    excluded: { translation: ex.translation.length, ocr: ex.ocr.length },
    translation: comparePanels('translation', trChart, JSON.parse(fs.readFileSync(`${OUT}/tr-${name}.json`, 'utf8'))),
    ocr: comparePanels('ocr', ocrChart, JSON.parse(fs.readFileSync(`${OUT}/ocr-${name}.json`, 'utf8'))),
  };
}

// ── 8. the by-eye draw: one page per book, flagged and unflagged, across both families ─────────
function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rngOf(6304);
const shuffle = xs => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uniq = new Map(); for (const r of rows) if (!uniq.has(`${r.family}|${r.page}`)) uniq.set(`${r.family}|${r.page}`, r);
const groups = {
  'tr-latin-script': r => r.family === 'translation' && LATIN_LANGS.has(r.lang), 'tr-greek': r => r.family === 'translation' && r.lang === 'Greek',
  'tr-semitic': r => r.family === 'translation' && ['Hebrew', 'Aramaic', 'Arabic', 'Persian'].includes(r.lang), 'tr-indic-chinese': r => r.family === 'translation' && ['Sanskrit', 'Pali', 'Chinese'].includes(r.lang),
  'tr-tibetan': r => r.family === 'translation' && r.lang === 'Tibetan', 'ocr-latin-script': r => r.family === 'ocr' && ['latin', 'english', 'latin-script-other'].includes(r.chart),
  'ocr-greek': r => r.family === 'ocr' && r.chart === 'greek', 'ocr-chinese': r => r.family === 'ocr' && /^chinese/.test(r.chart),
};
const PER = { 'tr-latin-script': [5, 4], 'tr-greek': [4, 3], 'tr-semitic': [4, 3], 'tr-indic-chinese': [4, 3], 'tr-tibetan': [3, 3], 'ocr-latin-script': [5, 4], 'ocr-greek': [4, 3], 'ocr-chinese': [4, 3] };
const draw = [];
for (const [g, pred] of Object.entries(groups)) {
  const pool = [...uniq.values()].filter(pred).filter(r => r.image || r.image_url);
  const usedBooks = new Set();
  const pick = (xs, n) => { const out = []; for (const r of shuffle(xs)) { if (out.length >= n) break; if (usedBooks.has(r.book)) continue; usedBooks.add(r.book); out.push(r); } return out; };
  const [nf, nu] = PER[g];
  for (const [stratum, xs] of [['flagged', pick(pool.filter(r => r.hard.length || r.soft.length), nf)], ['unflagged', pick(pool.filter(r => !r.hard.length && !r.soft.length), nu)]]) {
    for (const r of xs) {
      const t = r.family === 'translation' ? trText.get(`${r.chart}|${r.page}`) : ocrText.get(r.page);
      draw.push({ group: g, stratum, family: r.family, chart: r.chart, page: r.page, lang: r.lang, title: r.title, book: r.book, flags: [...r.hard, ...r.soft], image: r.image || null, image_url: r.image_url || (typeof r.image === 'string' && /^https?:/.test(r.image) ? r.image : null),
        reference_label: r.reference || r.reference_edition || r.reference_nature || null, source_text: t?.src ?? t?.stored ?? null, reference_text: t?.ref ?? null });
    }
  }
}
// fetch images the readers need (archive/R2 are free reads); a local bench image wins
if (!process.argv.includes('--no-images')) {
  fs.mkdirSync(`${OUT}/img`, { recursive: true });
  for (const d of draw) {
    if (d.image && !/^https?:/.test(d.image)) { d.local_image = d.image; continue; }
    const url = d.image_url || d.image; if (!url) continue;
    const f = `${OUT}/img/${d.page.replace(/[^\w.-]+/g, '_')}.jpg`;
    if (!fs.existsSync(f)) { try { const res = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (res.ok) fs.writeFileSync(f, Buffer.from(await res.arrayBuffer())); } catch (e) { d.image_error = String(e.message || e); } }
    if (fs.existsSync(f)) d.local_image = f;
  }
}

// ── write ───────────────────────────────────────────────────────────────────────────────────
fs.writeFileSync(`${OUT}/pages.jsonl.gz`, zlib.gzipSync(rows.map(r => JSON.stringify(r)).join('\n') + '\n'));
fs.writeFileSync(`${OUT}/panels.json`, JSON.stringify({ panels: panelOut, cross_chart_books: dupBooks, corpus }, null, 1));
fs.writeFileSync(`${OUT}/sensitivity.json`, JSON.stringify(sensitivity, null, 1));
fs.writeFileSync(`${OUT}/memorisation.json`, JSON.stringify({ translation_6182: memo, ocr: memoOcr }, null, 1));
fs.writeFileSync(`${OUT}/draw.json`, JSON.stringify(draw, null, 1));
// summary.json: numbers and page ids only, no text; this is the file that is committed
const drops = [...dropOf.values()];
if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(RESULTS, 'drops.json'), JSON.stringify({ issue: 6304, generated_by: 'scripts/eval/audit-pareto-samples.mjs', rule: 'see section 7a of the script', drops, notes }, null, 1) + '\n');
}
const summary = { issue: 6304, drops, notes, generated_by: 'scripts/eval/audit-pareto-samples.mjs', panels: Object.values(panelOut).map(p => ({ ...p, coverage: Object.fromEntries(Object.entries(p.coverage).map(([d, v]) => [d, v])) })),
  flagged_pages: rows.filter(r => r.hard.length || r.soft.length).map(r => ({ family: r.family, chart: r.chart, panel: r.panel, page: r.page, hard: r.hard, soft: r.soft })),
  cross_chart_books: dupBooks, memorisation: { translation_6182: memo, ocr: memoOcr },
  sensitivity: Object.fromEntries(Object.entries(sensitivity).map(([k, v]) => [k, { excluded: v.excluded, translation: v.translation.map(({ y_shift, ...x }) => x), ocr: v.ocr.map(({ y_shift, ...x }) => x) }])) };
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
if (process.argv.includes('--write')) fs.writeFileSync(path.join(RESULTS, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');

// heads only
log(`rows ${rows.length} (translation ${rows.filter(r => r.family === 'translation').length}, ocr ${rows.filter(r => r.family === 'ocr').length})`);
for (const p of Object.values(panelOut)) log(`${p.family} ${p.chart} ${p.panel}: n ${p.n}, hard ${p.hard}, soft-only ${p.soft_only}, books ${p.books}, works ${p.works}, famous ${p.famous}`);
for (const [k, v] of Object.entries(sensitivity)) log(`sens ${k}: excl ${v.excluded.translation}/${v.excluded.ocr}; top changes ${[...v.translation, ...v.ocr].filter(x => x.top_before !== x.top_after).length}, frontier changes ${[...v.translation, ...v.ocr].filter(x => x.frontier_changed).length}, gone ${[...v.translation, ...v.ocr].filter(x => x.gone).length}`);
log(`draw ${draw.length} (${draw.filter(d => d.local_image).length} with an image)`);
log(`wrote ${OUT}`);
