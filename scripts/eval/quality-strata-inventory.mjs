#!/usr/bin/env node
// PRIOR ART: .claude/docs/eval-design-census/ (2026-09-25 snapshot: live pages per language × period against OCR
// reference pages only, a one-off, not a tool); scripts/eval/benchmark-dashboard-data.mjs (the `sufficiency` rows this
// reads: referenced books per cell, OCR only); scripts/eval/translation-corpus-audit/draw.mjs (the frame and period
// rule reused here). None counts, per stratum, the books measured by EVERY instrument (OCR reference, judged
// translation, translation against a published one) against the served corpus, or sizes a stratified sample over
// it. This is the inventory behind `.claude/docs/quality-rubric-and-sampling.md` §8 (#5984).
//
// Read-only and $0: one projection over live `books` on Atlas, plus files already committed on main.
//
//   node --env-file=<main>/.env.production.local scripts/eval/quality-strata-inventory.mjs [--out <dir>]
//
// Writes <out>/inventory.json and <out>/inventory.md (default scripts/eval/results/quality-strata-inventory-<date>/).
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const today = new Date().toISOString().slice(0, 10);
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, `scripts/eval/results/quality-strata-inventory-${today}`);

// The standing sample's targets (doc §6): a reported stratum needs 30 books (directional, eval-design §3.1) and
// 100 books for a rate at about ±10 points (n = z²·p(1−p)/E² = 96.04 at p = 0.5, rounded up to 97; 100 for drop-outs).
const DIRECTIONAL = 30;
const RATE_10PP = 100;
// Corpus-wide monthly sample sizes the doc prices (±5 pp needs about 385 under simple random sampling).
const MONTHLY_N = 400;

// Strata kept as rows: languages with ≥ 1% of live OCR'd pages; the rest pool into "Other languages".
const MIN_SHARE = 0.01;
const PERIODS = ['pre-1500', '1500s', '1600s', '1700s', '1800s', '1900+', 'unknown'];

function periodOfYear(y) {
  if (y == null || !Number.isFinite(y)) return 'unknown';
  if (y < 1500) return 'pre-1500';
  if (y < 1600) return '1500s';
  if (y < 1700) return '1600s';
  if (y < 1800) return '1700s';
  if (y < 1900) return '1800s';
  return '1900+';
}
// Same rule as translation-corpus-audit/draw.mjs periodOf(), applied to `published`; numeric `year` first.
function periodOfBook(b) {
  if (Number.isFinite(b.year) && !b.year_estimated) return periodOfYear(b.year);
  const m = String(b.published || '').match(/\b(1[0-9]\d\d|20[0-2]\d|[5-9]\d\d)\b/);
  return periodOfYear(m ? Number(m[1]) : null);
}
// Period labels used by the dashboard's sufficiency rows and by the xlref tracks.
const SUFF_PERIOD = { 'before 1500': 'pre-1500', '1500–1599': '1500s', '1600–1699': '1600s', '1700–1799': '1700s', '1800–1899': '1800s', '1900 on': '1900+' };
function periodOfLabel(s) {
  if (!s) return 'unknown';
  if (SUFF_PERIOD[s]) return SUFF_PERIOD[s];
  if (PERIODS.includes(s)) return s;
  const m = String(s).match(/(\d{3,4})/);
  return m ? periodOfYear(Number(m[1])) : 'unknown';
}
const LANG_ALIAS = { grc: 'Greek', gre: 'Greek', 'Ancient Greek': 'Greek', 'Classical Chinese': 'Chinese' };
const normLang = l => LANG_ALIAS[l] || l || 'Unknown';

// ── 1. The frame: live books, OCR'd and translated pages, per catalogue language × period ──
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI missing: run with --env-file=<main checkout>/.env.production.local');
const client = new MongoClient(uri);
await client.connect();
const books = client.db(process.env.MONGODB_DB || 'bookstore').collection('books');
const frame = new Map(); // key lang||period → {books, pages, ocr_pages, translated_pages, books_with_text}
let totals = { books: 0, pages: 0, ocr_pages: 0, translated_pages: 0 };
const cur = books.find(
  { visible: true, hidden: { $ne: true }, pages_count: { $gt: 0 } },
  { projection: { _id: 0, language: 1, published: 1, year: 1, year_estimated: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 } },
);
for await (const b of cur) {
  const k = `${normLang(b.language)}||${periodOfBook(b)}`;
  const r = frame.get(k) || { books: 0, pages: 0, ocr_pages: 0, translated_pages: 0, books_with_text: 0 };
  r.books++; r.pages += b.pages_count || 0; r.ocr_pages += b.pages_ocr || 0; r.translated_pages += b.pages_translated || 0;
  if ((b.pages_ocr || 0) > 0) r.books_with_text++;
  frame.set(k, r);
  totals.books++; totals.pages += b.pages_count || 0; totals.ocr_pages += b.pages_ocr || 0; totals.translated_pages += b.pages_translated || 0;
}

const langOcr = new Map();
for (const [k, r] of frame) { const l = k.split('||')[0]; langOcr.set(l, (langOcr.get(l) || 0) + r.ocr_pages); }
const keptLangs = new Set([...langOcr].filter(([, v]) => v / totals.ocr_pages >= MIN_SHARE).map(([l]) => l));
const rowLang = l => (keptLangs.has(normLang(l)) ? normLang(l) : 'Other languages');

// ── 2. What is measured today, in BOOKS (one page per book), from files on main ──
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const readJsonl = p => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const measured = new Map(); // key → {ocr_ref, judged, vs_human}
const bump = (lang, period, field, n = 1) => {
  const k = `${rowLang(lang)}||${period}`;
  const r = measured.get(k) || { ocr_ref: 0, judged: 0, vs_human: 0 };
  r[field] += n; measured.set(k, r);
};

// 2a. OCR accuracy: referenced books per language × period (the dashboard's sufficiency rows).
const evidence = read('src/data/ocr-benchmark-evidence.json');
for (const s of evidence.sufficiency.filter(s => s.factor === 'language_period')) {
  const [lang, per] = s.level.split(' · ');
  bump(lang, periodOfLabel(per), 'ocr_ref', s.referenced);
}
// 2b. Translation judged against its source (the #5274 audits), each book once across runs.
const AUDITS = ['translation-corpus-audit-2026-09-30', 'translation-corpus-audit-monthly-2026-09', 'translation-corpus-audit-chained-2026-10-01'];
const judgedBooks = new Map();
const auditPages = []; // for page-type and engine/prompt shares
for (const a of AUDITS) {
  for (const m of readJsonl(`scripts/eval/results/${a}/manifest.jsonl`)) {
    if (m.kind !== 'main') continue;
    auditPages.push({ ...m, audit: a });
    if (!judgedBooks.has(m.book_id)) judgedBooks.set(m.book_id, m);
  }
}
// Period and language come from the same Atlas rule as the frame, so a measured book lands in the row it is counted
// against (the audits stored their own period label). Look up by `id` OR `_id` (book-deletion-and-identity.md).
async function catalogueOf(ids) {
  const { ObjectId } = await import('mongodb');
  const oids = ids.filter(i => /^[0-9a-f]{24}$/.test(i)).map(i => new ObjectId(i));
  const found = new Map();
  const cur = books.find({ $or: [{ id: { $in: ids } }, { _id: { $in: oids } }] }, { projection: { id: 1, language: 1, published: 1, year: 1, year_estimated: 1 } });
  for await (const b of cur) { found.set(String(b.id || b._id), b); found.set(String(b._id), b); }
  return found;
}
const judgedCat = await catalogueOf([...judgedBooks.keys()]);
let judgedMissing = 0;
for (const [bid, m] of judgedBooks) {
  const b = judgedCat.get(bid);
  if (!b) judgedMissing++;
  bump(b?.language ?? m.language, b ? periodOfBook(b) : (m.period || 'unknown'), 'judged');
}
// 2c. Translation against a published human translation (#5695), one page per book.
const xl = readJsonl('scripts/eval/results/xlref-synthesis-2026-10/served-pages.jsonl');
const xlBooks = new Map();
for (const p of xl) { const bid = String(p.id).split('_')[0]; if (!xlBooks.has(bid)) xlBooks.set(bid, p); }
const xlCat = await catalogueOf([...xlBooks.keys()]);
let xlMissing = 0;
for (const [bid, p] of xlBooks) {
  const b = xlCat.get(bid);
  if (!b) xlMissing++;
  bump(b?.language ?? p.lang, b ? periodOfBook(b) : periodOfLabel(p.stratum), 'vs_human');
}
// Self-reported page types over every page carrying the tag (indexed, about 10 s). The tag is the OCR model's own
// guess (taxonomy O16), so this sizes the risky strata; it does not define them.
const pageTypes = await client.db(process.env.MONGODB_DB || 'bookstore').collection('pages').aggregate(
  [{ $group: { _id: '$page_type', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
  { hint: { page_type: 1, book_id: 1, page_number: 1 }, allowDiskUse: true, maxTimeMS: 400000 },
).toArray();
await client.close();

// ── 3. Rows, with Neyman allocation of a MONTHLY_N-book sample over served (OCR'd) pages ──
// S_h = sqrt(p(1−p)) with p = the language's judged major-defect share where one exists, else 0.5 (the
// conservative value). Neyman: n_h = n · N_h S_h / Σ N_k S_k (Penn State STAT 506, Lesson 6).
const byLang = read('src/data/quality-by-language.json');
const priorMajor = Object.fromEntries(byLang.rows.filter(r => r.translation?.any_major_defect != null).map(r => [r.language, r.translation.any_major_defect]));
const rows = [];
const merged = new Map();
for (const [k, r] of frame) {
  const [lang, per] = k.split('||');
  const kk = `${rowLang(lang)}||${per}`;
  const m = merged.get(kk) || { books: 0, pages: 0, ocr_pages: 0, translated_pages: 0, books_with_text: 0 };
  for (const f of Object.keys(m)) m[f] += r[f];
  merged.set(kk, m);
}
for (const [k, r] of merged) {
  if (r.ocr_pages === 0) continue;
  const [lang, period] = k.split('||');
  const p = priorMajor[lang] ?? 0.5;
  const m = measured.get(k) || { ocr_ref: 0, judged: 0, vs_human: 0 };
  rows.push({ language: lang, period, ...r, share_ocr_pages: r.ocr_pages / totals.ocr_pages, prior_p: p, prior_from: priorMajor[lang] != null ? 'audit major-defect share' : 'none (0.5)', S: Math.sqrt(p * (1 - p)), ...m });
}
const sumNS = rows.reduce((s, r) => s + r.ocr_pages * r.S, 0);
for (const r of rows) {
  r.neyman_n = (MONTHLY_N * r.ocr_pages * r.S) / sumNS;
  r.proportional_n = MONTHLY_N * r.share_ocr_pages;
  // A stratum we REPORT gets at least DIRECTIONAL books, capped by the books it has (a census below that).
  r.report_floor = Math.min(DIRECTIONAL, r.books_with_text);
  r.graded_books = Math.max(r.judged, 0); // nearest existing proxy of the page grade: a judged, served page
  r.gap_directional = Math.max(0, r.report_floor - r.graded_books);
  r.gap_rate = Math.max(0, Math.min(RATE_10PP, r.books_with_text) - r.graded_books);
  r.ocr_gap_directional = Math.max(0, Math.min(DIRECTIONAL, r.books_with_text) - r.ocr_ref);
}
rows.sort((a, b) => b.ocr_pages - a.ocr_pages);

// ── 4. Risky page types and engine/prompt mix, as seen on the audits' random interior pages ──
const typeCount = {}; const armCount = {}; const promptCount = {};
for (const p of auditPages) {
  typeCount[p.page_type || 'unset'] = (typeCount[p.page_type || 'unset'] || 0) + 1;
  armCount[p.model || 'unset'] = (armCount[p.model || 'unset'] || 0) + 1;
  const pv = `translation ${String(p.prompt_version ?? '?').replace(/^v?/, 'v')}`;
  promptCount[pv] = (promptCount[pv] || 0) + 1;
}

const out = {
  generated_at: new Date().toISOString(),
  issue: 5984,
  frame: 'Atlas books: visible:true, hidden≠true, pages_count>0; strata are CATALOGUE language × period (eval-design §3.2: not yet observed from the page)',
  totals,
  targets: { directional: DIRECTIONAL, rate_10pp: RATE_10PP, monthly_n: MONTHLY_N },
  measured_from: {
    ocr_ref: 'src/data/ocr-benchmark-evidence.json sufficiency (language_period, referenced books)',
    judged: AUDITS.map(a => `scripts/eval/results/${a}/manifest.jsonl (kind main, unique books)`),
    vs_human: 'scripts/eval/results/xlref-synthesis-2026-10/served-pages.jsonl (unique books)',
  },
  measured_unique_books: { judged: judgedBooks.size, vs_human: xlBooks.size, not_found_in_atlas: { judged: judgedMissing, vs_human: xlMissing } },
  page_type_tags_all_pages: Object.fromEntries(pageTypes.filter(t => t.n >= 1000).map(t => [String(t._id), t.n])),
  audit_pages: auditPages.length,
  audit_page_types: typeCount,
  audit_translation_models: armCount,
  audit_translation_prompts: promptCount,
  rows,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify(out, null, 1));

const n0 = v => Math.round(v).toLocaleString('en-US');
const pc = v => `${(v * 100).toFixed(1)}%`;
const md = [
  `# Quality strata inventory, ${today} (#5984)`,
  '',
  `Frame: ${out.frame}. ${n0(totals.books)} live books, ${n0(totals.ocr_pages)} OCR'd pages, ${n0(totals.translated_pages)} translated pages.`,
  `Measured books: OCR against a reference (dashboard sufficiency), translation judged against its source (${judgedBooks.size} books over three #5274 audits), translation against a published translation (${xlBooks.size} books, #5695).`,
  `Neyman n allocates a ${MONTHLY_N}-book monthly sample over OCR'd pages with S = √(p(1−p)), p = the language's judged major-defect share (0.5 where none).`,
  '',
  '| Language | Period | Live books (with text) | OCR\'d pages | Share | OCR ref books | Judged books | vs published | Neyman n of 400 | Gap to 30 (judged) | Gap to 100 | OCR-ref gap to 30 |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map(r => `| ${r.language} | ${r.period} | ${n0(r.books)} (${n0(r.books_with_text)}) | ${n0(r.ocr_pages)} | ${pc(r.share_ocr_pages)} | ${r.ocr_ref} | ${r.judged} | ${r.vs_human} | ${r.neyman_n.toFixed(1)} | ${r.gap_directional} | ${r.gap_rate} | ${r.ocr_gap_directional} |`),
  '',
  `Self-reported page types, all pages carrying the tag (≥ 1,000): ${JSON.stringify(out.page_type_tags_all_pages)}`,
  `Audit page types (${auditPages.length} random interior pages): ${JSON.stringify(typeCount)}`,
  `Audit translation models: ${JSON.stringify(armCount)}`,
  `Audit translation prompt versions: ${JSON.stringify(promptCount)}`,
];
fs.writeFileSync(path.join(OUT, 'inventory.md'), md.join('\n') + '\n');
console.log(md.slice(0, 5).join('\n'));
console.log(`rows: ${rows.length}; wrote ${path.relative(ROOT, OUT)}/inventory.{json,md}`);
