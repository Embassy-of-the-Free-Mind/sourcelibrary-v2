#!/usr/bin/env node
// PRIOR ART: translate-cli-lane-7075/sample.mjs (control scoring for translation packets, by different keys). Scores one tag's blind controls.
// #6552: per reader, how each control kind was answered; real items side by side with the raw reads (stays in scratch: prints text only with --show).
//   node controls.mjs --c=a --tag=a1 [--show]
import fs from 'node:fs';
import path from 'node:path';
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const OUT = path.join(process.env.JOB_SCRATCH, arg('c'), 'tags', arg('tag')), key = JSON.parse(fs.readFileSync(path.join(OUT, 'key.json'))), SHOW = process.argv.includes('--show');
const rs = fs.readdirSync(OUT).filter((f) => /^verdicts-.*\.jsonl$/.test(f)).map((f) => f.slice(9, -6));
const V = {}, usage = {};
for (const r of rs) {
  V[r] = {}; usage[r] = { calls: 0, failed: 0, cost: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const l of fs.readFileSync(path.join(OUT, `verdicts-${r}.jsonl`), 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(l), u = usage[r]; u.calls++; if (!row.items) u.failed++; u.cost += row.cost || 0;
    u.input += row.usage?.input_tokens || 0; u.output += row.usage?.output_tokens || 0; u.cache_read += row.usage?.cache_read_input_tokens || 0; u.cache_write += row.usage?.cache_creation_input_tokens || 0;
    for (const it of row.items || []) V[r][`${row.packet}:${it.n}`] = it;
  }
}
/** A blind answer in witness terms. */
export const said = (it, v) => { if (!v) return 'missing'; const c = v.choice; if (c === 'A') return it.swap ? 'ocr' : 'typed'; if (c === 'B') return it.swap ? 'typed' : 'ocr'; return c; };
const right = { plant_typed: 'ocr', decoy_ocr: 'typed', neither: 'neither', wrong_crop: 'cannot_tell' }, T = {};
for (const it of key) {
  if (!right[it.kind]) continue;
  for (const r of rs) { const t = ((T[r] ||= {})[it.kind] ||= { n: 0, right: 0, answers: {} }), s = said(it, V[r][`${it.packet}:${it.n}`]); t.n++; if (s === right[it.kind]) t.right++; t.answers[s] = (t.answers[s] || 0) + 1; }
}
for (const r of rs) { console.log(r, JSON.stringify(usage[r])); for (const [k, t] of Object.entries(T[r] || {})) console.log(`  ${k}: ${t.right}/${t.n}`, JSON.stringify(t.answers)); }
if (SHOW) for (const it of key.filter((i) => i.kind === 'real')) console.log(it.uid, `${it.left}[${it.typed}|${it.ocr}]${it.right}`, rs.map((r) => { const v = V[r][`${it.packet}:${it.n}`]; return `${r}=${said(it, v)}/${v?.seen ?? ''}${v?.variant ? '/var' : ''}${v?.slip ? '/slip' : ''}`; }).join('  '));
