#!/usr/bin/env node
/**
 * Score a directory of hand/agent transcriptions of the pinned ground-truth
 * pages against the published references — same two-stage scoring as the
 * scorecard's stored-OCR column. Used 2026-07-19 to score Claude Fable 5
 * interactive transcriptions (vision via session, not API).
 *
 *   node scripts/eval/score-transcripts.mjs --dir=/path/to/transcripts
 * Transcript filenames must match ground-truth basenames (<slug>.txt).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreAgainstReference } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dirArg = process.argv.find(a => a.startsWith('--dir='))?.slice(6);
if (!dirArg) { console.error('--dir=<transcripts dir> required'); process.exit(1); }
const gtDir = path.join(__dirname, 'ground-truth');

let totalRef = 0, totalMatched = 0;
for (const f of fs.readdirSync(gtDir).filter(f => f.endsWith('.json')).sort()) {
  const gt = JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8'));
  if (!gt.ocr_ground_truth) continue;
  const tf = path.join(dirArg, f.replace('.json', '.txt'));
  if (!fs.existsSync(tf)) { console.log(`  -  ${gt.work}: no transcript`); continue; }
  const r = scoreAgainstReference(gt.ocr_ground_truth, fs.readFileSync(tf, 'utf8'), gt.script || 'cjk');
  if (r.aligned) { totalRef += r.refLen; totalMatched += r.matched; }
  console.log(`  ${r.aligned ? 'OK ' : 'XX '} ${gt.work.padEnd(28)} guard=${(r.guard.value * 100).toFixed(0).padStart(3)}%  CER=${(r.cer * 100).toFixed(1).padStart(5)}%  acc=${((1 - r.cer) * 100).toFixed(1).padStart(5)}%  (ref ${r.refLen})`);
}
console.log(`\n  Char-weighted accuracy (aligned): ${totalRef ? ((totalMatched / totalRef) * 100).toFixed(2) : 'n/a'}%`);
