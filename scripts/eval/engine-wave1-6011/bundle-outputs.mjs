#!/usr/bin/env node
// PRIOR ART: results/latin-period-5126/outputs-<engine>.jsonl + meter-<engine>.jsonl (#5126) — the same
// one-file-per-engine bundle, so a 385-page arm is two files in the PR (GitHub's 300-file diff limit) and
// build-bench.mjs-style unpacking restores <bench>/<stratum>/out/<engine>/<slug>.txt byte for byte.
/**
 * bundle-outputs.mjs — pack (or --unpack) one arm's outputs and meter for the #6011 wave-1 store.
 *   node scripts/eval/engine-wave1-6011/bundle-outputs.mjs --engine=<name> [--bench=/root/engine-wave1-6011/bench]
 *   node scripts/eval/engine-wave1-6011/bundle-outputs.mjs --engine=<name> --unpack
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, '..', 'results', 'engine-wave1-6011');
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ENGINE = argOf('engine');
const BENCH = argOf('bench', '/root/engine-wave1-6011/bench');
if (!ENGINE) { console.error('--engine required'); process.exit(1); }
const outF = path.join(RES, `outputs-${ENGINE}.jsonl`), meterF = path.join(RES, `meter-${ENGINE}.jsonl`);

if (process.argv.includes('--unpack')) {
  let n = 0;
  for (const r of fs.readFileSync(outF, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))) {
    const d = path.join(BENCH, r.stratum, 'out', ENGINE); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${r.slug}.txt`), r.text); n++;
  }
  const meters = fs.existsSync(meterF) ? fs.readFileSync(meterF, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  for (const st of new Set(meters.map(m => m.stratum))) fs.writeFileSync(path.join(BENCH, st, 'out', ENGINE, '_meter.jsonl'), meters.filter(m => m.stratum === st).map(m => JSON.stringify(m)).join('\n') + '\n');
  console.log(`unpacked ${n} outputs of ${ENGINE}`);
} else {
  fs.mkdirSync(RES, { recursive: true });
  const outs = [], meters = [];
  for (const st of fs.readdirSync(BENCH).sort()) {
    const d = path.join(BENCH, st, 'out', ENGINE);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter(f => f.endsWith('.txt')).sort()) outs.push({ stratum: st, slug: f.slice(0, -4), engine: ENGINE, text: fs.readFileSync(path.join(d, f), 'utf8') });
    const m = path.join(d, '_meter.jsonl');
    if (fs.existsSync(m)) for (const l of fs.readFileSync(m, 'utf8').split('\n').filter(Boolean)) meters.push({ stratum: st, ...JSON.parse(l) });
  }
  fs.writeFileSync(outF, outs.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(meterF, meters.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`${ENGINE}: ${outs.length} outputs, ${meters.length} meter rows → ${path.relative(process.cwd(), outF)}`);
}
