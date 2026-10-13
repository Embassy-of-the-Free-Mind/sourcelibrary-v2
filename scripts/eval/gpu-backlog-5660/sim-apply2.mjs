// #5660 job gpu-resume-5660 — run from /root/gpu-backlog-5660/resume (paths are that working dir's).
// lane apply decision (with bodyHanCount, from the fixed fleet code) for each re-test read
import fs from 'node:fs';
import { convertPaddle, envelope, bodyHanCount, MIN_HAN } from '/root/gpu-backlog-5660/zh/code/scripts/lib/paddle-zh-lane.mjs';
import { loopVerdict } from '/root/gpu-backlog-5660/zh/code/scripts/lib/ocr-loop-guard.mjs';
const [dir, list, outF] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(list, 'utf8')).map(x => {
  const s = `${x.bid}_${x.pn}`; const { body } = convertPaddle(fs.readFileSync(`${dir}/${s}.txt`, 'utf8'), {});
  const han = bodyHanCount(body); const action = han < MIN_HAN ? 'textless_kept' : loopVerdict(envelope(body)).refuse ? 'loop_refused' : 'write';
  return { stem: s, type: x.type, action, han, served: action === 'write' ? envelope(body) : '' };
});
fs.writeFileSync(outF, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const c = {}; for (const r of rows) c[`${r.type}:${r.action}`] = (c[`${r.type}:${r.action}`] || 0) + 1; console.log(c);
