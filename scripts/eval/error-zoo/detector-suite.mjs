#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/lib/plant-ocr-errors.mjs — calibrates a screen on PLANTED errors; this one uses the error
 * zoo's REAL specimens (every serious finding quotes its bad and good span). scripts/eval/error-zoo/zoo-stats.py — the
 * "caught" column scores the predictor, not a deterministic check. scripts/audit/convergent-audit-lib.mjs controls —
 * planted negation/omission for the audit's readers, not for a detector.
 *
 * detector-suite.mjs — suite 1 of the vision note's Part 4 (#8632): measure each free check in
 * scripts/lib/ocr-english-checks.mjs on the specimens of its class and on the clean random pages, BEFORE it is used.
 *
 *   node scripts/eval/error-zoo/detector-suite.mjs /root/jobs/error-zoo-v2/union [--out=FILE.json]
 *
 * Reads labels.jsonl and pages.jsonl (labels.mjs / fetch-pages.mjs output; no Mongo, no model, no spend).
 *   positives  pages with a serious finding of the check's classes, any frame, label not stale (text unchanged since)
 *   negatives  the weekly audit's random served stratum, no serious finding of any class, not stale
 * Thresholds are fixed here, before the run, and not tuned: the suite reports recall, false-flag rate and precision at
 * the random frame's base rate at that threshold, plus the AUC of the raw score, overall and for each half of the books
 * (by id parity) so a reader can see whether a number is stable. For T8 it also reports a span-level upper bound: on
 * the quoted specimen alone (source span vs English span), how often the English has fewer negations.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { langKey, negationDeficit, negationCount, untracedNumbers, englishOverUnclear, sentenceShortfall, noteHedges } from '../../lib/ocr-english-checks.mjs';

const DIR = process.argv[2];
const OUT = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6) || null;
if (!DIR) { console.error('usage: detector-suite.mjs <dir with labels.jsonl and pages.jsonl> [--out=FILE]'); process.exit(2); }

async function* jsonl(f) { for await (const l of readline.createInterface({ input: fs.createReadStream(f) })) if (l.trim()) yield JSON.parse(l); }

const pages = new Map();
for await (const p of jsonl(`${DIR}/pages.jsonl`)) if (p.ocr_text && p.translation) pages.set(p.page_id, p);

const labels = [];
for await (const r of jsonl(`${DIR}/labels.jsonl`)) if (r.page_id && pages.has(r.page_id) && r.stale === false) labels.push(r);

const uniform = (r) => r.source === 'spare_audit' && r.selection === 'random' && r.exposure === 'served';
const serious = (r) => (r.errors || []).filter((e) => e.severity === 'serious');

// language norm for the sentence ratio: median over every page we hold, per language key
const ratios = new Map();
for (const p of pages.values()) {
  const k = langKey(p.book?.language) || p.book?.language || '?';
  const s = sentenceShortfall(p.ocr_text, p.translation);
  if (s.ratio != null) (ratios.get(k) || ratios.set(k, []).get(k)).push(s.ratio);
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const NORM = new Map([...ratios].map(([k, a]) => [k, a.length >= 30 ? median(a) : null]));

const CHECKS = [
  { name: 'negation-deficit', classes: ['T8'], threshold: 2,
    score: (p) => negationDeficit(p.ocr_text, p.translation, langKey(p.book?.language)).score },
  { name: 'untraced-numbers', classes: ['O7'], threshold: 1,
    score: (p) => untracedNumbers(p.ocr_text, p.translation).score },
  { name: 'untraced-numbers-any-O7', classes: ['O7'], threshold: 1,
    score: (p) => { const u = untracedNumbers(p.ocr_text, p.translation); return u.score + u.inNotes; } },
  { name: 'untraced-numbers-in-notes-T10', classes: ['T10'], threshold: 1,
    score: (p) => untracedNumbers(p.ocr_text, p.translation).inNotes },
  { name: 'notes-hedge-or-untraced-number-T10', classes: ['T10'], threshold: 1,
    score: (p) => noteHedges(p.translation).score + untracedNumbers(p.ocr_text, p.translation).inNotes },
  { name: 'english-over-unclear', classes: ['T7'], threshold: 1,
    score: (p) => englishOverUnclear(p.ocr_text, p.translation).score },
  { name: 'sentence-shortfall', classes: ['T9'], threshold: 1 / 0.7,
    score: (p) => {
      const s = sentenceShortfall(p.ocr_text, p.translation), n = NORM.get(langKey(p.book?.language) || p.book?.language || '?');
      return s.ratio == null || !n ? null : n / Math.max(s.ratio, 0.01);
    } },
  { name: 'sentence-shortfall-O5', classes: ['O5'], threshold: 1 / 0.7,
    score: (p) => {
      const s = sentenceShortfall(p.ocr_text, p.translation), n = NORM.get(langKey(p.book?.language) || p.book?.language || '?');
      return s.ratio == null || !n ? null : n / Math.max(s.ratio, 0.01);
    } },
  { name: 'note-hedges', classes: ['T10'], threshold: 1,
    score: (p) => noteHedges(p.translation).score },
];

// one row per page per role (a page can be judged by several labels; positives = any label with the class)
const negPages = new Set(), negBlocked = new Set();
for (const r of labels) { if (serious(r).length) negBlocked.add(r.page_id); else if (uniform(r)) negPages.add(r.page_id); }
for (const id of negBlocked) negPages.delete(id);
const uniformPages = new Set(labels.filter(uniform).map((r) => r.page_id));

function auc(pos, neg) {
  const P = pos.filter((x) => x != null), N = neg.filter((x) => x != null);
  if (!P.length || !N.length) return null;
  let s = 0;
  for (const a of P) for (const b of N) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (P.length * N.length);
}
function wilson(k, n) {
  if (!n) return [null, null];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [+((c - w) / d).toFixed(3), +((c + w) / d).toFixed(3)];
}
const half = (pid) => (parseInt(pages.get(pid).book_id.slice(-2), 16) % 2 ? 'B' : 'A');

const report = { generated_at: new Date().toISOString(), dir: DIR, n_pages: pages.size, n_labels_fresh: labels.length, negatives: negPages.size, checks: [] };
for (const c of CHECKS) {
  const posPages = new Set();
  for (const r of labels) if (serious(r).some((e) => c.classes.includes(e.class))) posPages.add(r.page_id);
  // base rate of the class in the random frame (pages with the class / random pages), for precision
  const uPos = [...posPages].filter((id) => uniformPages.has(id)).length;
  const base = uniformPages.size ? uPos / uniformPages.size : null;
  const row = { check: c.name, classes: c.classes, threshold: +c.threshold.toFixed(3), base_rate_random: base && +base.toFixed(4) };
  for (const part of ['all', 'A', 'B']) {
    const P = [...posPages].filter((id) => part === 'all' || half(id) === part).map((id) => c.score(pages.get(id)));
    const N = [...negPages].filter((id) => part === 'all' || half(id) === part).map((id) => c.score(pages.get(id)));
    const Pd = P.filter((x) => x != null), Nd = N.filter((x) => x != null);
    const kp = Pd.filter((x) => x >= c.threshold).length, kn = Nd.filter((x) => x >= c.threshold).length;
    const rec = Pd.length ? kp / Pd.length : null, fpr = Nd.length ? kn / Nd.length : null;
    const prec = rec != null && fpr != null && base ? (rec * base) / (rec * base + fpr * (1 - base) || 1) : null;
    row[part] = { pos: P.length, pos_scored: Pd.length, neg: N.length, neg_scored: Nd.length,
      recall: rec && +rec.toFixed(3), recall_ci: wilson(kp, Pd.length), false_flag: fpr && +fpr.toFixed(3), false_flag_ci: wilson(kn, Nd.length),
      precision_at_base: prec && +prec.toFixed(3), auc: (() => { const a = auc(Pd, Nd); return a && +a.toFixed(3); })() };
  }
  report.checks.push(row);
}

// T8 span-level upper bound: on the quoted specimen, does the English span carry fewer negations than the source span?
{
  let n = 0, fewer = 0, equal = 0, more = 0, srcNone = 0;
  for (const r of labels) {
    const p = pages.get(r.page_id), lk = langKey(p.book?.language);
    for (const e of serious(r)) {
      if (e.class !== 'T8' || !e.bad || !e.good) continue;
      const s = negationCount(e.good, lk), en = negationCount(e.bad, 'en');
      if (s == null) continue;
      n++;
      if (s === 0 && en === 0) srcNone++;
      else if (en < s) fewer++; else if (en === s) equal++; else more++;
    }
  }
  report.t8_span_bound = { specimens_scored: n, english_fewer: fewer, equal_nonzero: equal, english_more: more, no_negation_either_side: srcNone,
    note: 'a sentence-level negation check could at best catch english_fewer (dropped) and english_more (added); the rest carry no negation signal' };
}

// Span-level: does the quoted bad span itself carry what the check looks for? A page-level hit with no span-level
// signal means the check marks a risky PAGE (a feature), not the error (a guard or a fix).
{
  const HEDGE = /\b(likely|possibly|probably|perhaps|presumably|apparently|seems?|appears?|may (?:be|refer|mean|indicate)|might|could (?:be|refer)|unclear|uncertain|conjectur\w*)\b/i;
  const out = {};
  for (const r of labels) for (const e of serious(r)) {
    if (!['T10', 'O7', 'T7'].includes(e.class) || !e.bad) continue;
    const o = out[e.class] || (out[e.class] = { specimens: 0, bad_in_note: 0, hedge_in_bad: 0, digit_in_bad: 0 });
    o.specimens++;
    if (/<(note|gloss)\b/i.test(e.bad) || /\b(note|gloss)\b/i.test(e.problem || '')) o.bad_in_note++;
    if (HEDGE.test(e.bad)) o.hedge_in_bad++;
    if (/\d/.test(e.bad)) o.digit_in_bad++;
  }
  report.span_level = out;
}

const text = JSON.stringify(report, null, 1);
if (OUT) fs.writeFileSync(OUT, text);
console.log(text);
