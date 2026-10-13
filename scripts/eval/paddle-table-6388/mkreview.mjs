// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
// build cross-review requests: reviewer family X reviews the other family's reads, + 3 planted duplicated-row controls
import fs from 'fs'; import crypto from 'crypto';
const [, , READS, OUT, MODE, N] = process.argv; // MODE agy|opus ; N = how many real pages (seeded subset)
const P = fs.readFileSync('review-prompt.txt', 'utf8');
const rows = fs.readFileSync(READS, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const last = new Map(); for (const r of rows) if (r.text) last.set(r.uid, r);
const h = s => crypto.createHash('sha256').update('6388' + s).digest('hex');
let real = [...last.values()].sort((a, b) => h(a.uid) < h(b.uid) ? -1 : 1);
if (N) real = real.slice(0, +N);
const CTL = ['t25', 't28', 't30'];
const controls = CTL.map((u, i) => {
  const t = last.get(u).text; const lines = t.split('\n');
  const body = lines.map((l, k) => [l, k]).filter(([l]) => (l.match(/\p{Script=Han}/gu) || []).length >= 3 && !/^</.test(l));
  const [line, k] = body[Math.floor(body.length / 2)];
  const planted = [...lines.slice(0, k + 1), line, ...lines.slice(k + 1)].join('\n');
  return { uid: `ctl${i + 1}_${u}`, base: u, inserted: line, text: planted, control: true };
});
const all = [...real.map(r => ({ uid: r.uid, base: r.uid, text: r.text })), ...controls].sort((a, b) => h('o' + a.uid) < h('o' + b.uid) ? -1 : 1);
const suffix = MODE === 'opus' ? '\n\nThe page image is the file ./page.jpg in the current directory. Open it with the Read tool (the only tool you may use), then reply with the JSON only.' : '\n\nThe page image is attached:';
fs.writeFileSync(OUT, all.map(r => JSON.stringify({ uid: r.uid, image: process.cwd() + '/img/' + r.base + '.jpg', prompt: P.replace('{{TEXT}}', r.text) + suffix })).join('\n') + '\n');
fs.writeFileSync(OUT.replace('.jsonl', '-controls.json'), JSON.stringify(controls.map(({ text, ...c }) => c), null, 1));
console.log(OUT, all.length, controls.map(c => c.uid + ' ' + c.inserted).join(' | '));
