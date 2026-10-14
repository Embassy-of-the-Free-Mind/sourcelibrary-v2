// yigdzin-rest-4523 (#4523): the write rule between judge.py and apply-reocr-verdicts.mjs. Never writes to Mongo.
// PRIOR ART: scripts/eval/gpu-backlog-5660/first-ocr-guard-run.mjs runs scripts/lib/first-ocr-guard.mjs over a directory
// and only reports. Here the same verdict FILTERS one judge batch, per Derek's 2026-10-10 rule for #5660 shard 0, which
// the brief applies to this run: a SERVE row is written only if first-ocr-guard does not flag it AND it has >= 150
// Tibetan syllables. The judge's v4 rule against an empty reference passes title leaves padded with དགེའོ, blank leaves
// read as shad marks and loops on cursive (#5660 gate 0); the guard and the floor are what stop those.
//
//   YIG_DIR=<dir> node guard.mjs <verdicts/batch-*.jsonl>
// Reads  $YIG_DIR/stripped/<stem>.txt (the judge's served text), $YIG_DIR/todo-all.jsonl (image url, scope).
// Writes <batch>.write.jsonl (the rows to apply) and appends one row per judged-SERVE page to $YIG_DIR/guard-decisions.jsonl.
// Prints {rows, write, refused: {reason: n}} on stdout.
import fs from 'node:fs';
import { firstOcrVerdict } from '../../lib/first-ocr-guard.mjs';

const MIN_UNITS = 150;
const DIR = process.env.YIG_DIR, batch = process.argv[2];
if (!DIR || !batch) { console.error('YIG_DIR and a batch file required'); process.exit(1); }
const todo = new Map();
for (const l of fs.readFileSync(`${DIR}/todo-all.jsonl`, 'utf8').split('\n')) if (l) { const r = JSON.parse(l); todo.set(r.stem, r); }
const rows = fs.readFileSync(batch, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function image(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* retried */ }
  }
  return null;
}

const out = [], dec = [], refused = {};
let next = 0;
async function work() {
  while (next < rows.length) {
    const v = rows[next++];
    const stem = `${v.book}_${String(v.page).padStart(5, '0')}`;
    const t = todo.get(stem);
    const text = fs.readFileSync(`${DIR}/stripped/${stem}.txt`, 'utf8');
    const img = t?.url ? await image(t.url) : null;
    const g = await firstOcrVerdict(text, img);
    const why = g.flag ? `guard:${g.flags.join('+')}` : g.units < MIN_UNITS ? 'short:<150-syllables' : null;
    if (why) refused[why.split('+')[0]] = (refused[why.split('+')[0]] || 0) + 1; else out.push(v);
    dec.push({ stem, book: v.book, page: v.page, scope: t?.scope ?? null, prior: t?.prior ?? null, units: g.units, flags: g.flags,
      leaf_tex: g.leaf_tex ?? null, image: img ? 'ok' : 'unread', write: !why, why, at: new Date().toISOString() });
  }
}
await Promise.all(Array.from({ length: 8 }, work));
fs.writeFileSync(batch.replace(/\.jsonl$/, '.write.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));
fs.appendFileSync(`${DIR}/guard-decisions.jsonl`, dec.map((r) => JSON.stringify(r)).join('\n') + (dec.length ? '\n' : ''));
console.log(JSON.stringify({ rows: rows.length, write: out.length, refused, image_unread: dec.filter((d) => d.image !== 'ok').length }));
