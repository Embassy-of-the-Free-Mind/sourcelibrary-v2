// PRIOR ART: score.mjs in this folder (totals per arm); this adds the paired per-page sign tests and the repeat noise
// for the note measures of the T10 note-rule test (v3#44).
//   node scripts/eval/error-zoo/t10-note-test/paired-notes.mjs RUN_DIR
import fs from 'node:fs';
import { binomTwoSided as binom } from '../../lib/paired-stats.mjs';

const R = process.argv[2];
if (!R) { console.error('RUN_DIR required'); process.exit(2); }
const key = JSON.parse(fs.readFileSync(`${R}/key.json`, 'utf8')).rows;
const rv = (id) => JSON.parse(fs.readFileSync(`${R}/readers/opus/reviews/${id}.json`, 'utf8'))[0].pages[0];
const by = {};
for (const r of key.filter((r) => r.kind === 'item')) { (by[r.page_id] ||= { s: r.stratum })[r.arm] = rv(r.id); }
const m = (p, f) => {
  const it = p.notes_audit?.items || [];
  if (f === 'helpful') return it.filter((x) => x.verdict === 'ok' && x.helpful).length;
  if (f === 'missing') return (p.notes_audit?.missing || []).length;
  return it.filter((x) => x.verdict === f).length;
};
for (const f of ['helpful', 'missing', 'unsupported', 'wrong'])
  for (const s of ['t10', 'clean-with-notes', null]) {
    const P = Object.values(by).filter((x) => !s || x.s === s);
    const up = P.filter((x) => m(x.B, f) > m(x.A, f)).length, down = P.filter((x) => m(x.B, f) < m(x.A, f)).length;
    console.log(f, s || 'all', `B>A ${up}  B<A ${down}  tie ${P.length - up - down}  p=${binom(Math.min(up, down), up + down).toFixed(4)}`);
  }
// The same reader on the same arm-A text, twice: how far the note measures move on identical input.
for (const r of key.filter((r) => r.kind === 'repeat')) {
  const a = rv(key.find((k) => k.kind === 'item' && k.arm === 'A' && k.page_id === r.page_id).id), b = rv(r.id);
  console.log('repeat', r.page_id.slice(-6), 'helpful', m(a, 'helpful'), m(b, 'helpful'), 'missing', m(a, 'missing'), m(b, 'missing'), 'unsupported', m(a, 'unsupported'), m(b, 'unsupported'));
}
