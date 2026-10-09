#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-levers/opus-arm.mjs (#6121 round 2, arm O) writes the production prompt
// per page for Opus subagents and ingests their outputs; it reads round 2's two page sets. This does the
// same for the 84000 sides that have no Opus translation yet (#5497's X3 covered 40 of 113), from the
// byte-identical prompts in units.jsonl, and joins X3 + new into one O arm file for tib-ref113.
/**
 * opus-arm.mjs — #6182, arm O on tib-ref113. $0 (subscription), no DB writes.
 *
 *   node scripts/eval/pareto-6182/opus-arm.mjs --prompts   # /root/pareto-6182/o/{prompts,batches}
 *   node scripts/eval/pareto-6182/opus-arm.mjs --ingest    # o/out/*.txt + X3 → /root/pareto-6182/arms/O.jsonl
 * Agent instructions: /root/tlev2/o/AGENT-PROMPT.md (round 2's, verbatim), BATCH = a batches/*.txt file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeTranslationTags } from '../../lib/translate-core.mjs';

const W = '/root/pareto-6182', O = path.join(W, 'o');
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const units = jl(path.join(W, 'units.jsonl')).filter((u) => u.set === 'tib-ref113');
const x3 = new Map(jl('scripts/eval/results/tengyur-arms-2026-10/arms/X3.jsonl').map((r) => [r.page_id, r]));
const todo = units.filter((u) => !x3.has(u.uid));

if (process.argv.includes('--prompts')) {
  for (const d of ['prompts', 'out', 'batches']) fs.mkdirSync(path.join(O, d), { recursive: true });
  const pairs = todo.map((u) => { const pf = path.join(O, 'prompts', `${u.uid}.txt`); fs.writeFileSync(pf, u.prompt); return `${pf} ${path.join(O, 'out', `${u.uid}.txt`)}`; });
  const n = Math.ceil(pairs.length / 10);
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(O, 'batches', `O-${String(i + 1).padStart(2, '0')}.txt`), pairs.slice(i * 10, i * 10 + 10).join('\n') + '\n');
  console.log(`${pairs.length} prompts (X3 already has ${units.length - todo.length}), ${n} batches`);
}

if (process.argv.includes('--ingest')) {
  const rows = [], missing = [];
  for (const u of units) {
    if (x3.has(u.uid)) { rows.push({ uid: u.uid, arm: 'O', model: 'claude-opus (subagent, subscription; #5497 X3)', text: sanitizeTranslationTags(x3.get(u.uid).text.trim()), date: '2026-10-03', usd_batch: null }); continue; }
    const f = path.join(O, 'out', `${u.uid}.txt`);
    if (!fs.existsSync(f) || !fs.readFileSync(f, 'utf8').trim()) { missing.push(u.uid); continue; }
    rows.push({ uid: u.uid, arm: 'O', model: 'claude-opus-5-5 (subagent, subscription)', text: sanitizeTranslationTags(fs.readFileSync(f, 'utf8').trim()), date: '2026-10-07', usd_batch: null });
  }
  fs.writeFileSync(path.join(W, 'arms', 'O.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`O: ${rows.length} of ${units.length}; missing ${missing.length}${missing.length ? ` (${missing.join(', ')})` : ''}`);
}
