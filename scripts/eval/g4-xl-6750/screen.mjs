// PRIOR ART: scripts/lib/cli-chatter.mjs cliChatterReason (the #6412 guard, used as is); run-cli-arm.py retries only
// rows with no text, so a reply that is a plan note or an opener needs this step to be read again. Nothing else here.
// #6750: screen the C4L CLI replies. A flagged reply is blanked (appended row, text '') so run-cli-arm.py reads it once
// more from scratch; a page flagged a second time, or left empty after the runner's attempts, is a FAILED read
// (counted, not scored; the prereg). Writes req-todo.jsonl (pages still to read) and C4L.jsonl (clean rows only).
//   node scripts/eval/g4-xl-6750/screen.mjs <scratch-dir> [--final]
import fs from 'fs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';

const S = process.argv[2];
const FINAL = process.argv.includes('--final');
const jl = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const req = jl(`${S}/req.jsonl`);
const rows = jl(`${S}/raw.jsonl`);
const last = {}, guarded = {};
for (const r of rows) {
  last[r.uid] = r;
  if (r.guard) guarded[r.uid] = (guarded[r.uid] || 0) + 1;
}
const failed = jl(`${S}/failed.jsonl`);
const failedSet = new Set(failed.map((f) => f.uid));
const add = [], fail = [], clean = [];
for (const q of req) {
  const r = last[q.uid];
  if (!r || failedSet.has(q.uid)) continue;
  if (r.guard) continue; // blanked, waiting for its re-read
  const why = cliChatterReason(r.text);
  if (!why) { clean.push(r); continue; }
  if (why === 'empty') {
    // the runner already spent its two attempts on this read (empty, timeout, denied tool, filter)
    fail.push({ uid: q.uid, why: `empty: ${r.error || ''}`.slice(0, 300) });
    continue;
  }
  if ((guarded[q.uid] || 0) >= 1 || FINAL) fail.push({ uid: q.uid, why, head: String(r.text).slice(0, 200) });
  else add.push({ uid: q.uid, arm: r.arm, text: '', guard: why, flagged_text: r.text, date: new Date().toISOString() });
}
if (add.length) fs.appendFileSync(`${S}/raw.jsonl`, add.map((x) => JSON.stringify(x)).join('\n') + '\n');
if (fail.length) fs.appendFileSync(`${S}/failed.jsonl`, fail.map((x) => JSON.stringify(x)).join('\n') + '\n');
const allFailed = new Set([...failedSet, ...fail.map((f) => f.uid)]);
const cleanSet = new Set(clean.map((r) => r.uid));
const todo = req.filter((q) => !cleanSet.has(q.uid) && !allFailed.has(q.uid));
fs.writeFileSync(`${S}/req-todo.jsonl`, todo.map((x) => JSON.stringify(x)).join('\n') + (todo.length ? '\n' : ''));
fs.writeFileSync(`${S}/C4L.jsonl`, clean.map((r) => JSON.stringify(r)).join('\n') + (clean.length ? '\n' : ''));
console.log(JSON.stringify({ requests: req.length, clean: clean.length, reread_now: add.length, failed: allFailed.size, todo: todo.length,
  reasons: Object.fromEntries(Object.entries([...add, ...fail].reduce((m, x) => ((m[x.guard || x.why] = (m[x.guard || x.why] || 0) + 1), m), {}))) }));
