#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-stale-english-6388/score.mjs (reviewer A/B lists in seeded order, Wilson) — it scores
// a review packet of another shape (findings per page, one page per book); this maps the #6769 judge's A/B/same back
// through draw.mjs's key. Wilson from scripts/eval/lib/agreement-stats.mjs.
/**
 * #6769 step 2/3 scorer.  node scripts/eval/g4-reread-pilot-6769/score.mjs DIR [DIR…]   (each DIR from draw.mjs + judge.py)
 * Per DIR: G4L better / same / worse than the served text on the drawn pages (Wilson 95%), the controls (the clean copy
 * must win), and the column/reading-order report for every page the judge saw as two or more columns.
 */
import fs from 'node:fs';
import path from 'node:path';
import { wilson } from '../lib/agreement-stats.mjs';

const pct = (k, n) => { const [lo, hi] = wilson(k, n); return `${k}/${n} = ${Math.round(100 * k / Math.max(1, n))}% [${Math.round(100 * lo)}, ${Math.round(100 * hi)}]`; };
const all = {};
for (const dir of process.argv.slice(2)) {
  const { key, tag, frame, reads } = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));
  const rows = fs.readFileSync(path.join(dir, 'verdicts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const last = new Map(); for (const r of rows) if (r.verdict || !last.get(r.uid)?.verdict) last.set(r.uid, r);
  const out = { tag, reads, frame, sample: { better: 0, same: 0, worse: 0, unjudged: 0, n: 0 }, controls: { pass: 0, same: 0, fail: 0, unjudged: 0, n: 0 }, columns: [], pages: [] };
  for (const [uid, k] of Object.entries(key)) {
    const v = last.get(uid)?.verdict;
    const who = v ? (v.verdict === 'same' ? 'same' : k[v.verdict]) : null;
    const order = (x) => (v ? v[k.A === x ? 'order_A' : 'order_B'] : null);
    if (k.kind === 'control') {
      out.controls.n++;
      out.controls[!v ? 'unjudged' : who === 'clean' ? 'pass' : who === 'same' ? 'same' : 'fail']++;
      out.pages.push({ uid, kind: 'control', page: k.page_number, result: who, confidence: v?.confidence ?? null });
      continue;
    }
    out.sample.n++;
    const res = !v ? 'unjudged' : who === 'g4l' ? 'better' : who === 'same' ? 'same' : 'worse';
    out.sample[res]++;
    out.pages.push({ uid, kind: 'sample', page: k.page_number, served_model: k.served_model, result: res, confidence: v?.confidence ?? null, columns: v?.columns ?? null, order_g4l: order('g4l'), order_served: order('served'), checked: v?.checked ?? [] });
    if (v && v.columns >= 2) out.columns.push({ page: k.page_number, page_id: k.page_id, columns: v.columns, g4l: order('g4l'), served: order('served') });
  }
  const s = out.sample, judged = s.n - s.unjudged;
  out.summary = {
    better: pct(s.better, judged), same: pct(s.same, judged), worse: pct(s.worse, judged), unjudged: s.unjudged,
    controls: `${out.controls.pass}/${out.controls.n} clean copy chosen (${out.controls.same} same, ${out.controls.fail} planted chosen, ${out.controls.unjudged} unjudged)`,
    multi_column_pages: out.columns.length,
    g4l_order: Object.entries(out.columns.reduce((m, c) => ({ ...m, [c.g4l]: (m[c.g4l] || 0) + 1 }), {})),
    served_order: Object.entries(out.columns.reduce((m, c) => ({ ...m, [c.served]: (m[c.served] || 0) + 1 }), {})),
  };
  console.log(`\n== ${tag}: ${reads} reads, frame ${frame}`); console.log(JSON.stringify(out.summary, null, 1));
  all[tag] = out;
}
if (process.env.SCORE_OUT) fs.writeFileSync(process.env.SCORE_OUT, JSON.stringify(all, null, 1));
