#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t1 — reused. Its results pack arm outputs one JSONL per arm (README there) so a PR stays under GitHub's 300-file limit; that packing was done by hand. This does it for #6202's arms, picks and ledger, and reads the measured spend back from the meter.
/** Pack #6202's per-page arm outputs, picks and the call ledger into the results dir (one JSONL per model-arm), and report ledger vs metered spend. */
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/temp-6202/pack.mjs [--work /data/scratch/sl/temp-6202] [--out scripts/eval/results/temp-6202-2026-10]
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getScopeSpendUsd } from '../../lib/spend-guard.mjs';
import { readJsonl } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/temp-6202'); const OUT = opt('out', 'scripts/eval/results/temp-6202-2026-10');
fs.mkdirSync(path.join(OUT, 'arms'), { recursive: true });
for (const d of fs.readdirSync(path.join(WORK, 'arms')).sort()) {
  const rows = fs.readdirSync(path.join(WORK, 'arms', d)).filter((f) => f.endsWith('.json') && !f.endsWith('.failed.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(WORK, 'arms', d, f), 'utf8')));
  fs.writeFileSync(path.join(OUT, 'arms', `${d}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
for (const m of fs.existsSync(path.join(WORK, 'picks')) ? fs.readdirSync(path.join(WORK, 'picks')) : []) {
  const rows = fs.readdirSync(path.join(WORK, 'picks', m)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(WORK, 'picks', m, f), 'utf8')));
  fs.writeFileSync(path.join(OUT, `picks-${m}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
const ledger = readJsonl(path.join(WORK, 'ledger.jsonl'));
const by = {};
for (const r of ledger) { const k = `${r.model}-${r.arm}`; const b = (by[k] ||= { calls: 0, usd: 0, in: 0, out: 0, thinking: 0, empty_or_nonstop: 0 }); b.calls++; b.usd += r.usd; b.in += r.in; b.out += r.out; b.thinking += r.thinking; if (r.finish !== 'STOP') b.empty_or_nonstop++; }
for (const b of Object.values(by)) b.usd = +b.usd.toFixed(4);
const total = +ledger.reduce((s, r) => s + r.usd, 0).toFixed(4);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
let metered = null;
try { const s = await getScopeSpendUsd(c.db(process.env.MONGODB_DB || 'bookstore'), { ids: ['temp-6202'], since: new Date(ledger[0].at.slice(0, 10)) }); metered = { usd: +s.usd.toFixed(4), rows: s.rows, meterError: s.meterError || null }; } finally { await c.close(); }
fs.writeFileSync(path.join(OUT, 'spend.json'), JSON.stringify({ cap_usd: 10, ledger_usd: total, ledger_calls: ledger.length, metered, mode: 'realtime (Batch-equivalent is half)', by_arm: by }, null, 1));
console.log(`ledger $${total} over ${ledger.length} calls; metered ${JSON.stringify(metered)}`);
