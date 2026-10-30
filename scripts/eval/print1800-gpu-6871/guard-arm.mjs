#!/usr/bin/env node
// PRIOR ART: none — a CLI over scripts/lib/gpu-ocr-loop-guard.mjs so the python scorer can apply the same guard.
/** guard-arm.mjs <arm.jsonl> <out.jsonl> — one row per page {page_id, refuse, reason, detail}. */
import fs from 'node:fs';
import { gpuLoopVerdict } from '../../lib/gpu-ocr-loop-guard.mjs';
const [inp, out] = process.argv.slice(2);
const rows = fs.readFileSync(inp, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
fs.writeFileSync(out, rows.map((r) => JSON.stringify({ page_id: r.page_id || r.slug, ...gpuLoopVerdict(r.text || '', { finish: r.finish }) })).join('\n') + '\n');
const n = rows.length, k = fs.readFileSync(out, 'utf8').split('\n').filter((l) => l.includes('"refuse":true')).length;
console.log(`${inp}: ${k}/${n} refused`);
