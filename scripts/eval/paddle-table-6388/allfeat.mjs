// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import fs from 'fs'; import zlib from 'zlib'; import readline from 'readline';
import { features } from './feat.mjs';
import { longestCharRun } from '../../lib/paddle-zh-lane.mjs';
import { textVerdict } from '../../lib/first-ocr-guard.mjs';
const STRICT = new Set(['local_loop', 'line_loop', 'exact_loop']);
export function strictOf(text) {
  const b = String(text || '').replace(/<language>[\s\S]*?<\/language>|<script>[\s\S]*?<\/script>/g, '').trim();
  const v = textVerdict(b.replace(/<[^>]+>/g, ''));
  const s = v.flags.filter((x) => STRICT.has(x));
  return { strict: s.length > 0 || longestCharRun(b) > 40, sflags: v.flags, local_max: v.local_max, line_ngram_max: v.line_ngram_max, max_line_repeat: v.max_line_repeat, max_short_line_repeat: v.max_short_line_repeat };
}
if (process.argv[2] === 'run') {
  const rl = readline.createInterface({ input: fs.createReadStream('paddle-pages.jsonl.gz').pipe(zlib.createGunzip()) });
  const fd = fs.openSync('allfeat.jsonl', 'w'); let buf = [];
  let n = 0;
  for await (const l of rl) {
    const r = JSON.parse(l);
    buf.push(JSON.stringify({ key: `${r.bid}_${r.pn}`, bid: r.bid, iss: r.iss, run: r.run, ...features(r.text, r.pp), ...strictOf(r.text) }));
    if (buf.length >= 5000) { fs.writeSync(fd, buf.join('\n') + '\n'); buf = []; }
    if (++n % 100000 === 0) console.log(n, new Date().toISOString());
  }
  if (buf.length) fs.writeSync(fd, buf.join('\n') + '\n'); fs.closeSync(fd); console.log('DONE', n);
}
