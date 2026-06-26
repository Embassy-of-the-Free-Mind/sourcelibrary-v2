#!/usr/bin/env node
/**
 * Score the human gold-standard labels for the n≈250 gap validation (#2684).
 *
 * Treats the human verdict as ground truth and measures, for each AI instrument
 * (Claude, Gemini, and their consensus), sensitivity (P(AI=translated | human=translated))
 * and specificity (P(AI=untranslated | human=untranslated)) on the binary
 * "a complete prior English translation exists". Also the override rate and the
 * cited-record-opened rate (a rubber-stamp guard). Writes the sens/spec the main
 * scorer consumes for the Rogan–Gladen correction.
 *
 * Input: eval-data/gap-validation-gold-subset.json + a labels file exported from
 *        the review HTML (default eval-data/gap-validation-gold-labels.json).
 * Writes: eval-data/gap-validation-human-sens-spec.json
 *
 * Usage: node scripts/analysis/gap-validation-gold-score.mjs [labels.json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dir, 'eval-data');
const subset = JSON.parse(fs.readFileSync(path.join(EVAL, 'gap-validation-gold-subset.json'), 'utf8')).works;
const labelsPath = process.argv[2] || path.join(EVAL, 'gap-validation-gold-labels.json');
if (!fs.existsSync(labelsPath)) { console.error(`labels not found: ${labelsPath}\nLabel via the review HTML and export first.`); process.exit(1); }
const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));

const toBin = (v, rel) => { if (rel === 'container') return null; if (v === 'translated') return true; if (v === 'untranslated') return false; return null; };
const humanBin = (v) => v === 'translated' ? true : v === 'untranslated' ? false : null;

function senspec(pairs) { // [[ai,human]]
  let tp = 0, fn = 0, tn = 0, fp = 0;
  for (const [ai, h] of pairs) {
    if (ai == null || h == null) continue;
    if (h === true) { if (ai === true) tp++; else fn++; }
    else { if (ai === false) tn++; else fp++; }
  }
  const sens = tp + fn ? tp / (tp + fn) : null;
  const spec = tn + fp ? tn / (tn + fp) : null;
  return { sens: sens == null ? null : +sens.toFixed(4), spec: spec == null ? null : +spec.toFixed(4), tp, fn, tn, fp };
}

const rows = subset.map((w) => {
  const L = labels[w.key] || {};
  return {
    key: w.key,
    human: humanBin(L.verdict),
    opened: !!L.opened_record,
    claude: toBin(w.claude.verdict, w.claude.relationship),
    gemini: toBin(w.gemini.verdict, w.gemini.relationship),
  };
});
for (const r of rows) r.consensus = r.claude != null && r.gemini != null && r.claude === r.gemini ? r.claude : (r.claude ?? r.gemini ?? null);

const labeled = rows.filter((r) => r.human != null);
const out = {
  generated: new Date().toISOString().slice(0, 10),
  n_subset: subset.length,
  n_labeled: labeled.length,
  cited_record_opened_rate: +(labeled.filter((r) => r.opened).length / (labeled.length || 1)).toFixed(3),
  claude: senspec(labeled.map((r) => [r.claude, r.human])),
  gemini: senspec(labeled.map((r) => [r.gemini, r.human])),
  consensus: senspec(labeled.map((r) => [r.consensus, r.human])),
  override_rate_vs_consensus: +(labeled.filter((r) => r.consensus != null && r.consensus !== r.human).length / (labeled.filter((r) => r.consensus != null).length || 1)).toFixed(3),
};
fs.writeFileSync(path.join(EVAL, 'gap-validation-human-sens-spec.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log('\nwrote gap-validation-human-sens-spec.json → re-run gap-validation-score.mjs / -estimate.mjs to apply Rogan–Gladen');
