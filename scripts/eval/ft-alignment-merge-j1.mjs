#!/usr/bin/env node
/**
 * Merge J1 verdicts for the #2885(b) alignment gold into one file the scorer reads.
 *
 * J1 subagents each write their own single-pair verdict (either returned to the
 * orchestrator and collected into ft-alignment-verdicts-j1-manual-<date>.json, or
 * written per-pair into the alignment-oracle-<date>/ directory). This unions both
 * sources by pair_id (later duplicates ignored) into:
 *   scripts/eval/results/ft-alignment-verdicts-j1-<date>.json
 *
 * Usage: node scripts/eval/ft-alignment-merge-j1.mjs [--date YYYY-MM-DD]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
const di = process.argv.indexOf('--date');
const DATE = di !== -1 && process.argv[di + 1] ? process.argv[di + 1] : new Date().toISOString().slice(0, 10);

const byId = new Map();
const add = (v) => { if (v && v.pair_id && !byId.has(v.pair_id)) byId.set(v.pair_id, v); };

// 1) manually-collected verdicts (e.g. the link census returned to the orchestrator)
const manualPath = path.join(RESULTS_DIR, `ft-alignment-verdicts-j1-manual-${DATE}.json`);
if (fs.existsSync(manualPath)) JSON.parse(fs.readFileSync(manualPath, 'utf8')).forEach(add);

// 2) per-pair oracle files written by file-writing subagents
const oracleDir = path.join(RESULTS_DIR, `alignment-oracle-${DATE}`);
if (fs.existsSync(oracleDir)) {
  for (const f of fs.readdirSync(oracleDir).filter((n) => n.endsWith('.json')).sort()) {
    try { add(JSON.parse(fs.readFileSync(path.join(oracleDir, f), 'utf8'))); }
    catch (e) { console.warn(`[WARN] skipping malformed ${f}: ${e.message}`); }
  }
}

const merged = [...byId.values()];
const outPath = path.join(RESULTS_DIR, `ft-alignment-verdicts-j1-${DATE}.json`);
fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
const tally = merged.reduce((m, v) => { const k = v.same === true ? 'same' : v.same === false ? 'different' : 'uncertain'; m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`Merged ${merged.length} J1 verdicts: ${JSON.stringify(tally)}`);
console.log(`Wrote ${outPath}`);
