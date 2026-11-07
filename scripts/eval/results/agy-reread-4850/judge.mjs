#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/judge.mjs — the #7866 judge (judgeAbsolute = route-judge-6740 judgePrompt,
// Opus via claude -p, the page image in the workspace), imported unchanged; its runner reads #7866's own draw, so this
// one feeds it the #4850 pairs. scripts/eval/agy-ocr-per-call-6740 is the agy read eval this test's reads follow.
/**
 * #4850 gated test, judge stage. Per drawn page, two BLIND absolute verdicts (the stored looping read, the new agy read),
 * each alone with the page image, in a seeded random order so the judge never sees the pair. The comparison is derived:
 * better / same / worse = new fidelity >, =, < old fidelity. Nothing here writes to Mongo.
 *   node --env-file=.env.production.local scripts/eval/results/agy-reread-4850/judge.mjs DRAW.json READS_DIR OLD_TEXTS.json OUT.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { judgeAbsolute, paceCheck } from '../../correction-pass-7818/lib.mjs';
const [DRAW, READS, OLD, OUT] = process.argv.slice(2);
const drawn = JSON.parse(fs.readFileSync(DRAW, 'utf8')).drawn;
const old = JSON.parse(fs.readFileSync(OLD, 'utf8'));
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict).map((r) => `${r.page_id}:${r.which}`) : []);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(48501);
const jobs = [];
for (const d of drawn) {
  const meta = path.join(READS, `${d.page_id}.meta.json`);
  if (!fs.existsSync(meta)) continue;
  const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
  const nu = fs.readFileSync(path.join(READS, `${d.page_id}.txt`), 'utf8').trim();
  const img = path.join(READS, `ws-${d.page_id}`, `${d.page_id}.jpg`);
  const pair = [{ which: 'old', text: old[d.page_id] }, ...(nu.length >= 5 && m.exit === 0 ? [{ which: 'new', text: nu }] : [])];
  for (const x of pair) if (!done.has(`${d.page_id}:${x.which}`)) jobs.push({ d, img, ...x });
}
for (let i = jobs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [jobs[i], jobs[j]] = [jobs[j], jobs[i]]; }
console.log(`${jobs.length} verdicts to make`);
const limits = await import('../../../lib/model-limits.mjs');
const state = {};
let k = 0, stop = null;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (!stop && k < jobs.length) {
    const why = await paceCheck(limits, state);
    if (why) { stop = why; break; }
    const job = jobs[k++];
    if (!job) break;
    let buf = fs.readFileSync(job.img);
    if (buf.length > 4e6) { const { default: sharp } = await import('sharp'); buf = await sharp(buf).resize(3000, 3000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(); }
    const r = await judgeAbsolute({ lang: job.d.language, text: job.text }, buf);
    if (r.cls === 'quota') { stop = 'claude quota'; break; }
    fs.appendFileSync(OUT, JSON.stringify({ page_id: job.d.page_id, book: job.d.book, stratum: job.d.stratum, which: job.which, ...r, at: new Date().toISOString() }) + '\n');
    console.log(`  ${job.d.stratum} ${job.d.page_id} ${job.which}: ${r.verdict ? `accept=${r.verdict.accept} f${r.verdict.fidelity} wrong_text=${(r.verdict.defects || []).filter((x) => x.severity === 'wrong_text').length}` : `unparsed ${r.cls ?? ''}`}`);
  }
}));
console.log(stop ? `STOPPED: ${stop}` : 'done');
