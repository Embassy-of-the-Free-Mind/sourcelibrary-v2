// PRIOR ART: score-gate.mjs (this directory) — the same reply parser; this one writes the verdicts.
// #6561: fold every review reply (gate-review*.jsonl for the 100 gate pages, all-review-pass*.jsonl for the rest) into
//   checkpoint.jsonl — one row per page: page_id, verdict, invented spans, model, at (the first parseable reply wins) —
//   and, with --apply, into each page's staging doc as `review: {verdict, invented, invented_chars, omitted_chars,
//   misread_chars, note, model, at}`. Planted controls are never written. Writes only paddle_table_corrections_6561.
// Usage (cwd = $JOB_SCRATCH): node --env-file=… record.mjs [--apply]   → prints the counts; writes not-reviewed.json
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { parseReview } from './score-gate.mjs';

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const uidMap = new Map();
for (const m of JSON.parse(fs.readFileSync('gate-sample.json', 'utf8'))) uidMap.set(m.uid, m.page_id);
if (fs.existsSync('all-uids.json')) for (const [uid, pid] of Object.entries(JSON.parse(fs.readFileSync('all-uids.json', 'utf8')))) uidMap.set(uid, pid);
const files = fs.readdirSync('.').filter((f) => /^(gate-review|all-review-pass\d+)\.jsonl$/.test(f)).sort();
const best = new Map(), tried = new Map();
for (const f of files) for (const r of readJsonl(f)) {
  const pid = uidMap.get(r.uid); if (!pid) continue; // controls (g101..g105) are not pages
  tried.set(pid, (tried.get(pid) || 0) + 1);
  if (best.has(pid)) continue;
  const v = parseReview(r.text);
  if (v) best.set(pid, { page_id: pid, verdict: v.verdict, invented: v.invented || [], invented_chars: v.invented_chars ?? null, omitted_chars: v.omitted_chars ?? null, misread_chars: v.misread_chars ?? null, note: v.note ?? null, layout_seen: v.layout ?? null, model: r.model, at: r.date, uid: r.uid, file: f });
}
fs.writeFileSync('checkpoint.jsonl', [...best.values()].map((r) => JSON.stringify(r)).join('\n') + (best.size ? '\n' : ''));
const allPids = [...new Set(uidMap.values())];
const notReviewed = allPids.filter((p) => !best.has(p)).map((p) => ({ page_id: p, replies: tried.get(p) || 0 }));
fs.writeFileSync('not-reviewed.json', JSON.stringify(notReviewed, null, 1));
const split = {}; for (const r of best.values()) split[r.verdict] = (split[r.verdict] || 0) + 1;
console.log(JSON.stringify({ pages_known: allPids.length, reviewed: best.size, verdicts: split, not_reviewed: notReviewed.length, models: [...new Set([...best.values()].map((r) => r.model))] }));
if (process.argv.includes('--apply') && best.size) {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const C = c.db('bookstore').collection('paddle_table_corrections_6561');
  const rows = [...best.values()];
  for (let i = 0; i < rows.length; i += 500) {
    await C.bulkWrite(rows.slice(i, i + 500).map(({ page_id, verdict, invented, invented_chars, omitted_chars, misread_chars, note, model, at }) => ({
      updateOne: { filter: { page_id }, update: { $set: { review: { verdict, invented, invented_chars, omitted_chars, misread_chars, note, model, at: new Date(at), prompt: 'scripts/eval/paddle-table-pilot-6388/review-prompt-pilot.txt', job: 'table-review-6561' } } } },
    })), { ordered: false });
  }
  const n = await C.countDocuments({ 'review.verdict': { $exists: true } });
  await c.close();
  console.log(`staging docs carrying a review: ${n}`);
}
