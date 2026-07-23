#!/usr/bin/env node
/**
 * Calibration scorecard — the reader-first deliverable (#3235, paper doc
 * `.claude/docs/ocr-memorization-paper.md` "Calibration scorecard" entry).
 *
 * Question answered: *how accurate is the text Source Library serves?*
 *
 * Two-step design:
 *   1. ANCHOR CALIBRATION — on the pinned reference pages, build cross-model
 *      OCR output pairs, compute inter-output AGREEMENT (the exact corpus
 *      metric: word-level Levenshtein similarity, char-level on space-less
 *      scripts), and pair it with TRUE accuracy against the published
 *      transcription. Fit agreement→accuracy on NON-CANONICAL pairs only:
 *      recitation fakes agreement on canonical text (two models reciting the
 *      same memorized passage agree while both misreport the page), so
 *      canonical rows would corrupt the curve. The canon/noncanon r split is
 *      itself reported — it is the consensus-failure evidence.
 *   2. CORPUS APPLICATION — push the 100K+ same-page double-OCR pairs from
 *      `revision-agreement-corpus-*.jsonl` through the fitted curve to produce
 *      a calibrated per-page accuracy ESTIMATE, aggregated into a per-language
 *      × per-century scorecard. Only `is_live` pairs (the transition whose
 *      current side is the text readers actually see) enter the scorecard.
 *
 * Honesty rails, stated up front:
 *   - The curve transfers from cross-model anchor pairs to mostly
 *     within-Gemini-family corpus pairs. Family self-agreement is optimistic
 *     (shared failure modes agree), so estimates lean HIGH. Reported as such.
 *   - Anchor accuracy is passage-scoped free-skip charAccuracy — an UPPER
 *     bound (see metrics.mjs). The windowed fit is computed alongside as
 *     sensitivity.
 *   - Cells whose script has no anchor coverage are labeled: `anchored`
 *     (same script family in the anchor set), `extrapolated` (spaced script,
 *     nearest-family fit), `unsupported` (no defensible fit — Tibetan: the
 *     estimate is suppressed and the cell flagged, which is itself the
 *     finding).
 *   - Pairs where either side is degenerate/meta/refusal (`direction` ≠
 *     both-transcription) don't go through the curve — a broken live side is
 *     reported as `pct_flagged`, not laundered into an accuracy number.
 *
 * Cost: zero. Local files only — no Mongo, no model calls.
 *
 *   node scripts/eval/calibration-scorecard.mjs \
 *     [--corpus=scripts/eval/results/revision-agreement-corpus-2026-07-20.jsonl] \
 *     [--all-pairs] [--min-cell=50]
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { scoreAgainstReference, stripWrappers, levenshtein } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const DATE = new Date().toISOString().slice(0, 10);
const RESULTS = path.join(__dirname, 'results');
const CORPUS = args.corpus || path.join(RESULTS, 'revision-agreement-corpus-2026-07-20.jsonl');
const MIN_CELL = parseInt(args['min-cell'] || '50');
const OUT_JSON = path.join(RESULTS, `calibration-scorecard-${DATE}.json`);
const OUT_MD = path.join(RESULTS, `calibration-scorecard-${DATE}.md`);

// ── agreement metric: EXACT parity with revision-agreement-corpus.mjs ─────
const deEntity = s => (s || '').replace(/&[a-z]{2,8};/gi, ' ').replace(/&#\d+;/g, ' ');
const toWords = s => deEntity(stripWrappers(s || ''))
  .toLowerCase().replace(/[^\p{L}\s]/gu, ' ')
  .split(/\s+/).filter(w => w.length > 1).slice(0, 800);
function agreement(a, b) {
  const A = toWords(a), B = toWords(b);
  if (!A.length && !B.length) return null;
  if (!A.length || !B.length) return 0;
  return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
}
const toChars = s => [...deEntity(stripWrappers(s || '')).toLowerCase().replace(/[^\p{L}]/gu, '')].slice(0, 3000);
function agreementChar(a, b) {
  const A = toChars(a), B = toChars(b);
  if (!A.length && !B.length) return null;
  if (!A.length || !B.length) return 0;
  return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
}

// ── Phase 1: anchors ──────────────────────────────────────────────────────
const SPACELESS_SCRIPTS = new Set(['cjk', 'chinese', 'tibetan']);
const gtDir = path.join(__dirname, 'ground-truth');
const gts = fs.readdirSync(gtDir).filter(f => f.endsWith('.json'))
  .map(f => ({ slug: f.replace('.json', ''), ...JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8')) }))
  .filter(g => g.ocr_ground_truth);
const byWork = new Map(gts.map(g => [g.work, g]));

// book year per anchor page, from the released dataset (offline)
const anchorYear = new Map();
const pagesPath = path.join(__dirname, 'dataset', 'v0.3', 'pages.jsonl');
if (fs.existsSync(pagesPath)) {
  for (const line of fs.readFileSync(pagesPath, 'utf8').split('\n').filter(Boolean)) {
    const p = JSON.parse(line);
    if (p.book?.year) anchorYear.set(p.slug, p.book.year);
  }
}

// Raw outputs: native, full-page, production-comparable runs only. `@`-suffixed
// entries are experiment arms (downscale @wN, prompt @annotated, hosting @l40s)
// — excluded so the calibration population matches the corpus population
// (full-resolution page reads). Result 7 in the paper doc bounds the prompt-arm
// difference at ~1pp unconditional.
const outputsByWork = new Map(); // work -> Map(model -> text)
for (const f of fs.readdirSync(RESULTS).filter(f => f.startsWith('scorecard-outputs-') && f.endsWith('.jsonl'))) {
  for (const line of fs.readFileSync(path.join(RESULTS, f), 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(line);
    if (!byWork.has(o.work) || !o.text || (o.model || '').includes('@')) continue;
    if (!outputsByWork.has(o.work)) outputsByWork.set(o.work, new Map());
    const m = outputsByWork.get(o.work);
    if (!m.has(o.model)) m.set(o.model, o.text); // first run per model
  }
}

const scriptClassOf = script => SPACELESS_SCRIPTS.has(script) ? 'spaceless' : 'spaced';
const accCache = new Map();
const accuracyOf = (gt, model, text) => {
  const k = `${gt.slug}|${model}`;
  if (!accCache.has(k)) {
    const script = SPACELESS_SCRIPTS.has(gt.script) ? 'cjk' : (gt.script || 'latin');
    const r = scoreAgainstReference(gt.ocr_ground_truth, text, script);
    accCache.set(k, { free: r.charAccuracy, windowed: r.charAccuracyWindowed, aligned: r.aligned });
  }
  return accCache.get(k);
};

const anchorPairs = [];
for (const [work, models] of outputsByWork) {
  const gt = byWork.get(work);
  const canonical = gt.page_class?.canonical_text !== false;
  const cls = scriptClassOf(gt.script);
  const entries = [...models.entries()];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [ma, ta] = entries[i], [mb, tb] = entries[j];
      const agr = (cls === 'spaceless' ? agreementChar : agreement)(ta, tb);
      if (agr == null) continue;
      const A = accuracyOf(gt, ma, ta), B = accuracyOf(gt, mb, tb);
      anchorPairs.push({
        slug: gt.slug, script: gt.script, script_class: cls, canonical,
        year: anchorYear.get(gt.slug) ?? null,
        models: [ma, mb],
        agreement: +agr.toFixed(4),
        acc_free: +((A.free + B.free) / 2).toFixed(4),
        acc_windowed: A.windowed != null && B.windowed != null ? +((A.windowed + B.windowed) / 2).toFixed(4) : null,
      });
    }
  }
}

const pearson = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
};

// Isotonic regression (pool adjacent violators) → monotone agreement→accuracy
// map. Nonparametric, can't extrapolate past the data (clamps to end values),
// and monotonicity is the one shape assumption the problem justifies.
function isotonicFit(pairs) {
  const pts = [...pairs].sort((a, b) => a.x - b.x);
  const blocks = pts.map(p => ({ sum: p.y, n: 1, x: p.x }));
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].sum / blocks[i].n > blocks[i + 1].sum / blocks[i + 1].n) {
      blocks[i] = { sum: blocks[i].sum + blocks[i + 1].sum, n: blocks[i].n + blocks[i + 1].n, x: blocks[i + 1].x };
      blocks.splice(i + 1, 1);
      if (i > 0) i--;
    } else i++;
  }
  // knots: (max x of block, block mean)
  const knots = blocks.map(b => ({ x: b.x, y: b.sum / b.n }));
  return x => {
    if (!knots.length) return NaN;
    if (x <= knots[0].x) return knots[0].y;
    for (let k = 1; k < knots.length; k++) {
      if (x <= knots[k].x) {
        const a = knots[k - 1], b = knots[k];
        return b.x === a.x ? b.y : a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
      }
    }
    return knots[knots.length - 1].y;
  };
}
const ols = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxy / sxx;
  return { slope: +b.toFixed(4), intercept: +(my - b * mx).toFixed(4) };
};

// r split — the consensus-failure headline
const corr = {};
for (const which of ['noncanon', 'canon']) {
  for (const cls of ['spaced', 'spaceless', 'all']) {
    const sel = anchorPairs.filter(p =>
      (which === 'canon') === p.canonical && (cls === 'all' || p.script_class === cls));
    corr[`${which}_${cls}`] = {
      n: sel.length,
      r_free: +pearson(sel.map(p => p.agreement), sel.map(p => p.acc_free)).toFixed(3),
      r_windowed: +pearson(
        sel.filter(p => p.acc_windowed != null).map(p => p.agreement),
        sel.filter(p => p.acc_windowed != null).map(p => p.acc_windowed)).toFixed(3),
    };
  }
}

// fits: noncanon only, per script class
const fits = {}, fitMeta = {};
for (const cls of ['spaced', 'spaceless']) {
  const sel = anchorPairs.filter(p => !p.canonical && p.script_class === cls);
  fits[cls] = isotonicFit(sel.map(p => ({ x: p.agreement, y: p.acc_free })));
  fitMeta[cls] = {
    n: sel.length,
    agreement_range: [Math.min(...sel.map(p => p.agreement)), Math.max(...sel.map(p => p.agreement))].map(x => +x.toFixed(3)),
    ols: ols(sel.map(p => p.agreement), sel.map(p => p.acc_free)),
    ols_windowed: ols(
      sel.filter(p => p.acc_windowed != null).map(p => p.agreement),
      sel.filter(p => p.acc_windowed != null).map(p => p.acc_windowed)),
    scripts: [...new Set(sel.map(p => p.script))].sort(),
  };
}

// binned curve for the report
const binCurve = (pairs, edges) => edges.slice(0, -1).map((lo, i) => {
  const hi = edges[i + 1];
  const sel = pairs.filter(p => p.agreement >= lo && p.agreement < hi);
  return {
    bin: `[${lo}–${hi})`, n: sel.length,
    mean_acc_free: sel.length ? +(sel.reduce((s, p) => s + p.acc_free, 0) / sel.length).toFixed(4) : null,
  };
});
const EDGES = [0, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1.001];

// ── Phase 2: corpus application ───────────────────────────────────────────
// Script support per language: which fit applies and how far it stretches.
//   anchored     — same script family present among the (non-canonical) anchors
//   extrapolated — alphabetic script, nearest-family fit borrowed
//   unsupported  — no defensible fit: space-less scripts (the anchor set holds
//                  ZERO non-canonical spaceless rows — every Chinese anchor is
//                  a canonical classic, and recitation fakes agreement there),
//                  plus non-alphabetic / far-from-anchor scripts.
const ANCHORED = new Set(['latin', 'greek', 'german', 'hebrew', 'armenian']);
const UNSUPPORTED = new Set([
  'tibetan', 'chinese', 'japanese', 'korean', 'burmese', 'thai', 'khmer', 'lao',
  'javanese', 'old javanese', "ge'ez", 'geez', 'egyptian hieroglyphs', 'maya hieroglyphs',
]);
const supportOf = (language, scriptClass) => {
  const l = (language || '').toLowerCase().trim();
  if (UNSUPPORTED.has(l) || scriptClass === 'spaceless') return 'unsupported';
  return ANCHORED.has(l) ? 'anchored' : 'extrapolated';
};

class Cell {
  constructor() { this.n = 0; this.scored = 0; this.sumAgr = 0; this.sumEst = 0; this.nEst = 0; this.low = 0; this.flagged = 0; this.fine = new Int32Array(1000); }
  quantileAgr(q) {
    let cum = 0; const t = q * this.scored;   // flagged pairs carry no agreement
    for (let i = 0; i < 1000; i++) { cum += this.fine[i]; if (cum >= t) return (i + 0.5) / 1000; }
    return 1;
  }
}
const cells = new Map(); // `${lang}|${yearBucket}` -> Cell
const langTotals = new Map(); // lang -> Cell (all centuries)
const bump = (map, key, agr, est, flaggedBroken) => {
  if (!map.has(key)) map.set(key, new Cell());
  const c = map.get(key);
  c.n++;
  if (flaggedBroken) { c.flagged++; return; }
  c.scored++;
  c.sumAgr += agr;
  c.fine[Math.max(0, Math.min(999, Math.floor(agr * 1000)))]++;
  if (agr < 0.5) c.low++;
  if (est != null) { c.sumEst += est; c.nEst++; }
};

let corpusRows = 0, liveEligible = 0, skippedNotLive = 0, skippedIneligible = 0;
const rl = readline.createInterface({ input: fs.createReadStream(CORPUS), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  corpusRows++;
  const r = JSON.parse(line);
  if (r.eligibility !== 'eligible') { skippedIneligible++; continue; }
  if (!r.is_live && !args['all-pairs']) { skippedNotLive++; continue; }
  liveEligible++;
  const lang = (r.language || 'unknown').trim().toLowerCase() || 'unknown';
  const cls = r.script_class === 'spaceless' ? 'spaceless' : 'spaced';
  const support = supportOf(lang, cls);
  const broken = r.direction !== 'both-transcription';
  const agr = r.agreement_primary;
  // Estimate only where the fit is defensible: spaced script, supported
  // language, both sides real transcription attempts. fits.spaceless has no
  // data (zero non-canonical spaceless anchors) — spaceless rows never get one.
  let est = (!broken && support !== 'unsupported' && cls === 'spaced') ? fits.spaced(agr) : null;
  if (est != null && !Number.isFinite(est)) est = null;
  bump(cells, `${lang}|${r.year_bucket || 'unknown'}`, agr, est, broken);
  bump(langTotals, lang, agr, est, broken);
}

// ── assemble scorecard ────────────────────────────────────────────────────
const YEAR_ORDER = ['pre-1500', '1500-1599', '1600-1699', '1700-1799', '1800-1899', '1900+', 'unknown'];
const cellRow = (lang, bucket, c) => {
  const support = supportOf(lang, 'spaced');
  const scored = c.n - c.flagged;
  const pctLow = scored ? +(c.low / scored).toFixed(4) : null;
  return {
    language: lang, year_bucket: bucket,
    n_pairs: c.n,
    support,
    median_agreement: scored ? +c.quantileAgr(0.5).toFixed(4) : null,
    mean_agreement: scored ? +(c.sumAgr / scored).toFixed(4) : null,
    est_accuracy: c.nEst ? +(c.sumEst / c.nEst).toFixed(4) : null,
    // A cell whose agreement distribution sits far below the anchor curve's
    // dense support is estimating from the curve's soft floor — mark unstable.
    est_unstable: pctLow != null && pctLow > 0.25,
    pct_low_agreement: pctLow,
    pct_flagged_broken: +(c.flagged / c.n).toFixed(4),
  };
};
const scorecard = [];
for (const [key, c] of cells) {
  const [lang, bucket] = key.split('|');
  if (c.n < MIN_CELL) continue;
  scorecard.push(cellRow(lang, bucket, c));
}
scorecard.sort((a, b) => a.language.localeCompare(b.language) || YEAR_ORDER.indexOf(a.year_bucket) - YEAR_ORDER.indexOf(b.year_bucket));
const langCard = [...langTotals.entries()].filter(([, c]) => c.n >= MIN_CELL)
  .map(([lang, c]) => cellRow(lang, 'all', c))
  .sort((a, b) => (b.est_accuracy ?? -1) - (a.est_accuracy ?? -1));

const out = {
  date: new Date().toISOString(),
  corpus_file: path.basename(CORPUS),
  scope: args['all-pairs'] ? 'all eligible pairs' : 'is_live eligible pairs (text readers see)',
  anchor_calibration: {
    works: outputsByWork.size,
    pairs: anchorPairs.length,
    noncanon_pairs: anchorPairs.filter(p => !p.canonical).length,
    correlations: corr,
    fits: fitMeta,
    binned_noncanon_spaced: binCurve(anchorPairs.filter(p => !p.canonical && p.script_class === 'spaced'), EDGES),
    binned_noncanon_spaceless: binCurve(anchorPairs.filter(p => !p.canonical && p.script_class === 'spaceless'), EDGES),
    binned_canon_all: binCurve(anchorPairs.filter(p => p.canonical), EDGES),
  },
  corpus: { rows: corpusRows, live_eligible: liveEligible, skipped_not_live: skippedNotLive, skipped_ineligible: skippedIneligible },
  by_language: langCard,
  by_language_century: scorecard,
  anchors_detail: anchorPairs,
};
fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 1));

// ── report ────────────────────────────────────────────────────────────────
const pct = x => x == null ? '—' : `${(x * 100).toFixed(1)}%`;
const supMark = s => s === 'anchored' ? '' : s === 'extrapolated' ? ' †' : ' ⚠';
const estCol = r => r.support === 'unsupported' ? '⚠ no fit'
  : r.est_accuracy == null ? '—'
  : r.est_unstable ? `(${pct(r.est_accuracy)})*` : pct(r.est_accuracy);
const md = [
  `# Calibration scorecard — how accurate is the text we serve? (${DATE})`, '',
  `Agreement→accuracy calibration fitted on the pinned anchor pages (non-canonical`,
  `rows only), applied to the same-page double-OCR corpus`,
  `(\`${path.basename(CORPUS)}\`). Estimates are calibrated inferences, not`,
  `measurements — see caveats at the end. Free to rebuild:`,
  `\`node scripts/eval/calibration-scorecard.mjs\`.`, '',
  `## 1. The calibration (anchors: ${outputsByWork.size} pages, ${anchorPairs.length} cross-model pairs)`, '',
  `| stratum | n pairs | r (agreement, accuracy) | r windowed |`,
  `|---|---:|---:|---:|`,
  ...['noncanon_spaced', 'noncanon_spaceless', 'noncanon_all', 'canon_spaced', 'canon_spaceless', 'canon_all']
    .map(k => `| ${k.replace('_', ' · ')} | ${corr[k].n} | ${isNaN(corr[k].r_free) ? '—' : corr[k].r_free} | ${isNaN(corr[k].r_windowed) ? '—' : corr[k].r_windowed} |`),
  '',
  `The canon/noncanon r split is the consensus-failure result: on canonical text,`,
  `models reciting the same memorized passage agree while both misreport the page,`,
  `so agreement stops predicting accuracy. Only non-canonical pairs calibrate.`, '',
  `Fit (isotonic, noncanon only): spaced n=${fitMeta.spaced.n} over agreement`,
  `[${fitMeta.spaced.agreement_range}], scripts: ${fitMeta.spaced.scripts.join(', ')}.`,
  `OLS sensitivity: acc ≈ ${fitMeta.spaced.ols.intercept} + ${fitMeta.spaced.ols.slope}·agr`,
  `(windowed: ${fitMeta.spaced.ols_windowed.intercept} + ${fitMeta.spaced.ols_windowed.slope}·agr).`, '',
  `**No spaceless fit exists**: the anchor set holds ZERO non-canonical`,
  `space-less-script rows — every Chinese anchor is a canonical classic, exactly`,
  `the rows the consensus-failure result disqualifies. Until non-canonical CJK`,
  `anchors land (ctext plumbing, see paper doc), Chinese/Japanese/Tibetan cells`,
  `report agreement only. This gap is a finding, not an omission.`, '',
  `### Binned curve (noncanon, spaced)`, '',
  `| agreement bin | n | mean true accuracy |`, `|---|---:|---:|`,
  ...binCurve(anchorPairs.filter(p => !p.canonical && p.script_class === 'spaced'), EDGES)
    .filter(b => b.n).map(b => `| ${b.bin} | ${b.n} | ${pct(b.mean_acc_free)} |`),
  '',
  `## 2. The scorecard (corpus: ${liveEligible.toLocaleString()} live eligible pairs)`, '',
  `Scope: pairs whose current side is the live \`pages.ocr\` — the text readers see.`,
  `\`est. accuracy\` = mean of the calibrated per-pair estimates. † = extrapolated`,
  `(no same-script anchors; nearest-family fit). ⚠ = unsupported (no defensible`,
  `fit — agreement shown, accuracy estimate suppressed). \`(x%)*\` = unstable: >25%`,
  `of the cell's pairs sit below agreement 0.5, where the anchor curve has only`,
  `its soft floor — read those cells as "flagged for audit", not as a rating.`,
  `\`% flagged\` = pairs where a side is degenerate/refusal/commentary (direction ≠`,
  `both-transcription). Language is book metadata (edition language) and can be`,
  `wrong on individual books.`, '',
  `### By language`, '',
  `| language | n pairs | median agr | est. accuracy | % agr<0.5 | % flagged |`,
  `|---|---:|---:|---:|---:|---:|`,
  ...langCard.map(r => `| ${r.language}${supMark(r.support)} | ${r.n_pairs.toLocaleString()} | ${pct(r.median_agreement)} | ${estCol(r)} | ${pct(r.pct_low_agreement)} | ${pct(r.pct_flagged_broken)} |`),
  '',
  `### By language × century (cells with ≥${MIN_CELL} pairs)`, '',
  `| language | century | n pairs | median agr | est. accuracy | % agr<0.5 | % flagged |`,
  `|---|---|---:|---:|---:|---:|---:|`,
  ...scorecard.map(r => `| ${r.language}${supMark(r.support)} | ${r.year_bucket} | ${r.n_pairs.toLocaleString()} | ${pct(r.median_agreement)} | ${estCol(r)} | ${pct(r.pct_low_agreement)} | ${pct(r.pct_flagged_broken)} |`),
  '',
  `## Caveats (do not quote a cell without them)`, '',
  `1. **Estimates lean high.** The curve is fitted on cross-model pairs; corpus`,
  `   pairs are mostly within-Gemini-family, and family self-agreement is`,
  `   optimistic (shared failure modes agree). Anchor accuracy is also the`,
  `   free-skip UPPER bound (passage-scoped; hallucinated additions outside the`,
  `   reference span are uncharged).`,
  `2. **The fit is script-class-stratified, not era-stratified** — anchor eras are`,
  `   too thin. Century rows share one curve per script class; era enters only`,
  `   through the agreement distribution.`,
  `3. **† rows borrow the fit** from the nearest anchored script family;`,
  `   ⚠ rows have no defensible fit at all. Space-less scripts are ⚠ across the`,
  `   board (zero non-canonical spaceless anchors); Tibetan is additionally a`,
  `   known OCR failure class (lesson_tibetan_lite_ocr_fails) — there the flag`,
  `   IS the scorecard entry.`,
  `4. **The curve's low end is soft.** Anchor pairs at agreement <0.3 still`,
  `   average ~78% free-skip accuracy (models disagree about NON-reference page`,
  `   material while both containing the passage). Corpus pairs at low agreement`,
  `   may instead be genuinely broken text — a failure shape the anchors never`,
  `   exhibit. Hence the \`*\` unstable marker.`,
  `5. **Agreement is not independence.** Both sides of a corpus pair come from`,
  `   the same model lineage on the same image; a systematic misread that both`,
  `   passes share is invisible. IA-OCR baseline (planned) adds the independent`,
  `   second reading.`,
  `6. Cells with <${MIN_CELL} pairs are suppressed.`, '',
].join('\n');
fs.writeFileSync(OUT_MD, md);

console.log(md.split('### By language × century')[0]);
console.log(`Saved → ${OUT_JSON}\n        ${OUT_MD}`);
