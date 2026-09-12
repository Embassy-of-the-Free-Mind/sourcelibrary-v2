#!/usr/bin/env node
/**
 * Score a directory of transcriptions of the pinned ground-truth pages against
 * the published references — same two-stage scoring as the scorecard's
 * stored-OCR column. Used 2026-07-19 to score Claude Fable 5 interactive
 * transcriptions (vision via session, not API); extended for Bench 2 to score
 * self-hosted engine outputs (CHURRO/Surya/Kraken/BDRC) produced against a
 * bench2-export.mjs image set.
 *
 *   node scripts/eval/score-transcripts.mjs --dir=/path/to/transcripts \
 *       [--engine=kraken-catmus] [--run=1] [--only=regex]
 *
 * Transcript filenames must match ground-truth basenames (<slug>.txt).
 * With --engine, every transcript is ALSO appended as a raw-output row
 * ({work, model, run, finishReason, text}) to results/scorecard-outputs-<date>.jsonl
 * — the same dataset the Gemini scorecard arms write — so report-arms.mjs and
 * stats-cross-model.mjs compare engines against model arms with no extra glue.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreAgainstReference } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (name) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dirArg = argOf('dir');
const engine = argOf('engine');
const runIndex = parseInt(argOf('run') || '1', 10);
const only = argOf('only') ? new RegExp(argOf('only')) : null;
if (!dirArg) { console.error('--dir=<transcripts dir> required'); process.exit(1); }
// --gt-dir selects the reference tier: `ground-truth` (pinned, diplomatic, books we
// hold) or `ground-truth-ws` (Wikisource harvest, images from Commons). They are kept
// in separate directories on purpose — pooling a modernised reference with a
// glyph-diplomatic one silently inflates CER — so the tier is an explicit choice.
const gtDir = path.join(__dirname, argOf('gt-dir') || 'ground-truth');

const jsonlPath = engine
  ? path.join(__dirname, 'results', `scorecard-outputs-${new Date().toISOString().slice(0, 10)}.jsonl`)
  : null;

let totalRef = 0, totalMatched = 0;
for (const f of fs.readdirSync(gtDir).filter(f => f.endsWith('.json')).sort()) {
  if (only && !only.test(f)) continue;
  const gt = JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8'));
  if (!gt.ocr_ground_truth) continue;
  const tf = path.join(dirArg, f.replace('.json', '.txt'));
  if (!fs.existsSync(tf)) { console.log(`  -  ${gt.work}: no transcript`); continue; }
  const text = fs.readFileSync(tf, 'utf8');
  const r = scoreAgainstReference(gt.ocr_ground_truth, text, gt.script || 'cjk');
  if (r.aligned) { totalRef += r.refLen; totalMatched += r.matched; }
  if (jsonlPath) {
    fs.appendFileSync(jsonlPath, JSON.stringify({
      work: gt.work, model: engine, run: runIndex, finishReason: 'STOP', text,
    }) + '\n');
  }
  console.log(`  ${r.aligned ? 'OK ' : 'XX '} ${gt.work.padEnd(28)} guard=${(r.guard.value * 100).toFixed(0).padStart(3)}%  CER=${(r.cer * 100).toFixed(1).padStart(5)}%  acc=${((1 - r.cer) * 100).toFixed(1).padStart(5)}%  (ref ${r.refLen})`);
}
console.log(`\n  Char-weighted accuracy (aligned): ${totalRef ? ((totalMatched / totalRef) * 100).toFixed(2) : 'n/a'}%`);
if (jsonlPath) console.log(`  Raw outputs appended to ${jsonlPath} as model="${engine}" run=${runIndex}`);
