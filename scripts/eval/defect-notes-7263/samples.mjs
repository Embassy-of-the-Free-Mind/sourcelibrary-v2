// PRIOR ART: scripts/eval/defect-notes-7263/rollup.mjs (this job) — same rows and frames; this only prints notes to read.
/**
 * Print a seeded sample of serious notes for one class (one note per book), for reading by eye.
 *   node scripts/eval/defect-notes-7263/samples.mjs <class> [n=50] [frame=served|arms|all] [task=ocr|translation]
 * Output stays in $JOB_SCRATCH (the notes quote page text; the repo is public).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { makeRng } from '../lib/paired-stats.mjs';
const [cls, n = '50', frame = 'served', task = ''] = process.argv.slice(2);
const SERVED = new Set(['confidence-7866', 'test:judged-expand-7263']);
const rows = zlib.gunzipSync(fs.readFileSync(`${process.env.JOB_SCRATCH}/rows.jsonl.gz`)).toString().split('\n').map(JSON.parse)
  .filter((r) => !String(r.instrument || '').startsWith('step-t'))
  .filter((r) => frame === 'all' || (frame === 'served') === SERVED.has(r.lane))
  .filter((r) => !task || (r.task === 'translation') === (task === 'translation'));
const notes = [];
for (const r of rows) for (const d of r.defects) if (d.class === cls && d.severity !== 'cosmetic') notes.push({ r, d });
const rng = makeRng(7263); for (let i = notes.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [notes[i], notes[j]] = [notes[j], notes[i]]; }
const seen = new Set(); let k = 0;
for (const { r, d } of notes) { if (seen.has(r.book_id)) continue; seen.add(r.book_id); if (k++ >= +n) break;
  console.log(`${r.id} | ${r.lang}|${r.script_type}|${r.route}|${d.severity} | Q: ${d.quote.slice(0, 80).replace(/\n/g, ' ')} | W: ${d.what.slice(0, 260).replace(/\n/g, ' ')}`); }
console.error(`${notes.length} serious ${cls} notes in frame ${frame}${task ? ' ' + task : ''}`);
