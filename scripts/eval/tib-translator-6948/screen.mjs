// PRIOR ART: scripts/eval/g4-xl-6750/screen.mjs — copied with one change: the arm name (C4L there) is an argument, so
// one screen serves #6948's two agy arms (G4L, F38). Everything else, the FILTER amendment included, is unchanged.
// #6750: screen the C4L CLI replies. A flagged reply is blanked (appended row, text '') so run-cli-arm.py reads it once
// more from scratch; a page flagged a second time, or left empty after the runner's attempts, is a FAILED read
// (counted, not scored; the prereg). Writes req-todo.jsonl (pages still to read) and C4L.jsonl (clean rows only).
//   node scripts/eval/g4-xl-6750/screen.mjs <scratch-dir> [--final]
import fs from 'fs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';

const S = process.argv[2];
const FINAL = process.argv.includes('--final');
const ARM = process.argv.find((a, i) => i > 2 && !a.startsWith('--')) || 'C4L';
// Amendment 1 (2026-10-15): Gemini's own block / recitation-cut messages, which cliChatterReason does not know. Two C4L
// replies of this kind passed the screen and were found only after judging (Arabic: "The prompt could not be submitted …
// Prohibited Use policy"; Latin: a <warning> that "translation … cannot be provided because … recitation filters").
const FILTER = /Prohibited Use policy|prompt could not be submitted|recitation (?:and )?(?:content )?(?:safety )?filters?|copyright (?:and recitation )?filters?|blocked by Gemini|cannot be provided because/i;
const INFRA = /UNAVAILABLE \(code 503\)|INTERNAL \(code 500\)|service is currently unavailable/;
const jl = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const req = jl(`${S}/req.jsonl`);
const rows = jl(`${S}/raw.jsonl`);
const last = {}, guarded = {}, infra = {};
for (const r of rows) {
  last[r.uid] = r;
  if (r.guard) guarded[r.uid] = (guarded[r.uid] || 0) + 1;
  if (r.infra) infra[r.uid] = (infra[r.uid] || 0) + 1;
}
const failed = jl(`${S}/failed.jsonl`);
const failedSet = new Set(failed.map((f) => f.uid));
const add = [], fail = [], clean = [];
for (const q of req) {
  const r = last[q.uid];
  if (!r || failedSet.has(q.uid)) continue;
  if (r.guard || r.infra) continue; // blanked, waiting for its re-read
  const why = cliChatterReason(r.text) || (FILTER.test(r.text || '') ? 'filter stub' : null);
  if (!why) { clean.push(r); continue; }
  // a service outage is not a read (like a quota stop): read again, up to 3 times (2026-10-15, one 503)
  if (why === 'empty' && INFRA.test(r.error || '') && (infra[q.uid] || 0) < 3) {
    add.push({ uid: q.uid, arm: r.arm, text: '', infra: String(r.error).slice(0, 200), date: new Date().toISOString() });
    continue;
  }
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
fs.writeFileSync(`${S}/${ARM}.jsonl`, clean.map((r) => JSON.stringify(r)).join('\n') + (clean.length ? '\n' : ''));
console.log(JSON.stringify({ requests: req.length, clean: clean.length, reread_now: add.length, failed: allFailed.size, todo: todo.length,
  reasons: Object.fromEntries(Object.entries([...add, ...fail].reduce((m, x) => { const k = x.guard || (x.infra ? 'service outage' : x.why); m[k] = (m[k] || 0) + 1; return m; }, {}))) }));
