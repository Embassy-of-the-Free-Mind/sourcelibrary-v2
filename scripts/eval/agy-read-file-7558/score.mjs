#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-per-call-7522/score.mjs — the same unblinding, control check and per-arm fault table; it
// hard-codes #7522's arms and floor pair (A1~A1b) and its block calls.jsonl. This scores the #7558 prompt A/B, where
// the comparison is paired by page (old vs new prompt at the same pages per call) and the tool turns are the question.
/**
 * #7558 step 2 score: unblind DIR/judge/out against key.json, check the 4 planted controls, and per arm count usable,
 * faults, agy calls, tool turns and agy's tokens per page (from the reads' metas; a block call is counted once).
 *
 *   node scripts/eval/agy-read-file-7558/score.mjs --scratch=DIR > results.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { wilson } from '../lib/agreement-stats.mjs';
import { FAULTS } from '../ocr-per-call-7522/judge.mjs';

const ARMS = ['old1', 'new1', 'old4', 'new4'];   // prep.mjs's arms (importing it would run it)
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = arg('scratch');
const J = path.join(S, 'judge');
const key = JSON.parse(fs.readFileSync(path.join(J, 'key.json'), 'utf8'));
const tamper = JSON.parse(fs.readFileSync(path.join(J, 'tamper.json'), 'utf8'));
const verdicts = Object.fromEntries(fs.readdirSync(path.join(J, 'out')).map((f) => { const o = JSON.parse(fs.readFileSync(path.join(J, 'out', f), 'utf8')); return [o.page_id, o.verdict]; }));

const byArm = Object.fromEntries([...ARMS, 'CTL'].map((a) => [a, {}]));
for (const [pid, letters] of Object.entries(key)) for (const [l, arm] of Object.entries(letters)) byArm[arm][pid] = verdicts[pid]?.versions?.[l] ?? null;

const controls = Object.entries(tamper).map(([pid, t]) => {
  const v = byArm.CTL[pid];
  const caught = !!v && !v.usable && (t.kind === 'drop' ? v.omissions.length > 0 : v.cross_page_bleed.length + v.additions.length > 0);
  return { page_id: pid, kind: t.kind, caught };
});
const nCaught = controls.filter((c) => c.caught).length;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const arms = {};
for (const arm of ARMS) {
  const vs = Object.entries(byArm[arm]);
  const judged = vs.filter(([, v]) => v);
  const usable = judged.filter(([, v]) => v.usable).length;
  const metas = fs.readdirSync(path.join(S, arm)).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(S, arm, f), 'utf8')));
  const calls = new Map(metas.map((m) => [m.call_id || m.page_id, m]));
  const use = [...calls.values()].flatMap((m) => m.usage || []).filter(Boolean);
  const tools = [...calls.values()].flatMap((m) => m.tool_calls || []);
  const w = wilson(usable, judged.length);
  arms[arm] = {
    pages: metas.length, judged: judged.length, usable, usable_ci95: w.map((x) => Math.round(x * 1000) / 1000),
    faults: Object.fromEntries(FAULTS.map((f) => [f, f === 'misreads' ? judged.filter(([, v]) => v[f].length).length : sum(judged.map(([, v]) => v[f].length))])),
    agy_calls: sum([...calls.values()].map((m) => m.calls || 1)),
    tool_calls: tools.length, denied_tool_calls: tools.filter((t) => t.endsWith(':deny')).length,
    input_per_page: Math.round(sum(use.map((u) => u.input || 0)) / metas.length),
    uncached_input_per_page: Math.round(sum(use.map((u) => (u.input || 0) - (u.cache_read || 0))) / metas.length),
    output_per_page: Math.round(sum(use.map((u) => (u.output || 0) + (u.thinking || 0))) / metas.length),
  };
}
// Paired by page: pages usable under the old prompt and not the new, and the reverse.
const pair = (a, b) => { let worse = 0, better = 0; for (const pid of Object.keys(key)) { const x = byArm[a][pid], y = byArm[b][pid]; if (!x || !y) continue; if (x.usable && !y.usable) worse++; if (!x.usable && y.usable) better++; } return { new_worse: worse, new_better: better }; };
console.log(JSON.stringify({
  status: nCaught >= 3 ? 'result' : 'probe_broken', controls_caught: `${nCaught}/${controls.length}`, controls,
  arms, paired: { '1/call old→new': pair('old1', 'new1'), '4/call old→new': pair('old4', 'new4') },
}, null, 1));
