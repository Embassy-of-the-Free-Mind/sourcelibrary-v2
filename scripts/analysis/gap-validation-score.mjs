#!/usr/bin/env node
/**
 * Score the n≈250 translation-gap validation (#2684).
 *
 * Joins the answer key (pipeline label) with the two independent grounded
 * adjudicators (Claude primary + Gemini 2nd model) and reports:
 *   - TRANSLATED stratum precision: of works the pipeline calls translated, how
 *     many adjudicators confirm a real prior English translation.
 *   - GAP stratum recall / untranslated rate, SPLIT by composition era
 *     (the pilot's dominant confound: print-year ≠ composition-year). Two
 *     denominators: all USTC-print gap clusters vs Renaissance-composed only.
 *   - Wilson 95% CIs on every rate.
 *   - Dual-adjudicator agreement (raw + Cohen's κ) on the binary
 *     translated/untranslated question — the AI-vs-AI ceiling.
 *   - A Rogan–Gladen scaffold: plugs in human sensitivity/specificity once the
 *     gold-standard subset is labeled (until then reports AI-only).
 *
 * Reads (from scripts/analysis/eval-data/):
 *   gap-validation-n250-frame.json          (answer key: label + era? + sources)
 *   gap-validation-gemini-verdicts.jsonl    (2nd model)
 *   gap-validation-claude-verdicts.jsonl    (primary)
 * Writes:
 *   gap-validation-n250-results.json
 *
 * Usage: node scripts/analysis/gap-validation-score.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dir, 'eval-data');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(EVAL, f), 'utf8'));
const rdl = (f) => {
  const p = path.join(EVAL, f);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
};

// Wilson score interval for a binomial proportion
function wilson(k, n, z = 1.96) {
  if (n === 0) return { p: null, lo: null, hi: null, n: 0, k: 0 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { p: +(p).toFixed(4), lo: +((c - m) / d).toFixed(4), hi: +((c + m) / d).toFixed(4), n, k };
}

// Cohen's kappa for two raters, binary labels
function kappa(pairs) {
  const valid = pairs.filter(([a, b]) => a != null && b != null);
  const n = valid.length;
  if (!n) return { kappa: null, agree: null, n: 0 };
  let agree = 0;
  const m = { a: { t: 0, u: 0 }, b: { t: 0, u: 0 } };
  for (const [a, b] of valid) {
    if (a === b) agree++;
    m.a[a ? 't' : 'u']++;
    m.b[b ? 't' : 'u']++;
  }
  const po = agree / n;
  const pe = (m.a.t / n) * (m.b.t / n) + (m.a.u / n) * (m.b.u / n);
  return { kappa: +((po - pe) / (1 - pe)).toFixed(4), agree: +po.toFixed(4), n };
}

// Rogan–Gladen prevalence correction: p_true = (p_obs + spec - 1) / (sens + spec - 1)
function roganGladen(pObs, sens, spec) {
  const denom = sens + spec - 1;
  if (Math.abs(denom) < 1e-9) return null;
  return Math.min(1, Math.max(0, (pObs + spec - 1) / denom));
}

// collapse an adjudicator verdict to a binary "a prior English translation exists"
// container → null (ill-posed, excluded from the binary rate); uncertain/FAIL → null
function toBinary(v) {
  if (!v) return null;
  if (v.relationship === 'container') return null;
  if (v.translation_verdict === 'translated') return true;
  if (v.translation_verdict === 'untranslated') return false;
  return null; // uncertain / FAIL / partial-only handled by verdict already
}

function main() {
  const frame = rd('gap-validation-n250-frame.json');
  const gem = new Map(rdl('gap-validation-gemini-verdicts.jsonl').map((r) => [r.key, r]));
  const cla = new Map(rdl('gap-validation-claude-verdicts.jsonl').map((r) => [r.key, r]));
  // optional third-pass tie-break of the dual-adjudicator disagreements
  const tie = new Map(rdl('gap-validation-tiebreak-verdicts.jsonl').map((r) => [r.key, r]));
  console.log(`frame ${frame.works.length} | gemini ${gem.size} | claude ${cla.size} | tiebreak ${tie.size}`);

  // best era estimate per work: prefer agreement; else Claude (primary); else Gemini
  const eraOf = (w) => {
    const c = cla.get(w.key)?.composition_era;
    const g = gem.get(w.key)?.composition_era;
    if (c && g && c === g) return c;
    return c || g || 'unknown';
  };
  const isRenaissance = (era) => era === 'renaissance_early_modern';

  const rows = frame.works.map((w) => {
    const c = cla.get(w.key);
    const g = gem.get(w.key);
    return {
      key: w.key,
      label: w.label,
      author: w.author,
      title: (w.title || '').slice(0, 70),
      era: eraOf(w),
      claude: toBinary(c),
      gemini: toBinary(g),
      claude_v: c?.translation_verdict || null,
      gemini_v: g?.translation_verdict || null,
      claude_rel: c?.relationship || null,
      gemini_rel: g?.relationship || null,
    };
  });

  // consensus binary: agree → that; disagree → break with the third pass if present, else null
  const tieBin = (v) => { if (!v) return null; if (v.relationship === 'container') return null; if (v.complete_prior_exists === true) return true; if (v.complete_prior_exists === false) return false; if (v.translation_verdict === 'translated') return true; if (v.translation_verdict === 'untranslated') return false; return null; };
  for (const r of rows) {
    r.disagree = r.claude != null && r.gemini != null && r.claude !== r.gemini;
    if (r.disagree) { r.tiebreak = tieBin(tie.get(r.key)); }
    r.consensus = r.claude != null && r.gemini != null && r.claude === r.gemini ? r.claude
      : r.disagree ? (r.tiebreak ?? null)               // third pass settles it
      : (r.claude != null && r.gemini == null) ? r.claude
      : (r.gemini != null && r.claude == null) ? r.gemini
      : null;
  }

  const T = rows.filter((r) => r.label === 'translated');
  const G = rows.filter((r) => r.label === 'gap');

  // --- TRANSLATED stratum precision (consensus says a real prior exists) ---
  const Tscored = T.filter((r) => r.consensus != null);
  const precision = wilson(Tscored.filter((r) => r.consensus === true).length, Tscored.length);

  // --- GAP stratum: untranslated rate, by era ---
  const gapRate = (subset) => {
    const scored = subset.filter((r) => r.consensus != null);
    return wilson(scored.filter((r) => r.consensus === false).length, scored.length);
  };
  const gapAll = gapRate(G);
  const gapRenaissance = gapRate(G.filter((r) => isRenaissance(r.era)));
  const gapAncientMedieval = gapRate(G.filter((r) => r.era === 'antiquity' || r.era === 'medieval'));

  // era breakdown of the gap stratum
  const eraCounts = {};
  for (const r of G) eraCounts[r.era] = (eraCounts[r.era] || 0) + 1;

  // --- dual-adjudicator agreement on the binary question (all works) ---
  const k = kappa(rows.map((r) => [r.claude, r.gemini]));

  // --- Rogan–Gladen scaffold (AI-only until human sens/spec available) ---
  const HUMAN = (() => {
    const p = path.join(EVAL, 'gap-validation-human-sens-spec.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  })();
  const rg = {};
  if (HUMAN?.consensus?.sens && HUMAN?.consensus?.spec) {
    // correct the OBSERVED translated-fraction on each denominator
    const corr = (w) => roganGladen(1 - w.p, HUMAN.consensus.sens, HUMAN.consensus.spec);
    rg.note = 'Rogan–Gladen-corrected TRANSLATED fraction using human-measured consensus sens/spec';
    rg.translated_fraction_renaissance_corrected = gapRenaissance.p != null ? +corr(gapRenaissance).toFixed(4) : null;
    rg.sens = HUMAN.consensus.sens; rg.spec = HUMAN.consensus.spec;
  } else {
    rg.note = 'AI-only (no human gold standard yet); Rogan–Gladen pending gap-validation-human-sens-spec.json';
  }

  const results = {
    generated: new Date().toISOString().slice(0, 10),
    n: { frame: frame.works.length, translated: T.length, gap: G.length, gemini: gem.size, claude: cla.size },
    method: 'two-sided stratified blind sample; dual independent grounded adjudicators (Claude primary + Gemini 2nd); consensus binary on prior-English-translation-exists',
    translated_stratum_precision: precision,
    gap_stratum: {
      untranslated_rate_all_print_denominator: gapAll,
      untranslated_rate_renaissance_composed: gapRenaissance,
      untranslated_rate_ancient_medieval_reprints: gapAncientMedieval,
      era_breakdown: eraCounts,
    },
    dual_adjudicator: { ...k, disagreements: rows.filter((r) => r.disagree).length, ill_posed_or_uncertain: rows.filter((r) => r.consensus == null).length },
    rogan_gladen: rg,
    disagreement_keys: rows.filter((r) => r.disagree).map((r) => r.key),
    rows,
  };
  fs.writeFileSync(path.join(EVAL, 'gap-validation-n250-results.json'), JSON.stringify(results, null, 2));

  // console summary
  const pct = (w) => (w.p == null ? 'n/a' : `${(100 * w.p).toFixed(1)}% [${(100 * w.lo).toFixed(0)}–${(100 * w.hi).toFixed(0)}] n=${w.n}`);
  console.log('\n=== TRANSLATION-GAP VALIDATION n≈250 ===');
  console.log(`Translated-stratum PRECISION (real prior exists): ${pct(precision)}`);
  console.log(`Gap-stratum UNTRANSLATED — all print denominator:  ${pct(gapAll)}`);
  console.log(`Gap-stratum UNTRANSLATED — Renaissance-composed:   ${pct(gapRenaissance)}`);
  console.log(`Gap-stratum (ancient/medieval reprints only):      ${pct(gapAncientMedieval)}`);
  console.log(`Gap-stratum era breakdown: ${JSON.stringify(eraCounts)}`);
  console.log(`Dual-adjudicator: agree ${k.agree != null ? (100 * k.agree).toFixed(0) + '%' : 'n/a'}, κ=${k.kappa}, n=${k.n}; disagreements=${results.dual_adjudicator.disagreements}, ill-posed/uncertain=${results.dual_adjudicator.ill_posed_or_uncertain}`);
  console.log(`Rogan–Gladen: ${rg.note}`);
  console.log(`\nwrote gap-validation-n250-results.json`);
}

main();
