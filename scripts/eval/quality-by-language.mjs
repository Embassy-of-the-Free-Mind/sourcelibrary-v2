#!/usr/bin/env node
// One row per catalogue language: how much of the library it is, how accurate its OCR is, how
// faithful its translations are, and what is missing. The grid on /research/quality reads the
// output, so regenerating it after a new benchmark or a monthly audit updates the page.
//
// PRIOR ART: src/data/ocr-benchmark-evidence.json (OCR cells by factor — the `language` cells are
// the OCR columns here, unchanged); translation-corpus-audit/score.mjs (by_language and the
// language weights — the translation columns here); quality-paper-stats.mjs (paper statistics,
// not per language). Neither joins the two by language, which is the point of this file.
//
//   node scripts/eval/quality-by-language.mjs [--audit scripts/eval/results/translation-corpus-audit-YYYY-MM-DD]
//   node scripts/eval/quality-by-language.mjs --attach-three-ways   # only (re)attach ocr.three_ways (#5939)
// Writes src/data/quality-by-language.json (src/data/* is gitignored: commit it with `git add -f`).
// ocr.three_ways comes from the latest results/ocr-cer-three-ways/three-ways-<date>.json
// (ocr-cer-three-ways.mjs): raw CER, CER after the OCR prompt's own conventions, and the error kinds.

import fs from 'node:fs';
import path from 'node:path';
import { wilson } from './lib/agreement-stats.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : [])).filter((x) => x.length));
const RESULTS = path.join(ROOT, 'scripts/eval/results');
const OUT_FILE = path.join(ROOT, 'src/data/quality-by-language.json');

// ── transcription error three ways (#5939) ───────────────────────────────────
// The kinds that held up in the hand-check are shown by name; the rest (misreads, omissions,
// "added" text, capitals, margins) are "other differences": by eye most of those were printed notes
// and margins placed where they are printed, or scoring artefacts (hand-check-<date>.md).
const TW_DIR = path.join(RESULTS, 'ocr-cer-three-ways');
const SHOWN_KINDS = { 'ſ read as f': 'long_s_as_f', refusals: 'refusals', 'silent modernisation': 'modernised', 'reference defects': 'reference_wrong' };
function loadThreeWays() {
  const f = fs.existsSync(TW_DIR) ? fs.readdirSync(TW_DIR).filter((x) => /^three-ways-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().at(-1) : null;
  if (!f) return null;
  const tw = JSON.parse(fs.readFileSync(path.join(TW_DIR, f), 'utf8'));
  const hcFile = path.join(TW_DIR, `hand-check-${tw.date}.json`);
  const hc = fs.existsSync(hcFile) ? JSON.parse(fs.readFileSync(hcFile, 'utf8')) : null;
  const all = hc ? [...hc.batch1, ...hc.batch2] : [];
  return { file: path.relative(ROOT, path.join(TW_DIR, f)), tw,
    hand_check: hc ? { file: path.relative(ROOT, path.join(TW_DIR, `hand-check-${tw.date}.md`)), examples: all.length, reference_wrong: all.filter((x) => x.verdict === 'reference').length, engine_wrong: all.filter((x) => x.verdict === 'engine').length } : null };
}
const r3tw = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
function threeWaysFor(language, loaded, engine = 'gemini-3.1-flash-lite') {
  const g = loaded?.tw.languages?.[language]?.[engine];
  if (!g) return null;
  const kinds = g.kinds ? Object.fromEntries(Object.entries(SHOWN_KINDS).map(([k, key]) => [key, g.kinds[k]?.share ?? 0])) : null;
  if (kinds) kinds.other = r3tw(1 - Object.values(kinds).reduce((a, b) => a + b, 0));
  return { engine, pages: g.pages, books: g.books, strata: g.strata, refused: g.refused, median_cer_raw: g.median_cer_raw, median_cer_prompt: g.median_cer_prompt, kinds };
}
// Per prompt, on the EEBO early-print pages: the long-s A/B arms (v16 vs v16 + long-s line, the refusal
// retry) and the served text by the prompts row it resolves to. Kept for the write-up and later pages.
function byPrompt(loaded) {
  if (!loaded) return null;
  const pick = (g) => ({ pages: g.pages, refused: g.refused, median_cer_raw: g.median_cer_raw, median_cer_prompt: g.median_cer_prompt,
    long_s_as_f: g.kinds?.['ſ read as f']?.share ?? null, modernised: g.kinds?.['silent modernisation']?.share ?? null });
  return {
    arms: loaded.tw.prompts.map((p) => ({ source: p.set === 'bench' ? 'benchmark' : 'long-s A/B', arm: p.arm, engine: p.engine, prompt: p.prompt, long_s_retry: p.long_s_retry, ...pick(p) })),
    served: loaded.tw.served_by_prompt.map((p) => ({ prompt: p.prompt, engines: p.engines, long_s_retry_pages: p.long_s_retry_pages, ...pick(p) })),
    long_s_retry_jobs_corpus_wide: loaded.tw.long_s_retry.jobs_sent_corpus_wide,
  };
}
const THREE_WAYS_NOTE = 'Three ways, on the pages whose references are the same printed edition or scan: raw character error (letters only; case, ſ, accents and u/v all count); the error left after the conventions the OCR prompt itself asks for (abbreviations expanded, standard Unicode, ligatures written out, ſ written as s); and what kinds of error remain, by share of the error. The kinds are a heuristic sorted by a script; read the hand-check before quoting one.';
function attachThreeWays(out) {
  const loaded = loadThreeWays();
  if (!loaded) return out;
  for (const r of out.rows) if (r.ocr) { const t = threeWaysFor(r.language, loaded); if (t) r.ocr.three_ways = t; else delete r.ocr.three_ways; }
  out.sources.ocr_three_ways = loaded.file;
  out.notes.ocr_three_ways = THREE_WAYS_NOTE;
  out.ocr_three_ways = { generated: loaded.tw.date, hand_check: loaded.hand_check, live_prompt: loaded.tw.live_prompt, by_prompt: byPrompt(loaded) };
  return out;
}
if ('attach-three-ways' in args) {
  const out = attachThreeWays(JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')));
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  for (const r of out.rows) if (r.ocr?.three_ways) console.log(`${r.language.padEnd(10)} raw ${r.ocr.three_ways.median_cer_raw} prompt ${r.ocr.three_ways.median_cer_prompt} (${r.ocr.three_ways.pages} pages) ${JSON.stringify(r.ocr.three_ways.kinds)}`);
  process.exit(0);
}

// Every random-sample audit with a report, pooled with each book counted once (its earliest
// verdict). Chained runs sample the processing backlog, not served pages, so they are left out.
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const auditDirs = (args.audit ? [path.resolve(ROOT, args.audit)] : fs.readdirSync(RESULTS)
  .filter((d) => d.startsWith('translation-corpus-audit-') && !d.includes('chained') && fs.existsSync(path.join(RESULTS, d, 'report.json')))
  .map((d) => path.join(RESULTS, d)))
  .map((dir) => ({ dir, report: JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')) }))
  .sort((a, b) => String(a.report.drawn_at).localeCompare(String(b.report.drawn_at)));
const pooled = new Map(); // book_id -> { language, fidelity, major }
for (const { dir, report } of auditDirs) {
  if (report.controls_gate && report.controls_gate.pass === false) continue;
  const judge = report.primary_judge || 'opus';
  const verdicts = {};
  const vdir = path.join(dir, 'verdicts', judge);
  for (const f of fs.existsSync(vdir) ? fs.readdirSync(vdir).filter((x) => x.endsWith('.jsonl')) : []) for (const v of readJsonl(path.join(vdir, f))) verdicts[v.id] = v;
  for (const m of readJsonl(path.join(dir, 'manifest.jsonl'))) {
    const v = verdicts[m.id];
    if (m.kind !== 'main' || !v || typeof v.fidelity !== 'number' || pooled.has(m.book_id)) continue;
    pooled.set(m.book_id, { language: m.language, fidelity: v.fidelity, major: (v.defects || []).some((d) => d.severity === 'major') });
  }
}
const latest = auditDirs.at(-1).report;
const evidence = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ocr-benchmark-evidence.json'), 'utf8'));

// Since 2026-09-11 every new OCR batch runs on Flash-Lite in every language (scripts/lib/ocr-routing.mjs,
// OCR_LITE_ONLY, default on). Flash is shown beside it because it read most non-Latin pages before then.
const LITE = 'gemini-3.1-flash-lite';
const FLASH = 'gemini-3-flash-preview';
const GRADE = (n) => (n >= 50 ? 'decision-grade' : n >= 30 ? 'directional' : 'exploratory');

// What a row's numbers cannot be taken at face value for, and the issue that settles it.
const CAVEATS = {
  Chinese: { text: 'OCR error is measured against other editions (Kanripo, CBETA); variant character forms may account for much of it.', issue: 5574 },
  Greek: { text: 'Many pages catalogued Greek are Latin (#4884); the largest weighted gap in the library.', issue: 5575 },
  French: { text: 'No OCR reference yet.', issue: 5124 },
  Italian: { text: 'No OCR reference yet.', issue: 5573 },
  Dutch: { text: 'No OCR reference yet.', issue: 5573 },
  Spanish: { text: 'No OCR reference yet.', issue: 5573 },
  Arabic: { text: 'Catalogue label: one hand-read “Arabic” page was German.' },
  Korean: { text: 'Catalogue label: one hand-read “Korean” page was Classical Chinese.' },
};

function ocrCell(language, engine) {
  const c = evidence.cells.find((x) => x.factor === 'language' && x.level === language && x.engine === engine);
  const ref = c?.cer_vs_reference;
  if (!c || !ref?.median && ref?.median !== 0) return { engine, books_run: c?.n_run ?? 0, books_referenced: c?.n_referenced ?? 0, median_cer: null, ci: null, grade: 'not run' };
  return { engine, books_run: c.n_run, books_referenced: c.n_referenced, pages_scored: ref.n, median_cer: ref.median, ci: ref.ci95 ?? null, grade: GRADE(c.n_referenced) };
}

// Language weights: the largest audit's (the share of live translated pages at its draw).
const weights = auditDirs.reduce((best, a) => (a.report.n_books > (best?.n_books ?? 0) ? a.report : best), null).corpus_estimate?.weights || {};
const byLanguage = {};
for (const v of pooled.values()) (byLanguage[v.language] ||= []).push(v);
const rows = Object.entries(byLanguage).map(([language, vs]) => {
  const n = vs.length;
  const k = vs.filter((v) => v.fidelity >= 4).length;
  const [lo, hi] = wilson(k, n);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    language,
    share_of_translated_pages: weights[language] ?? null,
    ocr: { current: ocrCell(language, LITE), flash: ocrCell(language, FLASH) },
    translation: { books: n, rated_4_or_5: k, share: r3(k / n), ci: [r3(lo), r3(hi)], any_major_defect: r3(vs.filter((v) => v.major).length / n), grade: GRADE(n) },
    readers: { answers: 0, status: 'not yet run' },
    caveat: CAVEATS[language] ?? null,
  };
}).sort((a, b) => (b.share_of_translated_pages ?? 0) - (a.share_of_translated_pages ?? 0));

const out = {
  generated: new Date().toISOString().slice(0, 10),
  sources: {
    ocr: 'src/data/ocr-benchmark-evidence.json (factor "language")',
    translation: auditDirs.map((a) => path.relative(ROOT, a.dir)),
  },
  notes: {
    share: 'Share of live translated pages per catalogue language at the audit draw (the audit’s post-stratification weights).',
    ocr: `Median character error rate against a published e-text, one page per book. "current" is ${LITE}, which reads every new OCR batch since 2026-09-11; "flash" is ${FLASH}.`,
    translation: 'Share of one-page-per-book samples, pooled across monthly audits with each book counted once, the source-grounded judge (Claude Opus) rated 4 or 5 of 5, with a 95% Wilson interval. A model judgement, not accuracy.',
    grade: 'Books behind the cell: under 30 exploratory, 30–49 directional, 50 or more decision-grade.',
  },
  translation_books: pooled.size,
  rows,
};
attachThreeWays(out);
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
console.log(`${rows.length} languages, ${pooled.size} books pooled from ${auditDirs.length} audits`);
for (const r of rows) console.log(`${r.language.padEnd(10)} ${String(r.share_of_translated_pages).padStart(5)}%  ocr lite ${r.ocr.current.median_cer ?? '—'} (${r.ocr.current.books_referenced})  flash ${r.ocr.flash.median_cer ?? '—'}  judge ${r.translation.rated_4_or_5}/${r.translation.books}`);
