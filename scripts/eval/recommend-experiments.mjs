#!/usr/bin/env node
/**
 * Experiment recommender (#3235): turn OBSERVATIONAL signals into a prioritized
 * queue of PAID experimental runs, each with a hypothesis, a design, and a cost
 * estimate. The loop: cheap observational data (revision-pair agreement, pinned
 * page covariates, sweep outcomes) surfaces factor hypotheses → this script
 * says which targeted paid runs would test them → results feed back in.
 *
 * Reads: ground-truth JSONs, latest observations JSONL, latest
 *        revision-agreement-pilot results (optional), and the latest
 *        dataset version's pages.jsonl (for measured resolution)
 * Emits: ranked experiment list with $ estimates (nothing is run).
 *
 *   node scripts/eval/recommend-experiments.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { estimateCost, resolveModel } from './lib/runners.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const latest = (dir, prefix) => {
  const fsd = fs.readdirSync(dir).filter(f => f.startsWith(prefix)).sort();
  return fsd.length ? path.join(dir, fsd[fsd.length - 1]) : null;
};

const gts = fs.readdirSync(path.join(__dirname, 'ground-truth')).filter(f => f.endsWith('.json'))
  .map(f => ({ slug: f.replace('.json', ''), ...JSON.parse(fs.readFileSync(path.join(__dirname, 'ground-truth', f), 'utf8')) }))
  .filter(g => g.ocr_ground_truth);
const obsFile = latest(path.join(__dirname, 'observations'), 'ocr-observations-');
const obs = obsFile ? fs.readFileSync(obsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.slug) : [];
const pilotFile = latest(path.join(__dirname, 'results'), 'revision-agreement-pilot-');
const pilot = pilotFile ? JSON.parse(fs.readFileSync(pilotFile, 'utf8')) : null;
const datasetDirs = fs.existsSync(path.join(__dirname, 'dataset')) ? fs.readdirSync(path.join(__dirname, 'dataset')).sort() : [];
const pagesFile = datasetDirs.length ? path.join(__dirname, 'dataset', datasetDirs[datasetDirs.length - 1], 'pages.jsonl') : null;
const dsPages = pagesFile && fs.existsSync(pagesFile) ? fs.readFileSync(pagesFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

const SWEEP_MODELS = ['pro', 'flash', 'lite', 'sonnet5'].map(resolveModel);
const costFor = (models, pages, runs = 3) =>
  models.reduce((s, m) => s + estimateCost(m, runs, pages).estimatedUsd, 0);
const fmt = usd => '$' + usd.toFixed(2);

const recs = [];

// 1. Model × canonicity holes — a model scored on canonical rows only cannot
// contribute to the memorization gap (the paper's core quantity).
const modelsSeen = new Map();
for (const r of obs.filter(r => r.source === 'api')) {
  const key = r.model;
  if (!modelsSeen.has(key)) modelsSeen.set(key, { canon: 0, noncanon: 0 });
  modelsSeen.get(key)[r.page_class?.canonical_text === false ? 'noncanon' : 'canon']++;
}
const nonCanonPages = gts.filter(g => g.page_class?.canonical_text === false).length;
for (const [model, c] of modelsSeen) {
  if (c.canon > 0 && c.noncanon === 0) {
    recs.push({
      priority: 1, tag: 'gap-hole',
      hypothesis: `${model}'s memorization subsidy is unmeasured (canonical-only runs → its gap cell is empty).`,
      design: `Sweep the ${nonCanonPages} non-canonical pages with ${model} ×3 runs.`,
      cost: costFor([model], nonCanonPages),
    });
  }
}

// 2. Truncation × density interaction — models that truncate on dense pages.
const truncByModel = new Map();
for (const r of obs.filter(r => r.source === 'api' && r.finish_reason === 'MAX_TOKENS')) {
  truncByModel.set(r.model, (truncByModel.get(r.model) || 0) + 1);
}
for (const [model, n] of truncByModel) {
  if (n >= 3) {
    const densePages = gts.filter(g => g.page_class?.density === 'dense').length;
    recs.push({
      priority: 2, tag: 'truncation',
      hypothesis: `${model} truncates (${n} MAX_TOKENS runs) — is unconditional accuracy recoverable with a larger output budget, or is deliberation unbounded?`,
      design: `Re-run the ${densePages} dense pages with ${model} at 2× maxTokens, ×3 runs; compare truncation + unconditional accuracy.`,
      cost: costFor([model], densePages) * 2, // rough: longer outputs ≈ up to 2× output cost
    });
  }
}

// 3. Resolution ablation — measured MP varies 27×; the cheapest manipulable factor.
if (dsPages.length) {
  const mps = dsPages.filter(p => p.image?.megapixels).map(p => p.image.megapixels).sort((a, b) => a - b);
  if (mps.length && mps[mps.length - 1] / mps[0] > 4) {
    const target = Math.min(6, dsPages.length);
    recs.push({
      priority: 1, tag: 'resolution',
      hypothesis: `Resolution spans ${mps[0]}–${mps[mps.length - 1]} MP (${(mps[mps.length - 1] / mps[0]).toFixed(0)}×) and confounds language-level gaps (e.g. Hebrew). Accuracy-vs-resolution curve shape is unknown; interaction with type_size expected (small type dies first).`,
      design: `Pick ${target} pages spanning type_size cells; fetch each at 4 widths (native, 2000px, 1000px, 600px); sweep 4 models ×2 runs per width.`,
      cost: costFor(SWEEP_MODELS, target * 4, 2),
    });
  }
}

// 4. Prompt ablation — unclaimed in the literature (dossier-verified).
recs.push({
  priority: 2, tag: 'prompt',
  hypothesis: 'Annotated-output prompts (production pipeline contract) neither help nor hurt character accuracy vs bare transcription — currently suggestive and uncontrolled; no published study exists.',
  design: `All ${gts.length} pinned pages × {bare, production-annotated} prompts × flash+lite ×3 runs.`,
  cost: costFor(['flash', 'lite'].map(resolveModel), gts.length * 2),
});

// 5. Pilot-driven: languages with weak/absent anchors where corpus agreement is
// informative — calibration transfer needs per-script anchors.
if (pilot) {
  const anchoredScripts = new Set(gts.map(g => g.language));
  const langStats = new Map();
  for (const c of pilot.corpus || []) {
    if (!c.language) continue;
    if (!langStats.has(c.language)) langStats.set(c.language, []);
    langStats.get(c.language).push(c.agreement);
  }
  for (const [lang, xs] of langStats) {
    if (xs.length < 100 || anchoredScripts.has(lang)) continue;
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    recs.push({
      priority: mean < 0.85 ? 1 : 3, tag: 'anchor-gap',
      hypothesis: `${lang}: ${xs.length} revision pairs, mean agreement ${(mean * 100).toFixed(1)}% — ${mean < 0.85 ? 'LOW; real accuracy unknown' : 'high but uncalibrated'}; no reference anchors exist to calibrate agreement→accuracy for this language.`,
      design: `Pin 2-3 non-canonical reference pages for ${lang} (page-aligned etext if available — DTA for German, etc.), then sweep them (4 models ×3).`,
      cost: costFor(SWEEP_MODELS, 3),
    });
  }
  // 6. Regression candidates → operational verification run
  const nReg = pilot.corpus_summary?.regressions ?? 0;
  if (nReg > 0) {
    recs.push({
      priority: 2, tag: 'regression-verify',
      hypothesis: `${nReg}/${pilot.corpus_summary.usable} sampled revision pairs look like re-OCR REGRESSIONS (agreement<0.5, current much shorter). Scaled to 126K revisions that projects to ~${Math.round(nReg / pilot.corpus_summary.usable * 126551)} damaged pages.`,
      design: 'Free first: visually audit 20 candidates. If confirmed, re-OCR the projected population with flash (1 run) — cost scales with confirmed rate.',
      cost: costFor([resolveModel('flash')], Math.round(nReg / Math.max(1, pilot.corpus_summary.usable) * 126551), 1),
    });
  }
}

recs.sort((a, b) => a.priority - b.priority || a.cost - b.cost);
console.log('\n=== Recommended paid experiments (observational signal → hypothesis → targeted run) ===\n');
for (const r of recs) {
  console.log(`[P${r.priority}] ${r.tag.toUpperCase()}  est ${fmt(r.cost)}`);
  console.log(`     hypothesis: ${r.hypothesis}`);
  console.log(`     design:     ${r.design}\n`);
}
const p1 = recs.filter(r => r.priority === 1).reduce((s, r) => s + r.cost, 0);
console.log(`Priority-1 total: ${fmt(p1)}   All: ${fmt(recs.reduce((s, r) => s + r.cost, 0))}`);
console.log('(Estimates via lib/runners estimateCost; nothing was run.)');
