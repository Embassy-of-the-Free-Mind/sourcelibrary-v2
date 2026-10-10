#!/usr/bin/env node
// #5813 — find re-read pages where the NEW text interleaves Latin-script glosses into Greek that the OLD
// text did not have (the Symposium p. 225 case: faint pencilled interlinear notes "transcribed" as a
// fluent English gloss for every Greek phrase). Over every re-read page it measures the longest
// run of SHORT segments alternating between Greek and Latin script, old text vs new. Read-only.
//   node --env-file=… scripts/batch/greek-reocr-5813/gloss-scan.mjs --dir=DIR
import fs from 'node:fs';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';
import { stripWrappers } from '../../eval/lib/metrics.mjs';
const DIR = process.argv.find((a) => a.startsWith('--dir='))?.slice(6);
// Every re-read page of the run (compare.mjs outcome "reread").
const ids = new Set(fs.readFileSync(`${DIR}/stage3-compare.jsonl`, 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.outcome === 'reread').map((r) => r.page_id));
// Longest "ping-pong" run in the body: consecutive SHORT segments (≤ 5 words) that alternate between
// Greek script and Latin script. A gloss written over each Greek phrase gives a long run; a commentary
// that quotes Greek inside English prose does not, because its English segments are long.
const pingPong = (t) => {
  const w = stripWrappers(t || '').replace(/<[^>]*>/g, ' ').split(/\s+/).filter((x) => /\p{L}{2,}/u.test(x));
  const segs = []; let greek = 0;
  for (const x of w) { const sc = /\p{Script=Greek}/u.test(x) ? 'g' : /[A-Za-z]/.test(x) ? 'l' : null; if (!sc) continue; if (sc === 'g') greek++; if (segs.length && segs.at(-1).sc === sc) segs.at(-1).n++; else segs.push({ sc, n: 1 }); }
  let best = 0, run = 0;
  for (const sg of segs) { run = sg.n <= 5 ? run + 1 : 0; if (run > best) best = run; }
  return { run: best, greek };
};
const before = new Map();
for await (const l of readline.createInterface({ input: fs.createReadStream(`${DIR}/stage3-before.jsonl`) })) { const m = /"id":"([^"]+)"/.exec(l); if (m && ids.has(m[1])) { const j = JSON.parse(l); before.set(m[1], pingPong(j.ocr.data).run); } }
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const out = [];
const arr = [...ids];
for (let i = 0; i < arr.length; i += 1000) {
  for (const p of await c.db('bookstore').collection('pages').find({ id: { $in: arr.slice(i, i + 1000) }, 'ocr.model': 'gemini-3-flash-preview' }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, script_type: 1, 'ocr.data': 1 } }).toArray()) {
    const o = before.get(p.id) ?? 0, n = pingPong(p.ocr.data);
    if (n.greek >= 20 && n.run >= 12 && n.run >= o + 8) out.push({ page_id: p.id, book_id: p.book_id, n: p.page_number, script_type: p.script_type, old_run: o, new_run: n.run });
  }
}
await c.close();
const by = {}; for (const x of out) by[x.book_id] = (by[x.book_id] || 0) + 1;
fs.writeFileSync(`${DIR}/gloss-suspects.json`, JSON.stringify(out));
console.log(`${out.length} suspect pages of ${ids.size} re-read, in ${Object.keys(by).length} books`, JSON.stringify(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12)), JSON.stringify(out.reduce((m, x) => (m[x.script_type] = (m[x.script_type] || 0) + 1, m), {})));
