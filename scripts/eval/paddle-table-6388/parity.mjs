// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import fs from 'fs'; import zlib from 'zlib'; import readline from 'readline';
import { paddleTableRisk } from '../../lib/paddle-table-detect.mjs';
const titles = JSON.parse(fs.readFileSync('titles.json'));
const rl = readline.createInterface({ input: fs.createReadStream('paddle-pages.jsonl.gz').pipe(zlib.createGunzip()) });
const fd = fs.openSync('flagged-S4.jsonl', 'w'); let buf = [], n = 0, k = 0, gate = 0, tabShapeOnly = 0; const by = {};
for await (const l of rl) {
  const r = JSON.parse(l); const v = paddleTableRisk(r.text, { title: titles[r.bid] });
  if (v.gate) gate++;
  if (!v.gate && (v.features.distinct_ratio < 0.3 && v.features.han > 0 || v.reasons.includes('table_title'))) tabShapeOnly++;
  if (v.flag) { k++; by[r.iss] = (by[r.iss] || 0) + 1; buf.push(JSON.stringify({ bid: r.bid, pn: r.pn, pid: r.pid, iss: r.iss, reasons: v.reasons })); if (buf.length > 1000) { fs.writeSync(fd, buf.join('\n') + '\n'); buf = []; } }
  if (++n % 200000 === 0) console.log(n, k);
}
if (buf.length) fs.writeSync(fd, buf.join('\n') + '\n');
console.log('DONE', JSON.stringify({ pages: n, flagged: k, gate, by_issue: by, table_shape_not_gated: tabShapeOnly }));
