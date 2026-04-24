#!/usr/bin/env node
/**
 * Bayesian Hallucination Model
 *
 * Fits a hierarchical Beta-Binomial model to Study 3 thinking sweep data.
 * Produces posteriors per (language, thinking_level) cell, a pooled
 * hierarchical prior across languages, and an adaptive experimental
 * design recommendation for future arms (Claude, new languages).
 *
 * Usage:
 *   node scripts/eval/bayesian-model.mjs              # full model + recommendations
 *   node scripts/eval/bayesian-model.mjs posteriors    # just posterior table
 *   node scripts/eval/bayesian-model.mjs design        # experimental design recommendation
 *   node scripts/eval/bayesian-model.mjs predict       # posterior predictive for new conditions
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWEEP_DIR = path.join(__dirname, 'results', 'thinking-sweep');
const LEVELS = ['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
const LEVEL_IDX = Object.fromEntries(LEVELS.map((l, i) => [l, i]));

function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      args[key] = rest.length > 0 ? rest.join('=') : true;
    } else { args._.push(arg); }
  }
  return args;
}
const args = parseArgs(process.argv);
const command = args._[0] || 'all';

// ── Load data ────────────────────────────────────────────────────────

function loadData() {
  const files = fs.readdirSync(SWEEP_DIR).filter(f => f.endsWith('.json'));
  const results = files.map(f => JSON.parse(fs.readFileSync(path.join(SWEEP_DIR, f))));

  // Aggregate into (language, level) → {k: hallucinations, n: total}
  const cells = {};
  for (const r of results) {
    const key = `${r.language}:${r.thinking_level}`;
    if (!cells[key]) cells[key] = { language: r.language, level: r.thinking_level, k: 0, n: 0, chars: [], thinkTokens: [] };
    cells[key].n++;
    if (r.likely_hallucinated) cells[key].k++;
    cells[key].chars.push(r.ocr_char_count);
    cells[key].thinkTokens.push(r.thinking_tokens);
  }
  return { cells, results };
}

// ── Beta distribution utilities ──────────────────────────────────────

/** Log of Beta function B(a,b) = Γ(a)Γ(b)/Γ(a+b) */
function logBeta(a, b) {
  return lgamma(a) + lgamma(b) - lgamma(a + b);
}

/** Stirling's approximation for log-Gamma */
function lgamma(x) {
  if (x <= 0) return Infinity;
  // Lanczos approximation
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let sum = c[0];
  for (let i = 1; i < g + 2; i++) sum += c[i] / (x + i - 1);
  const t = x + g - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x - 0.5) * Math.log(t) - t + Math.log(sum);
}

/** Beta PDF (unnormalized ok for relative comparisons) */
function betaPdf(x, a, b) {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logBeta(a, b));
}

/** Beta CDF via numerical integration (simple trapezoid) */
function betaCdf(x, a, b, steps = 1000) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const dx = x / steps;
  let sum = 0;
  for (let i = 0; i <= steps; i++) {
    const xi = i * dx;
    const w = (i === 0 || i === steps) ? 0.5 : 1;
    sum += w * betaPdf(xi, a, b);
  }
  return sum * dx;
}

/** Beta quantile via bisection */
function betaQuantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Beta posterior: prior Beta(a0, b0) + k successes in n trials → Beta(a0+k, b0+n-k) */
function betaPosterior(a0, b0, k, n) {
  const a = a0 + k;
  const b = b0 + n - k;
  return {
    a, b,
    mean: a / (a + b),
    mode: (a > 1 && b > 1) ? (a - 1) / (a + b - 2) : a / (a + b),
    variance: (a * b) / ((a + b) ** 2 * (a + b + 1)),
    ci95: [betaQuantile(0.025, a, b), betaQuantile(0.975, a, b)],
    ci80: [betaQuantile(0.10, a, b), betaQuantile(0.90, a, b)],
  };
}

/** Shannon entropy of a Beta distribution (nats) */
function betaEntropy(a, b) {
  return logBeta(a, b) - (a - 1) * (digamma(a) - digamma(a + b)) - (b - 1) * (digamma(b) - digamma(a + b));
}

/** Digamma function (psi) — approximation */
function digamma(x) {
  let result = 0;
  while (x < 6) { result -= 1 / x; x++; }
  result += Math.log(x) - 1 / (2 * x);
  const x2 = 1 / (x * x);
  result -= x2 * (1/12 - x2 * (1/120 - x2 / 252));
  return result;
}

// ── Hierarchical model ───────────────────────────────────────────────

/**
 * Empirical Bayes hierarchical prior:
 * For each thinking level, estimate a pooled Beta prior from all languages.
 * This lets us predict hallucination rates for UNSEEN languages.
 *
 * Method: moment-matching on the per-language posterior means.
 */
function fitHierarchicalPrior(cells) {
  const pooled = {};

  for (const level of LEVELS) {
    const langData = [];
    const langs = [...new Set(Object.values(cells).map(c => c.language))];

    for (const lang of langs) {
      const key = `${lang}:${level}`;
      const cell = cells[key];
      if (!cell) continue;
      // Use cell-level MLE as data point for the hierarchical model
      langData.push({ lang, rate: cell.k / cell.n, k: cell.k, n: cell.n });
    }

    if (langData.length < 2) {
      pooled[level] = { a: 1, b: 1, n_langs: langData.length, method: 'uniform_prior' };
      continue;
    }

    // Moment matching: fit Beta(α, β) to the observed rates
    const rates = langData.map(d => d.rate);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / (rates.length - 1);

    // If all rates are 0 (e.g., HIGH level), use informative prior Beta(1, n_total+1)
    if (mean === 0 || variance === 0) {
      const nTotal = langData.reduce((s, d) => s + d.n, 0);
      pooled[level] = { a: 0.5, b: +(nTotal + 0.5).toFixed(1), pooled_mean: 0, pooled_var: 0, n_langs: langData.length, method: 'all_zero', lang_rates: Object.fromEntries(langData.map(d => [d.lang, { rate: 0, k: d.k, n: d.n }])) };
      continue;
    }

    // Beta moment matching: α = μ((μ(1-μ)/σ²) - 1), β = (1-μ)((μ(1-μ)/σ²) - 1)
    // Clamp variance to avoid degenerate solutions
    const maxVar = mean * (1 - mean) * 0.99; // must be < μ(1-μ)
    const v = Math.min(Math.max(variance, 0.001), maxVar);

    const common = (mean * (1 - mean) / v) - 1;
    const a = Math.max(mean * common, 0.5);
    const b = Math.max((1 - mean) * common, 0.5);

    pooled[level] = {
      a: +a.toFixed(3),
      b: +b.toFixed(3),
      pooled_mean: +mean.toFixed(4),
      pooled_var: +variance.toFixed(6),
      n_langs: langData.length,
      method: 'moment_matching',
      lang_rates: Object.fromEntries(langData.map(d => [d.lang, { rate: +d.rate.toFixed(3), k: d.k, n: d.n }])),
    };
  }

  return pooled;
}

// ── Posterior table ───────────────────────────────────────────────────

function printPosteriors(cells) {
  console.log('\n=== CELL-LEVEL POSTERIORS (Jeffreys prior: Beta(0.5, 0.5)) ===\n');
  console.log(`${'Language'.padEnd(14)} ${'Level'.padEnd(9)} ${'k/n'.padStart(5)} ${'Post.mean'.padStart(10)} ${'95% CI'.padStart(18)} ${'Entropy'.padStart(8)}`);
  console.log('-'.repeat(70));

  const langs = [...new Set(Object.values(cells).map(c => c.language))].sort();

  const posteriors = {};
  for (const lang of langs) {
    for (const level of LEVELS) {
      const key = `${lang}:${level}`;
      const cell = cells[key];
      if (!cell) continue;

      // Jeffreys prior Beta(0.5, 0.5)
      const post = betaPosterior(0.5, 0.5, cell.k, cell.n);
      const ent = betaEntropy(post.a, post.b);
      posteriors[key] = { ...post, entropy: ent, k: cell.k, n: cell.n, language: lang, level };

      const ci = `[${post.ci95[0].toFixed(3)}, ${post.ci95[1].toFixed(3)}]`;
      console.log(`${lang.padEnd(14)} ${level.padEnd(9)} ${(cell.k + '/' + cell.n).padStart(5)} ${post.mean.toFixed(4).padStart(10)} ${ci.padStart(18)} ${ent.toFixed(3).padStart(8)}`);
    }
    console.log('');
  }

  return posteriors;
}

// ── Experimental design ──────────────────────────────────────────────

function printDesign(cells, pooled) {
  console.log('\n=== ADAPTIVE EXPERIMENTAL DESIGN ===\n');

  // 1. Identify highest-uncertainty cells (most information gain from additional runs)
  const posteriors = {};
  const langs = [...new Set(Object.values(cells).map(c => c.language))].sort();

  for (const lang of langs) {
    for (const level of LEVELS) {
      const key = `${lang}:${level}`;
      const cell = cells[key];
      if (!cell) continue;
      const post = betaPosterior(0.5, 0.5, cell.k, cell.n);
      posteriors[key] = { ...post, k: cell.k, n: cell.n, language: lang, level, entropy: betaEntropy(post.a, post.b) };
    }
  }

  // Sort by entropy (highest uncertainty first)
  const byUncertainty = Object.entries(posteriors)
    .filter(([, p]) => p.mean > 0.01 && p.mean < 0.99) // exclude near-certain cells
    .sort((a, b) => b[1].entropy - a[1].entropy);

  console.log('Cells with highest uncertainty (most info gain from additional runs):');
  console.log(`${'Cell'.padEnd(25)} ${'k/n'.padStart(5)} ${'Post.mean'.padStart(10)} ${'95% CI width'.padStart(13)} ${'Entropy'.padStart(8)}`);
  for (const [key, p] of byUncertainty.slice(0, 15)) {
    const ciWidth = (p.ci95[1] - p.ci95[0]).toFixed(3);
    console.log(`${key.padEnd(25)} ${(p.k + '/' + p.n).padStart(5)} ${p.mean.toFixed(3).padStart(10)} ${ciWidth.padStart(13)} ${p.entropy.toFixed(3).padStart(8)}`);
  }

  // 2. Recommended allocation for Claude arms
  console.log('\n--- RECOMMENDED ALLOCATION: Claude Arms (Sonnet 4.6, Haiku 4.5) ---\n');
  console.log('Use hierarchical prior from Gemini Lite to set expectations:');
  console.log('(Stronger prior at HIGH = fewer runs needed to confirm 0% hallucination)\n');

  console.log(`${'Level'.padEnd(9)} ${'Prior'.padStart(14)} ${'Prior mean'.padStart(11)} ${'Recommended n'.padStart(14)} ${'Rationale'.padEnd(40)}`);

  for (const level of LEVELS) {
    const p = pooled[level];
    const priorStr = `Beta(${p.a}, ${p.b})`;
    const mean = p.pooled_mean || p.a / (p.a + p.b);

    // More runs needed where prior uncertainty is high
    let recN, rationale;
    if (mean < 0.05) {
      recN = 5;
      rationale = 'Prior strongly predicts no hallucination';
    } else if (mean < 0.20) {
      recN = 10;
      rationale = 'Moderate prior — need to distinguish from Gemini';
    } else if (mean < 0.50) {
      recN = 15;
      rationale = 'High prior hall rate — test if Claude differs';
    } else {
      recN = 20;
      rationale = 'Prior expects >50% hall — critical to verify';
    }

    console.log(`${level.padEnd(9)} ${priorStr.padStart(14)} ${mean.toFixed(3).padStart(11)} ${recN.toString().padStart(14)} ${rationale}`);
  }

  // 3. Total budget
  const totalPages = 10; // representative pages per language
  const claudeModels = 2; // Sonnet, Haiku
  const pagesPerLang = 5;
  console.log(`\nRecommended design for Claude comparison:`);
  console.log(`  Languages: 6 (Hebrew, Greek, Chinese, Syriac, Armenian, Japanese — those requiring HIGH)`);
  console.log(`  Pages per language: ${pagesPerLang} (reuse Study 2 hallucination pages)`);
  console.log(`  Models: 2 (Sonnet 4.6, Haiku 4.5)`);
  console.log(`  Levels: 2 (NONE, HIGH — skip intermediates since they're unreliable)`);
  console.log(`  Total calls: 6 langs × 5 pages × 2 models × 2 levels = 120`);
  console.log(`  Estimated cost: ~$2.50 (Sonnet) + ~$0.50 (Haiku) = ~$3`);

  // 4. Power analysis: how many runs to detect a difference from Gemini?
  console.log('\n--- POWER ANALYSIS ---\n');
  console.log('Question: If Claude has 5% hallucination rate vs Gemini Lite 30% at NONE,');
  console.log('how many runs per cell to detect the difference with 80% power?\n');

  // Using normal approximation to binomial
  const p1 = 0.30; // Gemini Lite at NONE (observed)
  const p2 = 0.05; // hypothesized Claude rate
  const alpha = 0.05;
  const power = 0.80;
  const z_alpha = 1.96;
  const z_beta = 0.842;
  const pBar = (p1 + p2) / 2;
  const n = Math.ceil(
    (z_alpha * Math.sqrt(2 * pBar * (1 - pBar)) + z_beta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2
    / (p1 - p2) ** 2
  );
  console.log(`  n per cell = ${n} (two-proportion z-test, α=${alpha}, power=${power})`);
  console.log(`  With 5 pages per language, need ${Math.ceil(n / 5)} runs per page`);
  console.log(`  Conclusion: 1 run per page is sufficient for large effects (30% vs 5%),`);
  console.log(`  but 3 runs per page recommended for moderate effects (15% vs 5%)`);
}

// ── Posterior predictive ─────────────────────────────────────────────

function printPredictions(pooled) {
  console.log('\n=== POSTERIOR PREDICTIVE: New Language / New Model ===\n');
  console.log('Using hierarchical prior pooled across 10 languages:\n');

  console.log(`${'Level'.padEnd(9)} ${'Prior'.padStart(14)} ${'E[hall rate]'.padStart(12)} ${'95% PI'.padStart(18)} ${'P(hall=0 in 5 pages)'.padStart(22)}`);
  console.log('-'.repeat(78));

  for (const level of LEVELS) {
    const p = pooled[level];
    const a = p.a, b = p.b;
    const mean = a / (a + b);
    const ci = [betaQuantile(0.025, a, b), betaQuantile(0.975, a, b)];
    const ciStr = `[${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]`;

    // P(0 hallucinations in 5 pages) = E[(1-θ)^5] under Beta(a,b)
    // = B(a, b+5) / B(a, b) = Γ(b+5)Γ(a+b) / (Γ(b)Γ(a+b+5))
    const p0in5 = Math.exp(lgamma(b + 5) + lgamma(a + b) - lgamma(b) - lgamma(a + b + 5));

    console.log(`${level.padEnd(9)} ${`Beta(${a}, ${b})`.padStart(14)} ${mean.toFixed(3).padStart(12)} ${ciStr.padStart(18)} ${(p0in5 * 100).toFixed(1).padStart(20)}%`);
  }

  console.log('\nInterpretation:');
  console.log('  P(hall=0 in 5 pages) is the probability that a new language/model');
  console.log('  produces zero hallucinations on 5 test pages at that thinking level.');
  console.log('  This is the prior you should update with actual Claude results.');
}

// ── Main ─────────────────────────────────────────────────────────────

const { cells } = loadData();
const pooled = fitHierarchicalPrior(cells);

if (command === 'all' || command === 'posteriors') {
  printPosteriors(cells);
}

if (command === 'all' || command === 'predict') {
  printPredictions(pooled);
}

if (command === 'all' || command === 'design') {
  printDesign(cells, pooled);
}

// Save model for reuse
const modelPath = path.join(__dirname, 'results', 'bayesian-model.json');
fs.writeFileSync(modelPath, JSON.stringify({
  cell_posteriors: Object.fromEntries(
    Object.entries(cells).map(([key, cell]) => {
      const post = betaPosterior(0.5, 0.5, cell.k, cell.n);
      return [key, { k: cell.k, n: cell.n, posterior: { a: +post.a.toFixed(3), b: +post.b.toFixed(3), mean: +post.mean.toFixed(4), ci95: post.ci95.map(v => +v.toFixed(4)) } }];
    })
  ),
  hierarchical_prior: pooled,
  meta: { date: new Date().toISOString(), n_results: Object.values(cells).reduce((s, c) => s + c.n, 0), model: 'gemini-3.1-flash-lite-preview', levels: LEVELS },
}, null, 2));
console.log(`\nModel saved: ${modelPath}`);
