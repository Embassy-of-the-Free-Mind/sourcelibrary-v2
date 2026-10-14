// NOT RUN (2026-10-14): the gate said NO-GO, so step 2 never started.
// PRIOR ART: sample.mjs (this directory) — the gate's request builder; this builds the same request for every page
// the gate did not review. Usage (cwd = $JOB_SCRATCH): node --env-file=… mkall.mjs → all-req.jsonl, all-uids.json
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { loadChecked, fetchImage, reviewPrompt } from './sample.mjs';

const c = await MongoClient.connect(process.env.MONGODB_URI);
const { ok } = await loadChecked(c.db('bookstore'));
await c.close();
const gate = new Set(JSON.parse(fs.readFileSync('gate-sample.json', 'utf8')).map((m) => m.page_id));
const rest = ok.filter((d) => !gate.has(d.page_id)).sort((a, b) => (a.book_id + String(a.page_number).padStart(6, '0') < b.book_id + String(b.page_number).padStart(6, '0') ? -1 : 1));
fs.mkdirSync('img', { recursive: true });
const rows = [], uids = {}, failed = [];
for (const [i, d] of rest.entries()) {
  let im; try { im = await fetchImage(d.image_url, 'img'); } catch (e) { failed.push({ page_id: d.page_id, error: e.message }); continue; }
  const uid = `a${String(i + 1).padStart(4, '0')}`;
  uids[uid] = d.page_id;
  rows.push({ uid, image: im.file, prompt: reviewPrompt(d.corrected_text) });
  if (i % 500 === 0) console.log(i, '/', rest.length);
}
fs.writeFileSync('all-req.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync('all-uids.json', JSON.stringify(uids));
fs.writeFileSync('all-image-failed.json', JSON.stringify(failed, null, 1));
console.log(`requests ${rows.length} (pages not in the gate sample ${rest.length}; image fetch failed ${failed.length})`);
