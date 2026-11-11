#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/paired-arm.mjs (scores judge verdicts; has no page-type share or per-page
// text noise check) and scripts/eval/lib/metrics.mjs (CER against a reference, not read against read).
// analyze.mjs <reads-dir> <set-S.json> <set-O.json> <out.json>: the model-free half of the v19.2 test (#7263), by the rule
// posted before any read: https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/7263#issuecomment-6709463790
import fs from 'node:fs';
import path from 'node:path';

const [READS, SETS, SETO, OUT] = process.argv.slice(2);
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const read = (dir, id) => { const f = path.join(READS, dir, `${id}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
const typeOf = (t) => t.match(/<page-type>\s*([^<\s]+)\s*<\/page-type>/)?.[1] ?? null;
const body = (t) => t.replace(/<page-type>[^<]*<\/page-type>\s*/, '').trim();
function lev(a, b) {
  const A = [...a], B = [...b]; let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[B.length];
}
const d = (x, y) => { const a = body(x), b = body(y), n = Math.max([...a].length, [...b].length); return n ? lev(a, b) / n : 0; };
const q = (xs, p) => { const s = [...xs].sort((u, v) => u - v); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const median = (xs) => { const s = [...xs].sort((u, v) => u - v); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r3 = (x) => +x.toFixed(3);

const S = load(SETS).map((p) => {
  const a = read('S-v191', p.page_id), c = read('S-v192', p.page_id);
  return { page_id: p.page_id, book_id: p.book_id, title: p.title, kind: p.kind, n: p.n, v191_type: typeOf(a), v192_type: typeOf(c), correct: typeOf(c) === p.kind, chars_v191: a.length, chars_v192: c.length, d: r3(d(a, c)) };
});
const shareNew = (rows, k) => rows.filter((r) => ['musical-score', 'table'].includes(r[k])).length;
const byKind = {};
for (const kind of ['musical-score', 'table']) {
  const rows = S.filter((r) => r.kind === kind);
  const tally = {}; for (const r of rows) tally[r.v192_type] = (tally[r.v192_type] ?? 0) + 1;
  byKind[kind] = { n: rows.length, v192_correct: rows.filter((r) => r.correct).length, v192_types: tally };
}
const O = load(SETO).map((p) => {
  const a = read('O-v191a', p.page_id), b = read('O-v191b', p.page_id), c = read('O-v192', p.page_id);
  return { page_id: p.page_id, book_id: p.book_id, title: p.title, lang: p.lang, kind: p.kind, n: p.n, ta: typeOf(a), tb: typeOf(b), tc: typeOf(c), ab: r3(d(a, b)), ac: r3(d(a, c)), bc: r3(d(b, c)), len: [a.length, b.length, c.length] };
});
const p90 = q(O.map((r) => r.ab), 0.9);
for (const r of O) r.beyond = Math.min(r.ac, r.bc) > Math.max(r.ab, p90);
const out = {
  S: { n: S.length, v191_new_type: shareNew(S, 'v191_type'), v192_new_type: shareNew(S, 'v192_type'), v192_correct: S.filter((r) => r.correct).length, byKind, median_d: r3(median(S.map((r) => r.d))), pages: S },
  O: {
    n: O.length, noise_p90: p90,
    median_ab: r3(median(O.map((r) => r.ab))), median_ac: r3(median(O.map((r) => r.ac))), median_bc: r3(median(O.map((r) => r.bc))),
    tag_new_value_v192: O.filter((r) => ['musical-score', 'table'].includes(r.tc)).map((r) => ({ page_id: r.page_id, kind: r.kind, tc: r.tc })),
    tag_agree_ab: O.filter((r) => r.ta === r.tb).length, tag_agree_ac: O.filter((r) => r.ta === r.tc).length, tag_agree_bc: O.filter((r) => r.tb === r.tc).length,
    beyond: O.filter((r) => r.beyond).sort((x, y) => Math.min(y.ac, y.bc) - Math.min(x.ac, x.bc)).map((r) => r.page_id),
    pages: O,
  },
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const { pages: _s, ...sh } = out.S; const { pages: _o, ...oh } = out.O;
console.log(JSON.stringify({ S: sh, O: oh }, null, 1));
for (const r of S) console.log(r.kind.padEnd(14), String(r.v191_type).padEnd(14), String(r.v192_type).padEnd(14), r.d, r.title?.slice(0, 26));
for (const r of O) console.log(r.kind.padEnd(17), String(r.lang).padEnd(8), `${r.ta}|${r.tb}|${r.tc}`.padEnd(34), r.ab, r.ac, r.bc, r.beyond ? 'BEYOND' : '', r.len.join('/'));
