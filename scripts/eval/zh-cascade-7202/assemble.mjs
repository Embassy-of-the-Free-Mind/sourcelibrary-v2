#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t5/merge-arms.py (T5: arm outputs → records-arms.jsonl for build-packet.mjs). This does the
// same for #7202's six arms, and computes the preregistered gates (gates.mjs) on the two cheap arms.
/**
 *   node scripts/eval/zh-cascade-7202/assemble.mjs --work $JOB_SCRATCH/work
 * Reads <work>/records.jsonl and <work>/arms/{lite,lite2,flash,flash2,deepseek,qwen}.jsonl (the LAST row per page wins; an
 * OpenRouter row cut by the provider, finish 'error', is an empty read). Writes <work>/records-arms.jsonl (the judge input)
 * and <work>/gates.json: the per-page measures of every arm, Flash's [P5, P95] length band on the Siku pages, and which
 * gates each cheap arm's page fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { measures, gatesFailed, percentile } from './gates.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const W = opt('work');
if (!W) { console.error('--work required'); process.exit(1); }
const ARMS = ['lite', 'lite2', 'flash', 'flash2', 'deepseek', 'qwen'];
const CHEAP = ['deepseek', 'qwen'];
const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const idOf = (r) => `${r.book_id}_${String(r.page_number).padStart(5, '0')}`;
const records = jl(path.join(W, 'records.jsonl'));
const out = {};
for (const a of ARMS) {
  const f = path.join(W, 'arms', `${a}.jsonl`);
  out[a] = new Map(fs.existsSync(f) ? jl(f).map((r) => [r.uid, r]) : []);
}
const textOf = (a, id) => { const r = out[a].get(id); if (!r) return null; if (r.finish === 'error') return ''; return r.text || ''; };
const missing = ARMS.flatMap((a) => records.filter((r) => textOf(a, idOf(r)) == null).map((r) => `${a}:${idOf(r)}`));
if (missing.length) console.log(`WARNING ${missing.length} arm-pages have no row: ${missing.slice(0, 8).join(' ')}`);

const per = {};
for (const r of records) {
  const id = idOf(r);
  per[id] = { track: r.track, stratum: r.stratum, flagged: !!r.qa_screen?.flagged, arms: Object.fromEntries(ARMS.map((a) => [a, measures(textOf(a, id) ?? '', r.source_text)])) };
}
const siku = records.filter((r) => r.track === 'siku').map(idOf);
const band = [percentile(siku.map((id) => per[id].arms.flash.ratio), 0.05), percentile(siku.map((id) => per[id].arms.flash.ratio), 0.95)];
for (const r of records) {
  const id = idOf(r);
  per[id].gates = Object.fromEntries([...CHEAP, 'lite', 'flash2'].map((a) => [a, gatesFailed(textOf(a, id) ?? '', r.source_text, { band, flagged: r.track === 'siku' && !!r.qa_screen?.flagged })]));
}
const summary = {};
for (const a of [...CHEAP, 'lite', 'flash2']) {
  const ids = Object.keys(per);
  const routed = (xs) => xs.filter((id) => per[id].gates[a].length).length;
  const byGate = {};
  for (const id of ids) for (const g of per[id].gates[a]) byGate[g] = (byGate[g] || 0) + 1;
  summary[a] = { routed_all: `${routed(ids)}/${ids.length}`, routed_t5: `${routed(ids.filter((id) => per[id].track === 'T5-zh'))}/24`,
    routed_siku_flagged: `${routed(siku.filter((id) => per[id].flagged))}/${siku.filter((id) => per[id].flagged).length}`,
    routed_siku_clean: `${routed(siku.filter((id) => !per[id].flagged))}/${siku.filter((id) => !per[id].flagged).length}`, by_gate: byGate };
}
fs.writeFileSync(path.join(W, 'gates.json'), JSON.stringify({ band, summary, per }, null, 1));
const recs = records.map((r) => ({ ...r, candidates: ARMS.map((a) => ({ arm: a, text: textOf(a, idOf(r)) ?? '' })) }));
fs.writeFileSync(path.join(W, 'records-arms.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({ band, summary }, null, 1));
