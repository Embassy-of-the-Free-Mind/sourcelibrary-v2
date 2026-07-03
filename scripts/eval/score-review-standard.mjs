#!/usr/bin/env node
/**
 * score-review-standard.mjs — aggregate a REVIEW/AUDIT export from ft-review-annotator.html.
 *
 * Reports:
 *  1. Audit outcome — agree / override / can't-tell rates, and the checked-record rate
 *     (did the human actually open the cited record before agreeing?).
 *  2. AI accuracy as judged by the human reviewer (override = AI was wrong).
 *  3. Human-corrected stratified first-rate (using the effective human_verdict), with Wilson CI.
 *  4. ANCHORING TAX — on the blind-calibration subset, AI-vs-independent-human agreement,
 *     contrasted with the review-mode agree-rate, to estimate how much seeing the AI inflates
 *     agreement. (Keeps the de-circularisation claim honest.)
 *
 * USAGE: node scripts/eval/score-review-standard.mjs ft-review-<name>.json [second.json ...]
 */
import fs from 'fs';
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!args.length) { console.error('usage: score-review-standard.mjs <ft-review-*.json> [...]'); process.exit(1); }
const load = p => JSON.parse(fs.readFileSync(p.includes('/') ? p : `scripts/output/${p}`, 'utf8'));

const FIRST = new Set(['first_no_prior', 'first_from_source', 'first_complete', 'first_modern']);
const coarse = v => !v ? null : FIRST.has(v) ? 'FIRST' : v === 'not_first' ? 'NOT_FIRST' : v === 'not_applicable' ? 'NA' : v === 'unverifiable' ? 'UNVERIF' : null;
function wilson(k, n) { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }

for (const f of args) {
  const X = load(f);
  const rows = X.reviews || [];
  const reviewMode = rows.filter(r => !r.blind);
  const blindMode = rows.filter(r => r.blind);
  console.log(`\n=== ${f} — reviewer ${X.reviewer || '?'} · ${rows.length} items (${reviewMode.length} review, ${blindMode.length} blind) ===`);

  // 1. audit outcome
  const done = reviewMode.filter(r => r.review);
  const agree = done.filter(r => r.review === 'agree').length;
  const override = done.filter(r => r.review === 'override').length;
  const uncertain = done.filter(r => r.review === 'uncertain').length;
  const checked = done.filter(r => r.checked_record).length;
  console.log(`Audit: agree ${agree} · override ${override} · can't-tell ${uncertain}  (of ${done.length} reviewed)`);
  if (done.length) console.log(`  AI accuracy as judged = ${Math.round(100 * agree / Math.max(1, agree + override))}% (agree / (agree+override))`);
  if (done.length) console.log(`  Cited-record opened before deciding: ${checked}/${done.length} (${Math.round(100 * checked / done.length)}%) — low = rubber-stamping risk`);
  // overrides detail
  for (const r of done.filter(r => r.review === 'override')) console.log(`    override: ${coarse(r.ai_verdict)}→${coarse(r.human_verdict)||'?'}  ${(r.t||'').slice(0, 42)}`);

  // 2+3. human-corrected stratified first-rate (effective human_verdict across all committed rows)
  const labelled = rows.filter(r => r.human_verdict);
  const byS = {}; for (const r of labelled) (byS[r.stratum] = byS[r.stratum] || []).push(r);
  let nFirst = 0, nDenom = 0;
  console.log('Human-corrected first-rate by stratum:');
  for (const [s, arr] of Object.entries(byS)) {
    const fr = arr.filter(r => coarse(r.human_verdict) === 'FIRST').length;
    const unv = arr.filter(r => coarse(r.human_verdict) === 'UNVERIF').length;
    nFirst += fr; nDenom += (arr.length - unv);
    console.log(`  ${s.padEnd(14)} first ${fr}/${arr.length}  (unverif ${unv})`);
  }
  if (nDenom) { const [lo, hi] = wilson(nFirst, nDenom); console.log(`  Overall human-corrected FIRST-rate: ${Math.round(100 * nFirst / nDenom)}% (95% Wilson ${Math.round(100*lo)}-${Math.round(100*hi)}%, n=${nDenom})`); }

  // 4. anchoring tax
  const bl = blindMode.filter(r => r.blind_verdict);
  if (bl.length) {
    const blAgree = bl.filter(r => coarse(r.blind_verdict) === coarse(r.ai_verdict)).length;
    console.log(`Anchoring check (blind n=${bl.length}): independent human agreed with AI (coarse) ${blAgree}/${bl.length} = ${Math.round(100*blAgree/bl.length)}%`);
    if (done.length) console.log(`  vs review-mode agree-rate ${Math.round(100*agree/Math.max(1,agree+override))}% → gap ≈ anchoring tax (positive = seeing AI inflates agreement)`);
  } else {
    console.log('Anchoring check: no blind verdicts yet.');
  }
}
