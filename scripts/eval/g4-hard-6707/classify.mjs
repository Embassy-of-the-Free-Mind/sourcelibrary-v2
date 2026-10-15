// PRIOR ART: scripts/lib/read-failure.mjs + build-ocr-pareto.mjs toRow() — used as is; this only applies them to run-cli-arm.py rows.
// As build-ocr-pareto.mjs toRow(): text = the reply between the markers (what import-cli-arm.py commits), extracted =
// extractTranscription(text); a filter block (the runner's `blocked`) = the meter's SAFETY. Classify G4L raw rows with the chart's ONE FAILURE RULE (scripts/lib/read-failure.mjs). Last row per uid wins.
import fs from 'fs';
import { readFailure } from '/mnt/HC_Volume_105839809/worktrees/job-g4-hard2-6707/scripts/lib/read-failure.mjs';
import { extractTranscription } from '/mnt/HC_Volume_105839809/worktrees/job-g4-hard2-6707/scripts/lib/cli-chatter.mjs';
const [raw, out] = process.argv.slice(2);
const by = new Map();
for (const l of fs.readFileSync(raw, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); by.set(r.uid, r); }
const res = [];
for (const r of by.values()) {
  const f = readFailure({ text: r.text || '', extracted: extractTranscription(r.text || '').text, cli: true, blocked: !!r.blocked, error: r.error });
  res.push({ uid: r.uid, failure: f?.kind ?? null, why: f?.why ?? null, secs: r.secs, attempts: r.attempts, nudged: r.nudged, wrapper: r.wrapper,
    gate_denials: r.gate_denials, gate_calls: r.gate_calls, chars: (r.text || '').length, blocked: r.blocked, error: r.error && r.error.slice(0, 200), date: r.date });
}
fs.writeFileSync(out, JSON.stringify(res, null, 1));
const c = {}; for (const x of res) c[x.failure ?? 'read'] = (c[x.failure ?? 'read'] || 0) + 1;
console.log(raw.split('/').pop(), res.length, JSON.stringify(c));
