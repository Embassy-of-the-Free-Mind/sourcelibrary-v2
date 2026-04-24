#!/usr/bin/env node
/**
 * Optimal Experimental Design for Confident Hallucinator Study
 *
 * Uses the Bayesian model from Study 3 as prior. Computes expected
 * information gain (EIG) for each candidate experiment. Allocates
 * a fixed budget to maximize total EIG via greedy optimization.
 *
 * Design space:
 *   Models: Claude Sonnet 4.6, Claude Haiku 4.5, Gemini Lite (replication)
 *   Languages: 10 (from Study 2)
 *   Thinking: NONE vs HIGH (Study 3 showed intermediates are unreliable)
 *   Pages: 5 hallucination pages per language (from Study 2)
 *
 * Optimality criterion: D-optimal (maximize expected KL divergence
 * from prior to posterior, equivalent to maximizing expected
 * information gain in bits).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load prior model ─────────────────────────────────────────────────

const model = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'bayesian-model.json')));
const hierPrior = model.hierarchical_prior;
const cellPosteriors = model.cell_posteriors;

// ── Beta utilities ───────────────────────────────────────────────────

function lgamma(x) {
  if (x <= 0) return Infinity;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let sum = c[0];
  for (let i = 1; i < 9; i++) sum += c[i] / (x + i - 1);
  const t = x + 6.5;
  return 0.5 * Math.log(2 * Math.PI) + (x - 0.5) * Math.log(t) - t + Math.log(sum);
}

function logBeta(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }

function digamma(x) {
  let r = 0;
  while (x < 6) { r -= 1 / x; x++; }
  r += Math.log(x) - 1 / (2 * x);
  const x2 = 1 / (x * x);
  r -= x2 * (1/12 - x2 * (1/120 - x2 / 252));
  return r;
}

function betaEntropy(a, b) {
  return logBeta(a, b) - (a - 1) * (digamma(a) - digamma(a + b)) - (b - 1) * (digamma(b) - digamma(a + b));
}

function betaMean(a, b) { return a / (a + b); }

function betaQuantile(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdfApprox(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function betaCdfApprox(x, a, b, steps = 500) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const dx = x / steps;
  let sum = 0;
  for (let i = 0; i <= steps; i++) {
    const xi = i * dx;
    const w = (i === 0 || i === steps) ? 0.5 : 1;
    sum += w * Math.exp((a - 1) * Math.log(xi + 1e-300) + (b - 1) * Math.log(1 - xi + 1e-300) - logBeta(a, b));
  }
  return sum * dx;
}

/**
 * Expected Information Gain (EIG) for observing n Bernoulli trials
 * with Beta(a, b) prior.
 *
 * EIG = H[prior] - E[H[posterior]]
 *     = H[Beta(a,b)] - Σ_{k=0}^{n} P(k|a,b) · H[Beta(a+k, b+n-k)]
 *
 * where P(k|a,b) = C(n,k) · B(a+k, b+n-k) / B(a,b)  (Beta-Binomial PMF)
 */
function expectedInfoGain(a, b, n) {
  const priorEntropy = betaEntropy(a, b);
  let expectedPosteriorEntropy = 0;

  for (let k = 0; k <= n; k++) {
    // Beta-Binomial PMF: P(k | n, a, b)
    const logP = logChoose(n, k) + logBeta(a + k, b + n - k) - logBeta(a, b);
    const p = Math.exp(logP);
    const postEntropy = betaEntropy(a + k, b + n - k);
    expectedPosteriorEntropy += p * postEntropy;
  }

  return priorEntropy - expectedPosteriorEntropy;
}

function logChoose(n, k) {
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

// ── Design space ─────────────────────────────────────────────────────

const MODELS = [
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', costPerCall: 0.015, family: 'claude' },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', costPerCall: 0.004, family: 'claude' },
  { id: 'gemini-lite-replication', name: 'Lite (replicate)', costPerCall: 0.001, family: 'gemini' },
];

// Languages ordered by hallucination severity (Study 3 posterior at NONE)
const LANGUAGES = [
  { id: 'Syriac', priorNone: 0.75, priorHigh: 0.0 },
  { id: 'Chinese', priorNone: 0.60, priorHigh: 0.0 },
  { id: 'Hebrew', priorNone: 0.50, priorHigh: 0.0 },
  { id: 'Japanese', priorNone: 0.40, priorHigh: 0.0 },
  { id: 'Armenian', priorNone: 0.20, priorHigh: 0.0 },
  { id: 'Greek', priorNone: 0.20, priorHigh: 0.0 },
  { id: 'Sanskrit', priorNone: 0.20, priorHigh: 0.0 },
  { id: 'Arabic', priorNone: 0.0, priorHigh: 0.0 },
  { id: 'Persian', priorNone: 0.0, priorHigh: 0.0 },
  { id: "Ge'ez", priorNone: 0.0, priorHigh: 0.0 },
];

const THINKING_LEVELS = ['NONE', 'HIGH'];

// ── Prior selection ──────────────────────────────────────────────────

/**
 * Get the prior for a (model, language, level) cell.
 *
 * Strategy:
 * - For Gemini Lite replication: use cell posterior from Study 3 (informative)
 * - For Claude models: use hierarchical prior (less informative, since
 *   Claude architecture is different — we don't know if it hallucinates)
 *
 * The key hypothesis: Claude may not hallucinate at all (different arch),
 * so we use a weaker prior that allows the data to dominate.
 */
function getPrior(modelFamily, language, level) {
  if (modelFamily === 'gemini') {
    // Strong prior from Study 3 data
    const key = `${language}:${level}`;
    const cell = cellPosteriors[key];
    if (cell) return { a: cell.posterior.a, b: cell.posterior.b, source: 'study3_posterior' };
  }

  // For Claude: use hierarchical prior (pooled across Gemini languages)
  // but shrink toward uniform to reflect architectural uncertainty
  const hp = hierPrior[level];
  if (!hp) return { a: 1, b: 1, source: 'uniform' };

  // Mix hierarchical prior with uniform: 50% Gemini prior + 50% uniform
  // This encodes: "Claude might behave like Gemini, or might be completely different"
  const mixA = 0.5 * hp.a + 0.5 * 1;
  const mixB = 0.5 * hp.b + 0.5 * 1;

  return { a: +mixA.toFixed(3), b: +mixB.toFixed(3), source: 'hierarchical_mixture' };
}

// ── Greedy optimal allocation ────────────────────────────────────────

function greedyOptimalDesign(budget) {
  console.log(`\n=== OPTIMAL EXPERIMENTAL DESIGN (Budget: $${budget.toFixed(2)}) ===\n`);

  // Build candidate set: all (model, language, level) combinations
  const candidates = [];
  for (const model of MODELS) {
    for (const lang of LANGUAGES) {
      for (const level of THINKING_LEVELS) {
        const prior = getPrior(model.family, lang.id, level);
        candidates.push({
          model: model.id,
          modelName: model.name,
          family: model.family,
          language: lang.id,
          level,
          costPerCall: model.costPerCall,
          prior,
          allocated: 0,
        });
      }
    }
  }

  // Greedy: iteratively allocate 1 run to the candidate with highest
  // marginal EIG per dollar
  let spent = 0;
  const allocation = new Map(candidates.map(c => [c, 0]));

  while (spent < budget) {
    let bestCandidate = null;
    let bestEigPerDollar = -Infinity;

    for (const c of candidates) {
      if (spent + c.costPerCall > budget) continue;

      const n = allocation.get(c);
      const maxPerCell = c.family === 'gemini' ? 10 : 20; // cap Gemini replication
      if (n >= maxPerCell) continue;

      // EIG of adding 1 more run (n+1 total vs n total)
      const eigCurrent = n > 0 ? expectedInfoGain(c.prior.a, c.prior.b, n) : 0;
      const eigNext = expectedInfoGain(c.prior.a, c.prior.b, n + 1);
      const marginalEig = eigNext - eigCurrent;
      const eigPerDollar = marginalEig / c.costPerCall;

      if (eigPerDollar > bestEigPerDollar) {
        bestEigPerDollar = eigPerDollar;
        bestCandidate = c;
      }
    }

    if (!bestCandidate || bestEigPerDollar <= 0) break;

    allocation.set(bestCandidate, allocation.get(bestCandidate) + 1);
    spent += bestCandidate.costPerCall;
  }

  // Print allocation
  console.log('--- OPTIMAL ALLOCATION ---\n');
  console.log(`${'Model'.padEnd(18)} ${'Language'.padEnd(12)} ${'Level'.padEnd(6)} ${'n'.padStart(3)} ${'Prior'.padStart(16)} ${'E[hall]'.padStart(8)} ${'EIG'.padStart(7)} ${'Cost'.padStart(7)}`);
  console.log('-'.repeat(82));

  const rows = [];
  for (const [c, n] of allocation) {
    if (n === 0) continue;
    const eig = expectedInfoGain(c.prior.a, c.prior.b, n);
    const mean = betaMean(c.prior.a, c.prior.b);
    rows.push({ ...c, n, eig, mean, cost: n * c.costPerCall });
  }

  // Sort by model, then EIG descending
  rows.sort((a, b) => a.model.localeCompare(b.model) || b.eig - a.eig);

  let totalEig = 0, totalCost = 0, totalCalls = 0;
  let currentModel = '';
  for (const r of rows) {
    if (r.model !== currentModel) {
      if (currentModel) console.log('');
      currentModel = r.model;
    }
    console.log(`${r.modelName.padEnd(18)} ${r.language.padEnd(12)} ${r.level.padEnd(6)} ${r.n.toString().padStart(3)} ${`Beta(${r.prior.a},${r.prior.b})`.padStart(16)} ${r.mean.toFixed(3).padStart(8)} ${r.eig.toFixed(3).padStart(7)} $${r.cost.toFixed(3).padStart(6)}`);
    totalEig += r.eig;
    totalCost += r.cost;
    totalCalls += r.n;
  }

  console.log('\n' + '-'.repeat(82));
  console.log(`${'TOTAL'.padEnd(18)} ${''.padEnd(12)} ${''.padEnd(6)} ${totalCalls.toString().padStart(3)} ${''.padStart(16)} ${''.padStart(8)} ${totalEig.toFixed(3).padStart(7)} $${totalCost.toFixed(3).padStart(6)}`);

  // Summary by model
  console.log('\n--- SUMMARY BY MODEL ---\n');
  const byModel = {};
  for (const r of rows) {
    if (!byModel[r.modelName]) byModel[r.modelName] = { calls: 0, cost: 0, eig: 0, langs: new Set() };
    byModel[r.modelName].calls += r.n;
    byModel[r.modelName].cost += r.cost;
    byModel[r.modelName].eig += r.eig;
    byModel[r.modelName].langs.add(r.language);
  }
  for (const [name, s] of Object.entries(byModel)) {
    console.log(`  ${name}: ${s.calls} calls, ${s.langs.size} languages, $${s.cost.toFixed(2)}, EIG=${s.eig.toFixed(3)} nats`);
  }

  // Key questions answered
  console.log('\n--- QUESTIONS THIS DESIGN ANSWERS ---\n');
  console.log('1. Does Claude hallucinate on non-Latin OCR without thinking?');
  console.log('   → Test NONE level on hardest languages (Syriac, Chinese, Hebrew)');
  console.log('2. Is hallucination architecture-dependent (Gemini-specific) or universal?');
  console.log('   → Compare Claude NONE vs Gemini Lite NONE posteriors');
  console.log('3. Does Claude need thinking mode at all?');
  console.log('   → If Claude NONE shows 0% hallucination, thinking is unnecessary');
  console.log('4. Is the effect consistent across model sizes?');
  console.log('   → Sonnet vs Haiku comparison at same conditions');
  console.log('5. Does Gemini Lite hallucination replicate? (stochasticity check)');
  console.log('   → Lite replication runs on highest-uncertainty cells');

  // Bayesian stopping rules
  console.log('\n--- SEQUENTIAL STOPPING RULES ---\n');
  console.log('Run in batches. After each batch, update posteriors and check:');
  console.log('');
  console.log('  STOP if: P(hall_rate < 0.05 | data) > 0.95 for a cell');
  console.log('           → Confident the model does not hallucinate here');
  console.log('');
  console.log('  STOP if: P(hall_rate > 0.20 | data) > 0.95 for a cell');
  console.log('           → Confident the model hallucinates frequently');
  console.log('');
  console.log('  CONTINUE if: 95% CI width > 0.30');
  console.log('               → Still too uncertain, need more data');
  console.log('');
  console.log('  REALLOCATE if: one model clearly doesn\'t hallucinate');
  console.log('                 → Shift budget to other model or new languages');

  return { rows, totalEig, totalCost, totalCalls };
}

// ── Sensitivity analysis ─────────────────────────────────────────────

function sensitivityAnalysis() {
  console.log('\n=== SENSITIVITY ANALYSIS ===\n');
  console.log('How does the design change with different budgets?\n');

  console.log(`${'Budget'.padStart(8)} ${'Calls'.padStart(6)} ${'Models'.padStart(8)} ${'Languages'.padStart(10)} ${'Total EIG'.padStart(10)}`);
  console.log('-'.repeat(46));

  for (const budget of [1, 2, 3, 5, 10, 20]) {
    // Quick greedy allocation (suppress output)
    const candidates = [];
    for (const model of MODELS) {
      for (const lang of LANGUAGES) {
        for (const level of THINKING_LEVELS) {
          candidates.push({
            family: model.family, costPerCall: model.costPerCall,
            prior: getPrior(model.family, lang.id, level),
            modelName: model.name, language: lang.id,
          });
        }
      }
    }

    const alloc = new Map(candidates.map(c => [c, 0]));
    let spent = 0;
    while (spent < budget) {
      let best = null, bestV = -Infinity;
      for (const c of candidates) {
        if (spent + c.costPerCall > budget) continue;
        const n = alloc.get(c);
        const cap = c.family === 'gemini' ? 10 : 20;
        if (n >= cap) continue;
        const eigN = n > 0 ? expectedInfoGain(c.prior.a, c.prior.b, n) : 0;
        const eigN1 = expectedInfoGain(c.prior.a, c.prior.b, n + 1);
        const v = (eigN1 - eigN) / c.costPerCall;
        if (v > bestV) { bestV = v; best = c; }
      }
      if (!best || bestV <= 0) break;
      alloc.set(best, alloc.get(best) + 1);
      spent += best.costPerCall;
    }

    let calls = 0, eig = 0;
    const models = new Set(), langs = new Set();
    for (const [c, n] of alloc) {
      if (n === 0) continue;
      calls += n;
      eig += expectedInfoGain(c.prior.a, c.prior.b, n);
      models.add(c.modelName);
      langs.add(c.language);
    }

    console.log(`$${budget.toString().padStart(7)} ${calls.toString().padStart(6)} ${models.size.toString().padStart(8)} ${langs.size.toString().padStart(10)} ${eig.toFixed(3).padStart(10)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

const budget = parseFloat(process.argv.find(a => a.startsWith('--budget='))?.split('=')[1] || '5');

const design = greedyOptimalDesign(budget);
sensitivityAnalysis();

// Save design
const designPath = path.join(__dirname, 'results', 'optimal-design.json');
fs.writeFileSync(designPath, JSON.stringify({
  budget,
  allocation: design.rows.map(({ prior, ...r }) => ({ ...r, prior_a: prior.a, prior_b: prior.b })),
  total: { calls: design.totalCalls, cost: design.totalCost, eig: design.totalEig },
  stopping_rules: {
    stop_no_hall: 'P(rate < 0.05 | data) > 0.95',
    stop_hall: 'P(rate > 0.20 | data) > 0.95',
    continue: '95% CI width > 0.30',
  },
  meta: { date: new Date().toISOString(), criterion: 'D-optimal (max EIG per dollar)' },
}, null, 2));
console.log(`\nDesign saved: ${designPath}`);
