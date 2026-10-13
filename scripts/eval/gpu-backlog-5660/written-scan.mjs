// #5660 job gpu-resume-5660 — run from /root/gpu-backlog-5660/resume (paths are that working dir's).
// #5660 resume: screen every page gate 0 already WROTE (applied.jsonl, modified) — char runs + first-ocr-guard text rules
import fs from 'node:fs';
import { convertPaddle, longestCharRun, MAX_CHAR_RUN } from '/root/gpu-backlog-5660/zh/code/scripts/lib/paddle-zh-lane.mjs';
import { textVerdict } from '/root/sourcelibrary/.claude/worktrees/job-gpu-resume-5660/scripts/lib/first-ocr-guard.mjs';
const rows = fs.readFileSync('../zh/applied.jsonl', 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.modified);
const out = [];
for (const r of rows) {
  const f = `../zh/out/${r.bid}/${r.pn}.txt`; if (!fs.existsSync(f)) continue;
  const { body } = convertPaddle(fs.readFileSync(f, 'utf8'), {});
  const run = longestCharRun(body); const v = textVerdict(body.replace(/<[^>]+>/g, ''));
  if (run > MAX_CHAR_RUN || v.flag) out.push({ bid: r.bid, pn: r.pn, run, flags: v.flags, sl: v.max_short_line_repeat, lr: v.max_line_repeat });
}
fs.writeFileSync('written-flags.jsonl', out.map(x => JSON.stringify(x)).join('\n') + '\n');
const c = {}; for (const x of out) { for (const f of x.flags) c[f] = (c[f] || 0) + 1; if (x.run > MAX_CHAR_RUN) c.char_run = (c.char_run || 0) + 1; }
console.log(rows.length, 'written;', out.length, 'flagged', c);
