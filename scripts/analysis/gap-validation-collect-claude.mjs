#!/usr/bin/env node
/**
 * Collect the Claude adjudication workflow's result from its on-disk task-output
 * file into the verdicts JSONL (avoids round-tripping the big result through the
 * agent's context). Idempotent: dedupes by key, keeps the last verdict per key.
 *
 * Usage: node scripts/analysis/gap-validation-collect-claude.mjs <task-output.json>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, 'eval-data', 'gap-validation-claude-verdicts.jsonl');
const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('usage: collect-claude.mjs <task-output.json>'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const result = Array.isArray(raw) ? raw : raw.result;
if (!Array.isArray(result)) { console.error('no result array in', src); process.exit(1); }

const byKey = new Map();
if (fs.existsSync(OUT))
  for (const l of fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) { try { const o = JSON.parse(l); byKey.set(o.key, o); } catch {} }
let added = 0;
for (const r of result) { if (r && r.key) { byKey.set(r.key, { model: 'claude-general-purpose', ...r }); added++; } }

fs.writeFileSync(OUT, [...byKey.values()].map((o) => JSON.stringify(o)).join('\n') + '\n');
const fails = [...byKey.values()].filter((o) => o.translation_verdict === 'FAIL').length;
console.log(`collected ${result.length} (merged → ${byKey.size} total, ${fails} FAIL) → ${OUT}`);
