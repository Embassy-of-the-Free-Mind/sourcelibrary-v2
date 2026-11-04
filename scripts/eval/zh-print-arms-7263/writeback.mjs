#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/analyze.mjs writeback (the namespaced `study-…/<cell>` record, copied in shape; it reads that
// study's own files) and scripts/eval/lane-judge-sampler.mjs validRecord (imported, so a row it would not count is never written).
/**
 * #7263 job zh-print-arms-7263: this sitting's verdicts into lane_judge_verdicts, cell study-zh-print-arms-7263/<set>.
 *   node --env-file=… scripts/eval/zh-print-arms-7263/writeback.mjs --scratch=DIR [--apply]
 * The pilot's seeded verdicts are left out: they are #7263's pilot, not this sitting. `called: false`: these calls ran on this job's
 * login, not on the nightly sampler's weekly budget. Insert only ($setOnInsert), so a re-run changes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { validRecord } from '../lane-judge-sampler.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const SCR = path.resolve(arg('scratch')), APPLY = process.argv.includes('--apply');
const jsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ROUTE = { served: 'gemini-stored', O: 'gemini>opus', PFL: 'paddle>agy-flash-low', PFM: 'paddle>agy-flash-medium', F: 'opus-read' };
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 14);
const recs = [];
for (const set of ['one', 'ten']) {
  const P = JSON.parse(fs.readFileSync(path.join(SCR, set, 'plan.json'), 'utf8')), bySel = new Map(P.selected.map((s) => [s.key, s]));
  const last = new Map(jsonl(path.join(SCR, set, 'verdicts.jsonl')).filter((r) => r.verdict && !r.pilot).map((r) => [r.id, r]));
  for (const r of last.values()) {
    const s = bySel.get(r.key), kind = r.set === 'abs' ? 'item' : r.set;
    recs.push({ _id: `zpa${sha(`${set}:${r.id}`)}`, kind, page_id: r.page_id, book_id: s.book_id, page_number: s.page_number, cell: `study-zh-print-arms-7263/${set}`, cell_real: 'chinese-gemini/print', script_type: 'print',
      route: ROUTE[r.arms[0]] ?? r.arms[0], arms: r.arms, lane: 'zh-print-arms-7263', lang: 'Chinese', task: 'ocr', called: false,
      judge: { by: 'claude -p --model opus', model_reported: r.model ?? 'claude-opus-5-5', instrument: 'route-judge-6740 judgePrompt (judgeAbsolute through confirm.mjs judge)' },
      run_id: `zh-print-arms-7263/${r.id.includes('#sitting2') ? 'sitting2' : 'sitting1'}`, judged_at: r.at, verdict: r.verdict, usage: r.usage ?? null, list_usd: r.list_usd ?? null,
      draw: { stratum: set, frame: '#7263 the Opus correction pilot\'s judged pages of Gemini-read printed Chinese' }, write: { revision_id: `eval:${r.id}`, text_sha: r.text_sha ?? null }, ...(r.set === 'wrong_page' && { text_of: r.text_of }) });
  }
}
const bad = recs.filter((r) => !validRecord(r));
if (bad.length) { console.error(`${bad.length} records fail validRecord, first: ${JSON.stringify(bad[0]).slice(0, 300)}`); process.exit(1); }
const tally = {}; for (const r of recs) { const k = `${r.cell} ${r.kind} ${r.route}`; tally[k] = (tally[k] ?? 0) + 1; }
console.log(recs.length, 'records'); console.log(tally);
if (!APPLY) { console.log('DRY: --apply to write'); process.exit(0); }
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
try { const col = c.db('bookstore').collection('lane_judge_verdicts'); let n = 0; for (const r of recs) n += (await col.updateOne({ _id: r._id }, { $setOnInsert: r }, { upsert: true })).upsertedCount; console.log(`lane_judge_verdicts: ${n} inserted, ${recs.length - n} already there`); } finally { await c.close(); }
