// PRIOR ART: scripts/workers/gpu-print-lane.mjs apply (calls pageVerdict per read and writes to Mongo); this applies the same
// pageVerdict to files only, offline. Usage: JOB_SCRATCH=<dir with fr-out/out> node verdicts.mjs  → $JOB_SCRATCH/fr-verdicts.json
import fs from 'node:fs'; import path from 'node:path';
import { pageVerdict } from '../../../lib/gpu-print-lane.mjs';
const D = process.env.JOB_SCRATCH + '/fr-out/out'; const res = []; const t = {};
for (const bid of fs.readdirSync(D)) for (const f of fs.readdirSync(path.join(D, bid))) {
  if (!f.endsWith('.json')) continue; const r = JSON.parse(fs.readFileSync(path.join(D, bid, f), 'utf8'));
  const v = pageVerdict(r.text, { finish: r.finish }); const k = v.verdict === 'reject' ? v.reason : v.verdict; t[k] = (t[k] || 0) + 1;
  res.push({ bid, pn: Number(f.slice(0, -5)), pid: r.page_id, verdict: v.verdict, reason: v.reason ?? null, chars: (r.text || '').length, url: r.image_url });
}
fs.writeFileSync(process.env.JOB_SCRATCH + '/fr-verdicts.json', JSON.stringify(res)); console.log(t);
