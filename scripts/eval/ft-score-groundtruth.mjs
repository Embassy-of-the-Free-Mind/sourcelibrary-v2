#!/usr/bin/env node
/**
 * Score Gemini adjudications against the 33-case ground-truth set (#2564).
 *
 * The ground truth carries two independent signals per case:
 *  - tool_is_first   (the 3-catalog cron's call)
 *  - external_verdict (an independent 5-API check: translation_likely / none)
 * Neither is a gold human label, so we report agreement with BOTH and surface
 * every disagreement with Gemini's reasoning for inspection (Gemini + grounding
 * is often more right than the deterministic ground truth).
 *
 * Usage: node scripts/eval/ft-score-groundtruth.mjs scripts/eval/results/ft-gemini-groundtruth.json
 */
import { readFileSync } from 'fs';
const gem = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const gt = JSON.parse(readFileSync('scripts/eval/ft-ground-truth.json', 'utf8')).cases;

const FAM = new Set(['first_no_prior', 'first_complete', 'first_from_source', 'first_modern']);
const gmap = new Map(gem.map((r) => [r.book_id, r]));

let nTool = 0, agreeTool = 0, nExt = 0, agreeExt = 0, missing = 0;
const disagreements = [];
for (const c of gt) {
  const r = gmap.get(c.book_id);
  if (!r || !r.verdict) { missing++; continue; }
  const gemIsFirst = FAM.has(r.verdict);          // Gemini says first?
  const gemPrior = r.prior_found === true || r.verdict === 'not_first';

  // vs the cron's tool_is_first (only meaningful when the verdict is first/not-first)
  if (r.verdict === 'not_applicable' || r.verdict === 'needs_review' || r.verdict === 'unverifiable') {
    // skip from the binary agreement; note separately
  } else {
    nTool++;
    if (gemIsFirst === !!c.tool_is_first) agreeTool++;
    else disagreements.push(`  [tool] ${c.language} "${(c.title||'').slice(0,40)}": cron is_first=${c.tool_is_first} | gemini=${r.verdict} — ${(r.reason||'').slice(0,90)}`);
  }

  // vs the independent external API check
  const extPrior = c.external_verdict === 'translation_likely';
  nExt++;
  if (gemPrior === extPrior) agreeExt++;
}

const pct = (a, n) => n ? (a / n * 100).toFixed(0) + '%' : 'n/a';
console.log(`\n=== Gemini vs ground truth (n=${gt.length}, adjudicated=${gt.length - missing}) ===`);
console.log(`Agreement with cron tool_is_first:   ${agreeTool}/${nTool} = ${pct(agreeTool, nTool)}`);
console.log(`Agreement with independent API check: ${agreeExt}/${nExt} = ${pct(agreeExt, nExt)}`);
const tally = {}; for (const r of gem) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
console.log('Gemini verdict mix:', JSON.stringify(tally));
console.log('\nDisagreements with the cron (inspect — Gemini may be more right):');
disagreements.forEach((d) => console.log(d));
