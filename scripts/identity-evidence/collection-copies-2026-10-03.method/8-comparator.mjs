// Re-score every 2026-10-03 copy pair with the #4285 comparator (scripts/lib/text-copy-comparator.mjs).
// READ-ONLY: reads pages.ocr.data, writes one evidence file. Never edits the original verdict file.
//   node --env-file=.env.production.local scripts/identity-evidence/collection-copies-2026-10-03.method/8-comparator.mjs \
//     [--in scripts/identity-evidence/collection-copies-2026-10-03.jsonl] [--out ...comparator.jsonl] [--clusters /tmp/neg.jsonl]
// --clusters also scores the reviewer's not_same/unsure clusters (A vs each other member) as
// calibration negatives; those rows go to the given side file, not to the evidence file.
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { compareBooks, COMPARATOR_VERSION } from '../../lib/text-copy-comparator.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const IN = arg('in', 'scripts/identity-evidence/collection-copies-2026-10-03.jsonl');
const OUT = arg('out', 'scripts/identity-evidence/collection-copies-2026-10-03.comparator.jsonl');
const CLUSTERS = arg('clusters', null);
const RUN_ID = `comparator-5689-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;

const rows = fs.readFileSync(IN, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const pairs = rows.filter((r) => r.row === 'pair');
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const out = [];
for (const r of pairs) {
  const res = await compareBooks(db, r.keeper_id, r.copy_id);
  out.push({
    schema: 'collection-copy-comparator/1', issue: 5689, cluster_no: r.cluster_no,
    copy_id: r.copy_id, keeper_id: r.keeper_id, pair_status: r.status,
    score: res.score, samples_used: res.samples_used, verdict: res.verdict,
    orientation: res.orientation, other_orientation_score: res.other_orientation_score,
    spot_checked: !!r.spot_check,
    pages_keeper: res.pages_a, pages_copy: res.pages_b, samples: res.samples,
    comparator_version: COMPARATOR_VERSION, run_id: RUN_ID,
  });
}
fs.writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
const tally = {};
for (const o of out) tally[`${o.pair_status}:${o.verdict}`] = (tally[`${o.pair_status}:${o.verdict}`] || 0) + 1;
console.log(RUN_ID, pairs.length, 'pairs', tally);

if (CLUSTERS) {
  const neg = [];
  for (const r of rows.filter((x) => x.row === 'cluster')) {
    const ids = Object.values(r.members).map((m) => m.id);
    for (const id of ids.slice(1)) {
      const res = await compareBooks(db, ids[0], id);
      neg.push({ cluster_no: r.cluster_no, reviewer_verdict: r.reviewer?.verdict, a: ids[0], b: id,
        score: res.score, samples_used: res.samples_used, verdict: res.verdict });
    }
  }
  fs.writeFileSync(CLUSTERS, neg.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const t = {};
  for (const o of neg) t[`${o.reviewer_verdict}:${o.verdict}`] = (t[`${o.reviewer_verdict}:${o.verdict}`] || 0) + 1;
  console.log('clusters', neg.length, t);
}
await c.close();
