#!/usr/bin/env node
/**
 * Score the cheap OCR garble detector (#5313) against the translation-corpus audit's judged pages.
 *
 * PRIOR ART: scripts/eval/translation-corpus-audit/score.mjs — scores the JUDGE's verdicts into
 * corpus rates; this scores a DETECTOR against those verdicts (the judge is the reference).
 * scripts/lib/ocr-garble-score.mjs + ocr-garble-verdict.mjs hold the detector; this file only
 * measures it.
 *
 * Reference: a `main` page is GARBLED when the primary (Opus) judge set `garble_passthrough`.
 * The judge read the OCR beside the translation, never the image, so this is `measure: judged`
 * — agreement with a judge, not accuracy. Controls (swap/drop/repeat) are excluded: they are
 * translation manipulations with clean sources.
 *
 * Usage:
 *   node scripts/eval/garble-detector-5313.mjs \
 *     --audit=scripts/eval/results/translation-corpus-audit-2026-09-30 \
 *     --audit=<dir of the monthly run> [--dump=FILE]
 *
 * Needs the lexicon (scripts/audit/ocr-garble-lexicon.mjs) and the corpus baselines
 * (scripts/audit/ocr-garble-corpus.mjs), both on this machine under ~/sl-corpus.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { garbleFeatures, loadLexiconDir, ocrSelfCaution } from '../lib/ocr-garble-score.mjs';
import { garbleVerdict, baselineFor, VERDICT_VERSION, THRESHOLDS } from '../lib/ocr-garble-verdict.mjs';

const args = process.argv.slice(2);
const many = (n) => args.filter(a => a.startsWith(`--${n}=`)).map(a => a.slice(n.length + 3));
const one = (n, d) => many(n)[0] ?? d;

const MIRROR = one('mirror', path.join(os.homedir(), 'sl-corpus'));
const LEXICON = one('lexicon', path.join(MIRROR, 'garble-lexicon'));
const BASELINES = one('baselines', path.join(MIRROR, 'garble-scores', 'baselines.json'));
const AUDITS = many('audit');
const DUMP = one('dump', '');

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

function loadAudit(dir) {
  const manifest = new Map(readJsonl(path.join(dir, 'manifest.jsonl')).map(m => [m.id, m]));
  const sources = new Map();
  const itemFiles = fs.existsSync(path.join(dir, 'items.jsonl'))
    ? [path.join(dir, 'items.jsonl')]
    : fs.readdirSync(path.join(dir, 'packets')).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, 'packets', f));
  for (const f of itemFiles) for (const it of readJsonl(f)) sources.set(it.id, it.source);
  const vdir = path.join(dir, 'verdicts', 'opus');
  const out = [];
  for (const f of fs.readdirSync(vdir).filter(f => f.endsWith('.jsonl'))) {
    for (const v of readJsonl(path.join(vdir, f))) {
      const m = manifest.get(v.id);
      if (!m || m.kind !== 'main' || !sources.has(v.id)) continue;
      const major = (v.defects || []).some(d => d.type === 'garble_passthrough' && d.severity === 'major');
      out.push({ id: v.id, run: path.basename(dir), book: m.book_id, p: m.page_number, language: m.language, url: m.url, ocr: sources.get(v.id), garbled: !!v.flags?.garble_passthrough, major, fidelity: v.fidelity });
    }
  }
  return out;
}

const lexicon = await loadLexiconDir(LEXICON);
const baselines = JSON.parse(fs.readFileSync(BASELINES, 'utf8'));
const pages = AUDITS.flatMap(loadAudit);
const seenBooks = new Set();
const rows = [];
for (const pg of pages) {
  // Two runs can draw the same book; a book is one observation.
  if (seenBooks.has(pg.book)) continue;
  seenBooks.add(pg.book);
  const f = garbleFeatures(pg.ocr, { lexicon, language: pg.language });
  const r = { ...f, language: pg.language, caution: ocrSelfCaution(pg.ocr) };
  const v = f.judged ? garbleVerdict(r, baselineFor(baselines, r)) : { garbled: false, reasons: [], score: null };
  rows.push({ ...pg, ocr: undefined, f, caution: r.caution, flagged: v.garbled, reasons: v.reasons, score: v.score });
}

const pr = (sel, label) => {
  const judged = sel.filter(r => r.f.judged);
  const tp = judged.filter(r => r.flagged && r.garbled).length;
  const fp = judged.filter(r => r.flagged && !r.garbled).length;
  const fn = judged.filter(r => !r.flagged && r.garbled).length;
  const unjudgedPos = sel.filter(r => !r.f.judged && r.garbled).length;
  return { label, n: sel.length, judged: judged.length, positives: sel.filter(r => r.garbled).length, tp, fp, fn, unjudged_positives: unjudgedPos,
    precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null,
    recall_of_judged: tp + fn ? +(tp / (tp + fn)).toFixed(3) : null,
    recall_of_all: tp + fn + unjudgedPos ? +(tp / (tp + fn + unjudgedPos)).toFixed(3) : null };
};
const cautionPr = (() => {
  const tp = rows.filter(r => r.caution && r.garbled).length, fp = rows.filter(r => r.caution && !r.garbled).length;
  const pos = rows.filter(r => r.garbled).length;
  return { label: 'pageReadCaution alone (#5315)', flagged: tp + fp, tp, fp, recall: pos ? +(tp / pos).toFixed(3) : null };
})();
const union = (() => {
  const hit = (r) => r.caution || r.flagged;
  const tp = rows.filter(r => hit(r) && r.garbled).length, fp = rows.filter(r => hit(r) && !r.garbled).length;
  const pos = rows.filter(r => r.garbled).length;
  return { label: 'caution OR detector', flagged: tp + fp, tp, fp, precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null, recall: pos ? +(tp / pos).toFixed(3) : null };
})();

const report = {
  verdict_version: VERDICT_VERSION, thresholds: THRESHOLDS, measure: 'judged', reference: 'Opus judge flag garble_passthrough, main pages only, one page per book',
  runs: AUDITS.map(a => path.basename(a)),
  all: pr(rows, 'all'),
  major_only: pr(rows.map(r => ({ ...r, garbled: r.major })), 'major garble only'),
  caution: cautionPr, union,
  unjudged_reasons: rows.filter(r => !r.f.judged).reduce((a, r) => ((a[r.f.why] = (a[r.f.why] || 0) + 1), a), {}),
  flagged: rows.filter(r => r.flagged).map(r => ({ id: r.id, language: r.language, garbled: r.garbled, reasons: r.reasons, url: r.url })),
  missed: rows.filter(r => !r.flagged && r.garbled).map(r => ({ id: r.id, language: r.language, judged: r.f.judged, why: r.f.why, oov: r.f.oov, url: r.url })),
};
console.log(JSON.stringify(report, null, 1));
if (DUMP) fs.writeFileSync(DUMP, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
