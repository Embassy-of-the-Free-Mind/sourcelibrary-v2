/**
 * Turn bulk Tier-2 verdicts into the corpus estimate (issue #2564).
 *
 * Input: the workflow result's `verdicts` array (compact adjudicator output),
 * saved to a JSON file. Joins each verdict to its stratum (via the worklist),
 * computes per-stratum FALSE-FIRST rate + Wilson CI, scales each stratum's
 * population to a corrected first count, and reports the corpus estimate
 * "N ± M" using the inference module.
 *
 * FALSE-FIRST = a sampled (currently-badged) book whose Tier-2 verdict is NOT a
 * genuine first: not_first / not_applicable / unverifiable. needs_review is
 * counted separately (ambiguous — neither confirmed first nor confirmed false).
 *
 * Usage:
 *   npx tsx scripts/eval/ft-tier2-report.ts <verdicts.json> [--manifest=scripts/eval/results/ft-sample-manifest.json]
 */
import { readFileSync } from 'fs';
import { estimateCorpus, type StratumSample } from '@/lib/first-translation/inference';
import { FIRST_FAMILY, type FirstTranslationVerdict } from '@/lib/first-translation/types';

const vfile = process.argv[2];
const manifestPath = process.argv.find((a) => a.startsWith('--manifest='))?.split('=')[1]
  || 'scripts/eval/results/ft-sample-manifest.json';
if (!vfile) { console.error('usage: ft-tier2-report.ts <verdicts.json>'); process.exit(1); }

interface Verdict { book_id: string; verdict: FirstTranslationVerdict; evidence_strength?: string; confidence?: string }

// Accept either the raw workflow result ({verdicts:[...]}) or a bare array.
const raw = JSON.parse(readFileSync(vfile, 'utf8'));
const verdicts: Verdict[] = Array.isArray(raw) ? raw : raw.verdicts;

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
// book_id -> stratum, and stratum -> population size N
const stratumOf = new Map<string, string>();
const sizeOf = new Map<string, number>();
for (const s of manifest.manifest) {
  sizeOf.set(s.stratum, s.size);
  for (const b of s.sampled) stratumOf.set(b.id, s.stratum);
}

const isFalseFirst = (v: FirstTranslationVerdict) =>
  v === 'not_first' || v === 'not_applicable' || v === 'unverifiable';

// Aggregate per stratum.
const agg = new Map<string, { sampled: number; falseFirsts: number; needsReview: number }>();
let unmatched = 0;
for (const v of verdicts) {
  const stratum = stratumOf.get(v.book_id);
  if (!stratum) { unmatched++; continue; }
  if (!agg.has(stratum)) agg.set(stratum, { sampled: 0, falseFirsts: 0, needsReview: 0 });
  const a = agg.get(stratum)!;
  a.sampled++;
  if (isFalseFirst(v.verdict)) a.falseFirsts++;
  else if (v.verdict === 'needs_review') a.needsReview++;
}

const samples: StratumSample[] = [];
for (const [stratum, size] of sizeOf.entries()) {
  const a = agg.get(stratum) || { sampled: 0, falseFirsts: 0, needsReview: 0 };
  samples.push({ key: stratum, size, sampled: a.sampled, falseFirsts: a.falseFirsts });
}

const est = estimateCorpus(samples);

console.log('\n=== Tier-2 corpus estimate (#2564) ===');
console.log(`verdicts ingested: ${verdicts.length}${unmatched ? ` (${unmatched} unmatched to a stratum)` : ''}`);
console.log('\nPer-stratum (N · sampled · false-first · rate · 95% CI):');
for (const s of est.strata.sort((a, b) => b.size - a.size)) {
  if (s.sampled === 0) { console.log(`  ${s.key.padEnd(42)} N=${String(s.size).padStart(4)}  (unsampled)`); continue; }
  const ci = `[${(s.falseRateCI[0] * 100).toFixed(0)}–${(s.falseRateCI[1] * 100).toFixed(0)}%]`;
  console.log(`  ${s.key.padEnd(42)} N=${String(s.size).padStart(4)}  n=${String(s.sampled).padStart(3)}  ff=${String(s.falseFirsts).padStart(3)}  p̂=${(s.falseRate * 100).toFixed(0).padStart(3)}%  ${ci}`);
}

console.log(`\nRaw public-first total (sampled strata): ${est.rawTotal}`);
console.log(`Estimated GENUINE first translations: ${Math.round(est.estimatedFirsts)} ± ${Math.round(est.ciHalfWidth)}`);
console.log(`  95% interval: [${Math.round(est.ci[0])}, ${Math.round(est.ci[1])}]`);

// Verdict distribution overall
const dist: Record<string, number> = {};
for (const v of verdicts) dist[v.verdict] = (dist[v.verdict] || 0) + 1;
console.log('\nVerdict distribution:', JSON.stringify(dist));
const falseFirstBooks = verdicts.filter((v) => isFalseFirst(v.verdict));
console.log(`\nFALSE-FIRSTS found in sample (badge currently wrong): ${falseFirstBooks.length}`);
for (const v of falseFirstBooks.slice(0, 40)) console.log(`  ${v.book_id}  ${v.verdict}  (${v.confidence || '?'})`);
