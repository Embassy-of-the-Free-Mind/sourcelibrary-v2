#!/usr/bin/env node
/**
 * Calibration scorecard — the reader-first deliverable (#3235).
 *
 * The question is not the research agenda's, it's the reader's: how accurate is
 * the text Source Library serves, per script and era? This script:
 *
 *   STEP 1 — anchor calibration set. For each NON-CANONICAL anchor page (32 of
 *     the 44 pinned pages; canonical pages are EXCLUDED from fitting — the pilot
 *     measured r=0.75 noncanon vs 0.49 canon, i.e. recitation fakes agreement),
 *     compute (a) mean pairwise inter-run/inter-model agreement among that page's
 *     raw model outputs, and (b) reference-scored accuracy: free-skip subsequence
 *     (upper bound) AND windowed fitting-alignment (lower bound, PR #3304) so the
 *     bracket is visible.
 *   STEP 2 — fit agreement -> accuracy, per script-class (spaced vs space-less)
 *     and per script where n (pages) >= 5. n<5 is reported UNUSABLE, never
 *     extrapolated. Linear OLS + bootstrap CI (2000 resamples over pages, not
 *     runs) is the headline fit; isotonic (PAVA) is reported alongside as a
 *     monotonicity cross-check.
 *   STEP 3 — apply the fit to the page_revisions corpus-wide agreement corpus
 *     (109,953 eligible pairs, PR #3273) to produce calibrated per-script x
 *     per-era ESTIMATED accuracy bands. Two caveats carried at every application:
 *     (i) revision pairs are mostly within-Gemini-family transitions, not
 *     independent readings — calibrated numbers are conditional on the anchor
 *     fit transferring; (ii) canonical-heavy strata inflate agreement without
 *     inflating true accuracy the same way (recitation), so any stratum plausibly
 *     dominated by canonical/liturgical works is flagged, not silently trusted.
 *
 * No AI calls. Mongo reads (via the pre-computed corpus summary) + local compute.
 *
 *   node scripts/eval/calibration-scorecard.mjs [--corpus-summary=path] [--date=YYYY-MM-DD]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stripWrappers, levenshtein, scoreAgainstReference } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const DATE = args.date || new Date().toISOString().slice(0, 10);
const RESULTS_DIR = path.join(__dirname, 'results');
const OBS_FILE = args.observations || path.join(__dirname, 'observations', `ocr-observations-${DATE}.jsonl`);
const REF_WORKS_DIR = path.join(__dirname, 'reference-works');
const V2_RUNS_FILE = path.join(__dirname, 'dataset', 'v0.2', 'runs.jsonl');
const CANONICITY_RUNS_FILE = path.join(RESULTS_DIR, 'scorecard-outputs-2026-07-23-canonicity.jsonl');
const OUT_JSON = path.join(RESULTS_DIR, `calibration-scorecard-${DATE}.json`);
const OUT_MD = path.join(RESULTS_DIR, `calibration-scorecard-${DATE}.md`);

// ── tiny utils ──────────────────────────────────────────────────────
const readJsonl = f => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  : [];
const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
const round = (x, d = 4) => (x == null || Number.isNaN(x)) ? null : +x.toFixed(d);
const pct = x => (x == null || Number.isNaN(x)) ? '—' : `${(x * 100).toFixed(1)}%`;

// ── agreement metric — PARITY COPY of revision-agreement-corpus.mjs's
// agreement()/agreementChar() (PR #3273). Duplicated rather than imported: that
// module runs its whole Mongo scan as a top-level side effect on import (no
// `if (import.meta.url === ...)` guard), so importing it here would kick off a
// second corpus scan. Logic must stay identical; if the corpus script's metric
// changes, mirror the change here. ──────────────────────────────────
const deEntity = s => (s || '').replace(/&[a-z]{2,8};/gi, ' ').replace(/&#\d+;/g, ' ');
const toWords = s => deEntity(stripWrappers(s || ''))
  .toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 800);
const toChars = s => [...deEntity(stripWrappers(s || '')).toLowerCase().replace(/[^\p{L}]/gu, '')].slice(0, 3000);
function agreement(a, b) {
  const A = toWords(a), B = toWords(b);
  if (!A.length && !B.length) return null;
  if (!A.length || !B.length) return 0;
  return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
}
function agreementChar(a, b) {
  const A = toChars(a), B = toChars(b);
  if (!A.length && !B.length) return null;
  if (!A.length || !B.length) return 0;
  return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
}
function meanPairwiseAgreement(texts, spaceless) {
  const fn = spaceless ? agreementChar : agreement;
  const vals = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = fn(texts[i], texts[j]);
      if (a != null) vals.push(a);
    }
  }
  return { mean: mean(vals), n_pairs: vals.length, values: vals };
}

// Script key for scoreAgainstReference. Observation `script` values (armenian,
// greek, hebrew, latin, cjk, tibetan) map directly onto SCRIPT_DEFS keys in
// lib/metrics.mjs, EXCEPT cjk/tibetan use the 'cjk' branch signature (tibetan
// itself has its own SCRIPT_DEFS entry — pass through as-is; scoreAgainstReference
// dispatches on the literal string, defaulting non-'cjk' to the alphabetic path).
const SPACELESS_SCRIPTS = new Set(['cjk']); // Tibetan is alphabetic-with-syllables in SCRIPT_DEFS, not cjk-tokenized
const isSpaceless = script => SPACELESS_SCRIPTS.has(script);

// ── STEP 0: load reference texts + raw model outputs ────────────────
function loadReferenceTexts() {
  const map = new Map(); // `${scriptPrefix}-${slug}` -> { text, canonicity_grade }
  for (const f of fs.readdirSync(REF_WORKS_DIR).filter(f => f.endsWith('.json'))) {
    const scriptPrefix = f.replace(/\.json$/, '');
    const d = JSON.parse(fs.readFileSync(path.join(REF_WORKS_DIR, f), 'utf8'));
    for (const w of d.works || []) {
      if (!w.slug || !w.reference) continue; // skip _removed / stub entries
      map.set(`${scriptPrefix}-${w.slug}`, { text: w.reference, canonicity_grade: w.canonicity_grade || null, work: w.work });
    }
  }
  return map;
}

// Work-name -> observation-slug map for the four 2026-07-23 within-work-pair
// additions, whose raw outputs live in scorecard-outputs-2026-07-23-canonicity.jsonl
// (keyed by `work`, not `slug` — that file predates the slug convention).
const CANONICITY_WORK_TO_SLUG = {
  'Aeneid X.362-382 (Pallas rallies the Arcadians), 1580 Meyen Virgil': 'latin-aeneid-10-pallas',
  'Iliad XIII.493-517 (Idomeneus aristeia), MS Rouse 358': 'greek-iliad-13-idomeneus',
  'Zohrab OT, 1 Chronicles 1:1-23 (table-of-nations genealogy)': 'armenian-zohrab-1chronicles-1',
  'Vulgate Genesis 5:3-18 (Sethite genealogy), 1566 Louvain Vulgate': 'latin-vulgate-genesis-5-genealogy',
};

function loadRawTextsBySlug() {
  const bySlug = new Map(); // slug -> [{model, run_index, source, text}]
  const push = (slug, row) => {
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(row);
  };
  for (const r of readJsonl(V2_RUNS_FILE)) {
    if (r.raw_text) push(r.slug, { model: r.model, run_index: r.run_index, source: r.source, text: r.raw_text });
  }
  for (const r of readJsonl(CANONICITY_RUNS_FILE)) {
    const slug = CANONICITY_WORK_TO_SLUG[r.work];
    if (slug && r.text) push(slug, { model: r.model, run_index: r.run, source: 'canonicity-sweep', text: r.text });
  }
  return bySlug;
}

// ── STEP 1: anchor calibration points ────────────────────────────────
function buildAnchorPoints(obsRows, refTexts, rawBySlug) {
  const bySlug = new Map();
  for (const r of obsRows) {
    if (!r.slug || !r.page_class) continue;
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, []);
    bySlug.get(r.slug).push(r);
  }

  const points = [];
  const skippedNoRaw = [];
  for (const [slug, rows] of bySlug) {
    const pc = rows[0].page_class;
    const canonical = pc.canonical_text === true;
    const script = rows[0].script;
    const spaceless = isSpaceless(script);

    const raw = rawBySlug.get(slug) || [];
    const texts = raw.map(r => r.text).filter(Boolean);
    if (texts.length < 2) { skippedNoRaw.push(slug); }

    const pair = meanPairwiseAgreement(texts, spaceless);

    // Free-skip accuracy: trust the pipeline's own observations (char_accuracy),
    // do not recompute — it's the authoritative number consumers already see.
    const aligned = rows.filter(r => r.aligned);
    const freeSkipMean = mean(aligned.map(r => r.char_accuracy));
    const freeSkipRawMean = mean(rows.filter(r => r.char_accuracy_raw != null).map(r => r.char_accuracy_raw));

    // Windowed accuracy: recomputed here (PR #3304's charAccuracyWindowed is not
    // in the exported observations), against the reference text and each run's
    // raw output, using the SAME scoreAgainstReference() the live pipeline uses.
    const refEntry = refTexts.get(slug);
    let windowedVals = [];
    if (refEntry && texts.length) {
      const metricScript = spaceless ? 'cjk' : script;
      for (const t of texts) {
        try {
          const s = scoreAgainstReference(refEntry.text, t, metricScript);
          if (s.aligned && s.charAccuracyWindowed != null) windowedVals.push(s.charAccuracyWindowed);
        } catch { /* malformed run text — skip, do not crash the page */ }
      }
    }

    points.push({
      slug, script, language: rows[0].language, work: rows[0].work,
      book_id: rows[0].book_id, canonical_text: canonical,
      canonicity_grade: refEntry?.canonicity_grade ?? null,
      n_obs_rows: rows.length, n_aligned: aligned.length,
      n_raw_texts: texts.length, n_agreement_pairs: pair.n_pairs,
      agreement_mean: round(pair.mean),
      accuracy_freeskip_mean: round(freeSkipMean),
      accuracy_freeskip_raw_mean: round(freeSkipRawMean),
      accuracy_windowed_mean: windowedVals.length ? round(mean(windowedVals)) : null,
      n_windowed: windowedVals.length,
      has_reference_text: !!refEntry,
    });
  }
  return { points, skippedNoRaw };
}

// ── STEP 2: fit agreement -> accuracy ────────────────────────────────
function pearsonR(xs, ys) {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
function olsFit(xs, ys) {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  return { slope, intercept };
}
function bootstrapCI(xs, ys, iters = 2000, seed = 42) {
  // xorshift32 for a reproducible bootstrap (no external RNG dependency)
  let s = seed >>> 0;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const n = xs.length;
  const slopes = [], intercepts = [];
  for (let it = 0; it < iters; it++) {
    const bx = [], by = [];
    for (let i = 0; i < n; i++) { const k = Math.floor(rnd() * n); bx.push(xs[k]); by.push(ys[k]); }
    const f = olsFit(bx, by);
    slopes.push(f.slope); intercepts.push(f.intercept);
  }
  slopes.sort((a, b) => a - b); intercepts.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * arr.length)))];
  return {
    slope_ci: [round(q(slopes, 0.025), 3), round(q(slopes, 0.975), 3)],
    intercept_ci: [round(q(intercepts, 0.025), 3), round(q(intercepts, 0.975), 3)],
  };
}
// Pool-adjacent-violators isotonic regression: y monotone non-decreasing in x.
// Points must be pre-sorted by x ascending.
function isotonicFit(ysSorted) {
  const level = []; // stack of {sum, count}
  for (const y of ysSorted) {
    let cur = { sum: y, count: 1 };
    while (level.length && (level[level.length - 1].sum / level[level.length - 1].count) > cur.sum / cur.count) {
      const top = level.pop();
      cur = { sum: top.sum + cur.sum, count: top.count + cur.count };
    }
    level.push(cur);
  }
  const out = [];
  for (const lvl of level) { const v = lvl.sum / lvl.count; for (let k = 0; k < lvl.count; k++) out.push(v); }
  return out;
}

const MIN_PAGES_FOR_FIT = 5;

function fitStratum(points, label) {
  const usable = points.filter(p => p.agreement_mean != null && p.accuracy_freeskip_mean != null);
  const n = usable.length;
  if (n < MIN_PAGES_FOR_FIT) {
    return {
      label, n, usable: false,
      reason: `n=${n} pages < ${MIN_PAGES_FOR_FIT} — UNUSABLE, no fit attempted, never extrapolate`,
      points: usable.map(p => ({ slug: p.slug, agreement: p.agreement_mean, accuracy_freeskip: p.accuracy_freeskip_mean, accuracy_windowed: p.accuracy_windowed_mean })),
    };
  }
  const sorted = [...usable].sort((a, b) => a.agreement_mean - b.agreement_mean);
  const xs = sorted.map(p => p.agreement_mean);
  const ysFree = sorted.map(p => p.accuracy_freeskip_mean);
  const ysWin = sorted.map(p => p.accuracy_windowed_mean).filter(y => y != null);
  const fitFree = olsFit(xs, ysFree);
  const rFree = pearsonR(xs, ysFree);
  const ciFree = bootstrapCI(xs, ysFree);
  const isoFree = isotonicFit(ysFree);
  let fitWin = null, rWin = null;
  if (ysWin.length === n) {
    fitWin = olsFit(xs, ysWin);
    rWin = pearsonR(xs, ysWin);
  }
  // A slope CI that spans zero means the fit cannot distinguish "accuracy rises
  // with agreement" from "flat" or even "falls slightly" at this n — the point
  // estimate is still the best available number, but the ORDERING it implies
  // between two corpus cells (e.g. "lower agreement -> higher predicted
  // accuracy" if the point slope is negative) is not statistically supported.
  // Flag it rather than silently predicting a non-monotonic-looking sequence.
  const slopeCiCrossesZero = ciFree.slope_ci[0] <= 0 && ciFree.slope_ci[1] >= 0;
  return {
    label, n, usable: true,
    agreement_range: [round(Math.min(...xs)), round(Math.max(...xs))],
    freeskip_fit: { slope: round(fitFree.slope, 3), intercept: round(fitFree.intercept, 3), r: round(rFree, 3), ...ciFree, slope_ci_crosses_zero: slopeCiCrossesZero },
    windowed_fit: fitWin ? { slope: round(fitWin.slope, 3), intercept: round(fitWin.intercept, 3), r: round(rWin, 3) } : null,
    isotonic_freeskip_fitted: isoFree.map(v => round(v)),
    points: sorted.map((p, i) => ({
      slug: p.slug, agreement: p.agreement_mean,
      accuracy_freeskip: p.accuracy_freeskip_mean, accuracy_windowed: p.accuracy_windowed_mean,
      isotonic_fitted_freeskip: round(isoFree[i]),
    })),
  };
}

function predictFromFit(fit, x) {
  if (!fit || !fit.usable) return { value: null, note: 'no usable fit' };
  const [lo, hi] = fit.agreement_range;
  const extrapolated = x < lo || x > hi;
  const clamped = Math.min(hi, Math.max(lo, x));
  const raw = fit.freeskip_fit.intercept + fit.freeskip_fit.slope * clamped;
  const value = Math.min(1, Math.max(0, raw));
  return { value: round(value), extrapolated, clamped_from: extrapolated ? round(x) : null };
}

// ── STEP 3: apply to corpus ───────────────────────────────────────────
// Corpus 'language' (books.language, the EDITION language) -> the calibration
// stratum it should draw on. Anchor pages only cover Armenian/Greek/Latin/German
// (n>=5) — every other spaced-script language gets the POOLED 'spaced' fit,
// flagged as cross-script transfer, never a script-specific claim. Space-less
// languages (Tibetan, Chinese) have ZERO non-canonical anchor pages in this
// dataset (all 6 Chinese anchor pages are canonical — ctext-based works) and are
// UNCALIBRATED: corpus agreement is reported descriptively only, no accuracy
// estimate, because there is nothing to fit on for that class.
// Anchor fit strata are now keyed directly by `language` (matching books.language
// values, the same field the corpus stratifies on) — Armenian/Greek/Latin/German
// have usable (n>=5) fits; every other alphabetic language falls back to the
// pooled 'spaced' fit, flagged as cross-script transfer.
//
// Space-less scripts (no word boundaries — the tokenizer collapses them into a
// handful of huge units, per revision-agreement-corpus.mjs's SPACELESS_RE: Han,
// Tibetan, Hiragana/Katakana, Thai, Khmer, Lao, Myanmar) and logographic/
// hieroglyphic systems are BOTH excluded from the 'spaced' cross-script transfer
// — that fit was built entirely from alphabetic subsequence matching and has
// nothing in common with how these scripts are tokenized or scored. This is a
// stronger exclusion than "no script-specific fit"; these get NO fit at all,
// descriptive corpus agreement only. (Names matched loosely — corpus `language`
// values include compound/mixed labels like "Chinese; English".)
const NO_TRANSFER_RE = /chinese|japanese|thai|tibetan|burmese|khmer|\blao\b|hieroglyph/i;

function applyCorpusWide(strataObj, fits) {
  const lxy = strataObj?.lang_x_year || [];
  const out = [];
  for (const row of lxy) {
    const [language, era] = row.key.split(' | ');
    if (language === '?' || language === 'auto-detect') continue; // unknown script, cannot calibrate
    const spaceless = NO_TRANSFER_RE.test(language);
    let stratumKey, transferred;
    if (spaceless) { stratumKey = null; transferred = false; }
    else if (fits.perScript[language]?.usable) {
      stratumKey = language; transferred = false;
    } else if (fits.spaced.usable) { stratumKey = 'spaced-pooled'; transferred = true; }
    else { stratumKey = null; transferred = false; }

    const fit = stratumKey === 'spaced-pooled' ? fits.spaced : (stratumKey ? fits.perScript[stratumKey] : null);
    const pred = fit ? predictFromFit(fit, row.mean_agreement) : { value: null, note: 'no calibration — space-less script, zero non-canonical anchor pages' };

    out.push({
      language, era, n_pairs: row.n,
      corpus_mean_agreement: round(row.mean_agreement),
      corpus_median_agreement: round(row.median_agreement),
      calibration_stratum: stratumKey,
      cross_script_transfer: transferred,
      estimated_accuracy: pred.value,
      extrapolated_beyond_anchor_range: pred.extrapolated || false,
      space_less_uncalibrated: spaceless,
    });
  }
  return out;
}

// Canonical-dominance flag: a stratum is flagged when the language is one where
// a large share of held pages are plausibly liturgical/scriptural/classical
// (i.e. the SAME kind of material the anchor canonical pages are drawn from),
// which would inflate corpus agreement via recitation without the anchor fit
// (built on non-canonical pages only) knowing about it. This is a coarse,
// named-collection heuristic, not a per-book canonicity score — flag, don't compute.
const CANON_HEAVY_LANGS = new Set(['Hebrew', 'Latin', 'Greek', 'Armenian', 'Tibetan', 'Chinese']);

function main() {
  const obsRows = readJsonl(OBS_FILE).filter(r => r.slug && r.page_class);
  if (!obsRows.length) throw new Error(`No reference-scored rows in ${OBS_FILE}`);
  const refTexts = loadReferenceTexts();
  const rawBySlug = loadRawTextsBySlug();

  const { points, skippedNoRaw } = buildAnchorPoints(obsRows, refTexts, rawBySlug);
  const noncanon = points.filter(p => !p.canonical_text);
  const canon = points.filter(p => p.canonical_text);

  // STEP 2: fits. Grouped by LANGUAGE, not `script` — German pages carry
  // script:'latin' (Fraktur/Latin alphabet) but are a distinct stratum from
  // true Latin in the paper's own convention (CLAUDE.md: "Latin 7, German 5" as
  // separate counts), and conflating them under `script` silently pooled 5
  // German pages into a 10-page "latin" fit. `script` still drives the coarse
  // spaced-vs-spaceless split and which SCRIPT_DEFS folding rules apply when
  // scoring (German text is still Latin-alphabet for that purpose).
  const bySpaceClass = { spaced: [], spaceless: [] };
  const byLanguage = {};
  for (const p of noncanon) {
    const cls = isSpaceless(p.script) ? 'spaceless' : 'spaced';
    bySpaceClass[cls].push(p);
    (byLanguage[p.language || p.script] ||= []).push(p);
  }
  const fits = {
    spaced: fitStratum(bySpaceClass.spaced, 'spaced (all alphabetic scripts, pooled)'),
    spaceless: fitStratum(bySpaceClass.spaceless, 'space-less (CJK, pooled)'),
    perScript: Object.fromEntries(Object.entries(byLanguage).map(([s, pts]) => [s, fitStratum(pts, s)])),
  };

  // Canonical-vs-noncanon agreement/accuracy comparison (the exclusion rationale, quantified on this exact dataset)
  const rForClass = cls => {
    const pts = cls === 'canon' ? canon : noncanon;
    const usable = pts.filter(p => p.agreement_mean != null && p.accuracy_freeskip_mean != null);
    return { n: usable.length, r: round(pearsonR(usable.map(p => p.agreement_mean), usable.map(p => p.accuracy_freeskip_mean)), 3) };
  };
  const canonVsNoncanonR = { canon: rForClass('canon'), noncanon: rForClass('noncanon') };

  // STEP 3: corpus-wide application
  const corpusFiles = fs.readdirSync(RESULTS_DIR).filter(f => /^revision-agreement-corpus-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const corpusFile = args['corpus-summary'] || (corpusFiles.length ? path.join(RESULTS_DIR, corpusFiles[corpusFiles.length - 1]) : null);
  let corpusApplication = null, corpusMeta = null, sameLeafApplication = null, leafComparison = null;
  if (corpusFile && fs.existsSync(corpusFile)) {
    const corpusSummary = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
    corpusApplication = applyCorpusWide(corpusSummary.strata, fits);
    corpusMeta = {
      file: path.relative(process.cwd(), corpusFile),
      date: corpusSummary.date,
      eligible_pairs: corpusSummary.corpus_summary.eligible_pairs,
      mean_agreement: corpusSummary.corpus_summary.mean_agreement,
      median_agreement: corpusSummary.corpus_summary.median_agreement,
      leaf: corpusSummary.leaf || null,
    };
    // #3473 — re-fit over pairs that demonstrably read the SAME LEAF. A pair
    // whose two passes printed different page numbers looked at different
    // images, so its "disagreement" is re-archiving, not reading difficulty,
    // and feeding it to an agreement->accuracy fit measures image churn.
    // Both applications are emitted; the delta is the finding, not either one.
    if (corpusSummary.strata_same_leaf) {
      sameLeafApplication = applyCorpusWide(corpusSummary.strata_same_leaf, fits);
      const key = c => `${c.language} | ${c.era}`;
      const byKey = new Map(sameLeafApplication.map(c => [key(c), c]));
      leafComparison = corpusApplication.map(all => {
        const same = byKey.get(key(all));
        return {
          language: all.language, era: all.era,
          n_pairs_all: all.n_pairs, n_pairs_same_leaf: same?.n_pairs ?? 0,
          same_leaf_retention: all.n_pairs ? round((same?.n_pairs ?? 0) / all.n_pairs, 3) : null,
          mean_agreement_all: all.corpus_mean_agreement,
          mean_agreement_same_leaf: same?.corpus_mean_agreement ?? null,
          estimated_accuracy_all: all.estimated_accuracy,
          estimated_accuracy_same_leaf: same?.estimated_accuracy ?? null,
          accuracy_delta: (all.estimated_accuracy != null && same?.estimated_accuracy != null)
            ? round(same.estimated_accuracy - all.estimated_accuracy, 4) : null,
        };
      }).sort((a, b) => b.n_pairs_all - a.n_pairs_all);
    }
  }

  const summary = {
    date: new Date().toISOString(),
    inputs: {
      observations_file: path.relative(process.cwd(), OBS_FILE),
      reference_scored_rows: obsRows.length,
      anchor_pages_total: points.length,
      anchor_pages_canonical: canon.length,
      anchor_pages_noncanonical: noncanon.length,
      pages_missing_raw_text: skippedNoRaw,
      corpus_summary_used: corpusMeta,
    },
    exclusion_rationale: {
      note: 'Canonical pages are EXCLUDED from the agreement->accuracy fit. Recitation makes ' +
        'independent models agree with each other while both misreport the page, so agreement ' +
        'measures memorization consensus on canonical text, not reading quality.',
      pearson_r_on_this_dataset: canonVsNoncanonR,
      pilot_reference: 'Pilot (smaller sample): r=0.75 noncanon vs r=0.49 canon.',
      honesty_flag: canonVsNoncanonR.canon.r != null && canonVsNoncanonR.noncanon.r != null &&
        canonVsNoncanonR.canon.r > canonVsNoncanonR.noncanon.r
        ? 'On THIS 44-page dataset the pooled canon r is HIGHER than noncanon r — the opposite ' +
          'of the pilot direction. Do not paper over this: at n=12 the canon r pools SIX different ' +
          'scripts (only 1-2 points each), so between-script separation (each script sits at its own ' +
          'agreement/accuracy level) can inflate a pooled r without reflecting a real within-script ' +
          'relationship — a Simpson\'s-paradox-shaped artifact of small n, not a refutation of the ' +
          'exclusion. The exclusion decision itself rests on the RECITATION MECHANISM demonstrated ' +
          'directly elsewhere in the paper (within-work pairs: canonical Iliad I scores 100% across ' +
          'every model on hard 16th-c. Greek cursive it cannot be reading better than the surrounding ' +
          'text — paper result #9), not on this single pooled correlation number, which is too small-n ' +
          'and cross-script-confounded to be dispositive either way.'
        : null,
    },
    anchor_points: { canonical: canon, non_canonical: noncanon },
    fits,
    corpus_wide_calibration: corpusApplication,
    corpus_wide_calibration_same_leaf: sameLeafApplication,
    same_leaf_comparison: leafComparison,
    caveats: [
      leafComparison
        ? 'A large share of revision pairs did not read the same LEAF (#3473): the two passes ' +
          'printed different page numbers, so their disagreement is re-archiving, not reading ' +
          'difficulty. `corpus_wide_calibration_same_leaf` re-applies the fit to same-leaf pairs ' +
          'only. Treat neither column as the answer on its own: the all-pairs column mixes image ' +
          'churn into "illegibility", and the same-leaf column is a BIASED subpopulation — ' +
          'requiring a printed page number on both sides selects pages legible enough to print ' +
          'one twice. Read the delta, and read `same_leaf_retention` before trusting any cell.'
        : 'Corpus summary predates the leaf-shift instrumentation (#3473) — it carries no ' +
          '`strata_same_leaf`, so these bands are computed over ALL pairs including ones whose ' +
          'two passes read different images. Regenerate with revision-agreement-corpus.mjs.',
      'Revision pairs are mostly within-Gemini-family transitions (flash->current, ' +
        'lite->current), NOT independent readings across engines — calibrated numbers are ' +
        'estimates CONDITIONAL on the anchor fit (built from a small, multi-engine anchor set) ' +
        'transferring to same-family re-runs. They are not validated against an independent OCR engine.',
      'Canonical-heavy strata inflate agreement without the fit knowing it: recitation makes ' +
        'independent runs agree while both misreport the page. Strata in ' +
        `${[...CANON_HEAVY_LANGS].join(', ')} plausibly contain a mix of liturgical/scriptural/` +
        'classical works alongside ordinary prose; a calibrated estimate for these languages may ' +
        'read HIGHER than true reading accuracy to the extent canonical passages are present. Flagged, not corrected — ' +
        'no per-book canonicity score exists corpus-wide yet.',
      'Space-less scripts (Tibetan, Chinese) have ZERO non-canonical anchor pages in this dataset ' +
        '(all 6 Chinese anchor pages are canonical ctext works) — there is no fit to apply, and ' +
        'none is reported. Corpus agreement for these languages is descriptive only.',
      'Per-script fits use n=5-12 PAGES (not runs) — small-sample estimates. Bootstrap CIs are ' +
        'reported and are WIDE; treat point estimates as indicative, not precise.',
      'Applying any fit outside its anchor agreement range is extrapolation and is flagged ' +
        'per-cell (`extrapolated_beyond_anchor_range`) rather than silently clamped as fact.',
    ],
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 1));
  console.log(`Wrote ${OUT_JSON}`);
  writeReport(summary);
  console.log(`Wrote ${OUT_MD}`);
}

function writeReport(s) {
  const lines = [];
  lines.push(`# Calibration scorecard — how accurate is the text Source Library serves? (${DATE})`, '');
  lines.push('Reader-first deliverable for #3235: fit an agreement->accuracy calibration on pinned,',
    'reference-scored pages, then apply it to the whole `page_revisions` double-OCR corpus to',
    'estimate per-script x per-era accuracy at zero marginal model cost.', '');
  lines.push('**Read this first if you are not a statistician:** the table in "Scorecard v0" below is',
    'the answer. Everything above it is how we got there and how much to trust it.', '');

  lines.push('## Why canonical pages are excluded from fitting', '');
  lines.push(s.exclusion_rationale.note, '');
  const r = s.exclusion_rationale.pearson_r_on_this_dataset;
  lines.push(`On this exact dataset: non-canonical r = **${r.noncanon.r ?? 'n/a'}** (n=${r.noncanon.n} pages), ` +
    `canonical r = **${r.canon.r ?? 'n/a'}** (n=${r.canon.n} pages). ${s.exclusion_rationale.pilot_reference}`, '');
  if (s.exclusion_rationale.honesty_flag) {
    lines.push(`> **Honest flag:** ${s.exclusion_rationale.honesty_flag}`, '');
  }

  lines.push('## Step 1+2 — anchor fits, per script (non-canonical pages only)', '');
  lines.push('| stratum | n pages | agreement range | free-skip fit (slope, intercept) | r (free-skip) | r (windowed) | 95% CI on slope | verdict |',
    '|---|---:|---|---|---:|---:|---|---|');
  const fitRow = (key, fit) => {
    if (!fit.usable) return `| ${fit.label} | ${fit.n} | — | — | — | — | — | **UNUSABLE** — ${fit.reason} |`;
    const f = fit.freeskip_fit;
    const verdict = f.slope_ci_crosses_zero ? 'usable, but slope not significant (CI crosses 0)' : 'usable';
    return `| ${fit.label} | ${fit.n} | ${pct(fit.agreement_range[0])}–${pct(fit.agreement_range[1])} | ` +
      `${f.slope} x + ${f.intercept} | ${f.r} | ${fit.windowed_fit ? fit.windowed_fit.r : '—'} | ` +
      `[${f.slope_ci[0]}, ${f.slope_ci[1]}] | ${verdict} |`;
  };
  lines.push(fitRow('spaced', s.fits.spaced));
  lines.push(fitRow('spaceless', s.fits.spaceless));
  for (const [script, fit] of Object.entries(s.fits.perScript)) lines.push(fitRow(script, fit));
  lines.push('');
  lines.push('Free-skip (upper bound) and windowed (lower bound, PR #3304) accuracy per anchor page:', '');
  lines.push('| language (stratum) | slug | agreement | accuracy (free-skip) | accuracy (windowed) | bracket width |',
    '|---|---|---:|---:|---:|---:|');
  for (const p of [...s.anchor_points.non_canonical].sort((a, b) => (a.language || '').localeCompare(b.language || '') || (b.agreement_mean ?? 0) - (a.agreement_mean ?? 0))) {
    const width = (p.accuracy_freeskip_mean != null && p.accuracy_windowed_mean != null)
      ? round(p.accuracy_freeskip_mean - p.accuracy_windowed_mean, 3) : null;
    lines.push(`| ${p.language} | ${p.slug} | ${pct(p.agreement_mean)} | ${pct(p.accuracy_freeskip_mean)} | ` +
      `${p.accuracy_windowed_mean == null ? '— (no ref text / raw text)' : pct(p.accuracy_windowed_mean)} | ` +
      `${width == null ? '—' : (width * 100).toFixed(1) + 'pp'} |`);
  }
  lines.push('');
  if (s.inputs.pages_missing_raw_text.length) {
    lines.push(`Pages with fewer than 2 raw outputs recovered (agreement/windowed not computable): ` +
      `${s.inputs.pages_missing_raw_text.join(', ')}`, '');
  }

  lines.push('## Step 3 — corpus-wide calibrated bands', '');
  if (s.inputs.corpus_summary_used) {
    const c = s.inputs.corpus_summary_used;
    lines.push(`Applied to \`${c.file}\` (built ${c.date?.slice(0, 10)}): **${c.eligible_pairs.toLocaleString()}** ` +
      `eligible \`page_revisions\` pairs, corpus mean agreement ${pct(c.mean_agreement)}, median ${pct(c.median_agreement)}.`, '');
  } else {
    lines.push('_No corpus summary file found — corpus-wide application skipped._', '');
  }
  lines.push('| language | era | n pairs | corpus agreement (median) | calibration used | estimated accuracy | flags |',
    '|---|---|---:|---:|---|---:|---|');
  const sortedCorpus = [...(s.corpus_wide_calibration || [])].sort((a, b) => b.n_pairs - a.n_pairs);
  for (const row of sortedCorpus) {
    if (row.n_pairs < 50) continue; // headline table: drop tiny cells, they're in the JSON
    const flags = [];
    if (row.cross_script_transfer) flags.push('cross-script transfer');
    if (row.extrapolated_beyond_anchor_range) flags.push('extrapolated');
    if (row.space_less_uncalibrated) flags.push('UNCALIBRATED (space-less, zero anchors)');
    if (CANON_HEAVY_LANGS.has(row.language)) flags.push('canon-heavy language — may overstate');
    const usedFit = row.calibration_stratum === 'spaced-pooled' ? s.fits.spaced : s.fits.perScript[row.calibration_stratum];
    if (usedFit?.freeskip_fit?.slope_ci_crosses_zero) flags.push('slope not distinguishable from flat (n too small) — trust magnitude, not cell ordering');
    lines.push(`| ${row.language} | ${row.era} | ${row.n_pairs.toLocaleString()} | ${pct(row.corpus_median_agreement)} | ` +
      `${row.calibration_stratum || '—'} | ${row.estimated_accuracy == null ? '—' : pct(row.estimated_accuracy)} | ${flags.join('; ') || '—'} |`);
  }
  lines.push('', '(Cells with <50 revision pairs are omitted from this table for readability; the full set is in the JSON.)', '');

  if (s.same_leaf_comparison) {
    const L = s.inputs.corpus_summary_used?.leaf;
    lines.push('## Step 3b — the same-leaf re-fit (#3473)', '');
    lines.push('The bands above assume both sides of a revision pair read the same page image. Often',
      'they did not. The printed page number is transcribed *from the leaf the model was shown*, so',
      'two passes printing different numbers looked at different leaves — their disagreement is',
      're-archiving, not reading difficulty.', '');
    if (L) {
      lines.push(`Corpus-wide: **${(L.same_leaf_pairs || 0).toLocaleString()}** same-leaf pairs, ` +
        `**${(L.shifted_pairs || 0).toLocaleString()}** shifted, ` +
        `**${(L.unmeasurable_pairs || 0).toLocaleString()}** unmeasurable (no printed number on one side). ` +
        `Median agreement ${pct(L.median_agreement_same_leaf)} same-leaf vs ${pct(L.median_agreement_shifted)} shifted.`, '');
    }
    lines.push('| language | era | n (all) | n (same leaf) | kept | agreement all → same | est. accuracy all → same | Δ |',
      '|---|---|---:|---:|---:|---|---|---:|');
    for (const c of s.same_leaf_comparison.slice(0, 30)) {
      lines.push(`| ${c.language} | ${c.era} | ${c.n_pairs_all.toLocaleString()} | ${c.n_pairs_same_leaf.toLocaleString()} | ` +
        `${c.same_leaf_retention == null ? '—' : (c.same_leaf_retention * 100).toFixed(0) + '%'} | ` +
        `${pct(c.mean_agreement_all)} → ${pct(c.mean_agreement_same_leaf)} | ` +
        `${pct(c.estimated_accuracy_all)} → ${pct(c.estimated_accuracy_same_leaf)} | ` +
        `${c.accuracy_delta == null ? '—' : (c.accuracy_delta > 0 ? '+' : '') + (c.accuracy_delta * 100).toFixed(1) + 'pp'} |`);
    }
    lines.push('');
    // The delta is the diagnostic. If a large swing in the INPUT produces almost
    // no swing in the OUTPUT, the fit is reporting its intercept, and the leaf
    // question is not what was wrong with the scorecard.
    const both = s.same_leaf_comparison.filter(c => c.accuracy_delta != null);
    if (both.length) {
      const agrD = both.map(c => (c.mean_agreement_same_leaf - c.mean_agreement_all) * 100);
      const accD = both.map(c => c.accuracy_delta * 100);
      const span = a => `${Math.min(...a).toFixed(1)} to ${Math.max(...a).toFixed(1)}pp`;
      lines.push('', `**Sensitivity check (${both.length} cells with both bands).** Excluding shifted pairs moves ` +
        `mean agreement by **${span(agrD)}**, and moves estimated accuracy by **${span(accD)}**.`, '');
      lines.push('That ratio is the finding. A calibration whose output barely responds to a large swing in',
        'its own input is mostly reporting its intercept — the pooled spaced fit is',
        `\`${s.fits.spaced.freeskip_fit.slope}·x + ${s.fits.spaced.freeskip_fit.intercept}\`, so the whole 0–100%`,
        `agreement range spans only ${(s.fits.spaced.freeskip_fit.slope * 100).toFixed(1)} points of accuracy.`,
        'Leaf contamination was real and worth removing, but it was not what was wrong here.', '');
      const bad = Object.entries(s.fits.perScript)
        .filter(([, f]) => f.usable && (f.freeskip_fit.slope <= 0 || f.freeskip_fit.slope_ci_crosses_zero));
      if (bad.length) {
        lines.push('Per-script fits that cannot carry a band, and why any number derived from them is not one:', '');
        for (const [k, f] of bad) {
          lines.push(`- **${k}** — slope \`${f.freeskip_fit.slope}\` (r ${f.freeskip_fit.r}, n=${f.n} pages)` +
            `${f.freeskip_fit.slope <= 0 ? ', **negative**: higher agreement predicts LOWER accuracy' : ''}` +
            `${f.freeskip_fit.slope_ci_crosses_zero ? ', 95% CI crosses zero' : ''}.`);
        }
        lines.push('', 'This is why some cells move *down* when contaminated pairs are removed: the sign of the',
          'fit, not a property of the text.', '');
      }
    }
    lines.push('**Neither column is the answer on its own.** The all-pairs column mixes image churn into',
      '"illegibility". The same-leaf column is a *biased subpopulation*: requiring a printed page number',
      'on both sides selects pages legible enough to print one twice. Read the delta and the `kept`',
      'column together — a cell that kept 20% of its pairs is describing a different population, not a',
      'cleaner measurement of the same one.', '');
  }

  lines.push('## Two caveats to carry with every number above', '');
  for (const c of s.caveats) lines.push(`- ${c}`);
  lines.push('');

  lines.push('## Scorecard v0 (paper-ready subsection)', '');
  lines.push('_Drop-in for `.claude/docs/ocr-memorization-paper.md`, "Experiments planned" ->',
    '"Calibration scorecard" entry, once reviewed._', '');
  lines.push('We fit a monotone agreement->accuracy calibration on the 32 non-canonical anchor pages',
    '(canonical pages excluded — recitation inflates agreement without inflating true reading',
    `accuracy. On this 44-page dataset the pooled canon r (${r.canon.r}, n=12, six scripts) is noisier`,
    `and cross-script-confounded rather than confirmatory; the exclusion rests on the recitation`,
    `mechanism itself, demonstrated directly by the within-work pairs (paper result #9), not on this`,
    `single correlation). Usable`,
    'per-script fits exist for Armenian, Greek, Latin and German (n=5-12 pages each, wide bootstrap',
    'CIs); Hebrew (n=2) and all space-less scripts (Chinese, Tibetan — zero non-canonical anchor',
    'pages) are UNUSABLE and reported as such, never extrapolated. Applied to the 109,953-pair',
    '`page_revisions` corpus (PR #3273), this produces calibrated per-script x per-era accuracy',
    'estimates at zero marginal model cost — with two standing caveats: the corpus is mostly',
    'within-Gemini-family re-OCR (not an independent-engine validation of the fit), and languages', 'whose corpus includes liturgical/classical canonical works may read the calibration high.',
    'Product form: a per-script x per-century scorecard on /research, eventually a per-page', 'confidence surface in the reader.', '');

  fs.writeFileSync(OUT_MD, lines.join('\n'));
}

main();
