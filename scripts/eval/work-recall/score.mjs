// PRIOR ART: scripts/eval/score-work-gold-set.mjs scores human pair labels; this scores the CLI judge's calls (#7761).
// score judged outputs. usage: node score.mjs frame j-frame.jsonl [liveN] | node score.mjs pairs j-*.jsonl
import fs from 'fs';
const [,, mode, f, LIVE = '70968'] = process.argv;
const rows = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const wilson = (k, n, z = 1.96) => { if (!n) return [0, 0]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+((c - m) / d * 100).toFixed(1), +((c + m) / d * 100).toFixed(1)]; };
const pct = (k, n) => `${k}/${n} = ${(100 * k / n).toFixed(1)}% [${wilson(k, n).join('–')}]`;
if (mode === 'pairs') {
  const t = {}; for (const r of rows) t[r.rel] = (t[r.rel] || 0) + 1; console.log(f, rows.length, t);
  const link = rows.filter(r => ['same_edition', 'same_work', 'translation'].includes(r.rel)).length; console.log(' should share work_id:', pct(link, rows.length));
  const vol = rows.filter(r => r.rel === 'volume_same_set').length; console.log(' volume of same set:', pct(vol, rows.length));
  process.exit(0);
}
const RANK = ['same_edition', 'same_work', 'translation', 'volume_same_set', 'part_or_container', 'unsure', 'different'];
const LINK = new Set(['same_edition', 'same_work', 'translation']);
const grp = r => /^kr:/.test(r.target.work_id || '') ? 'Chinese (Kanripo)' : ({ Latin: 'Latin', English: 'English', German: 'German', French: 'French', Italian: 'Italian' }[r.target.language] || 'other languages');
const best = r => { const ids = new Set(r.candidates.map(c => c.id)); let b = 'different'; for (const c of r.calls || []) if (ids.has(c.id) && RANK.indexOf(c.rel) < RANK.indexOf(b)) b = c.rel; return b; };
const out = { n: rows.length, best: {}, by_group: {} };
for (const r of rows) {
  r._b = best(r); out.best[r._b] = (out.best[r._b] || 0) + 1; const g = grp(r);
  (out.by_group[g] = out.by_group[g] || { n: 0, missed: 0, volume: 0 }).n++;
  if (LINK.has(r._b)) out.by_group[g].missed++; if (r._b === 'volume_same_set') out.by_group[g].volume++;
}
const k = rows.filter(r => LINK.has(r._b)).length, v = rows.filter(r => r._b === 'volume_same_set').length;
const sing = rows.filter(r => r.cluster_size === 1), ks = sing.filter(r => LINK.has(r._b)).length;
console.log(JSON.stringify(out, null, 1));
console.log('books with an unlinked same-work sibling (edition/copy/translation):', pct(k, rows.length), '-> ~', Math.round(+LIVE * k / rows.length), 'live books');
console.log('  among single-book works:', pct(ks, sing.length));
console.log('  among books already in a multi-book work:', pct(k - ks, rows.length - sing.length));
console.log('books with an unlinked volume of the same set:', pct(v, rows.length));
const rel = {}; for (const r of rows) for (const c of r.calls || []) if (LINK.has(c.rel)) rel[c.rel] = (rel[c.rel] || 0) + 1;
console.log('linking calls by relation:', rel);
if (process.env.SHOW) for (const r of rows.filter(r => LINK.has(r._b))) { const c = (r.calls || []).find(c => LINK.has(c.rel)); const cand = r.candidates.find(x => x.id === c.id); console.log(`- ${c.rel}: ${r.target.title?.slice(0, 60)} (${r.target.year}, ${r.target.language}) <> ${cand?.title?.slice(0, 60)} (${cand?.year}, ${cand?.language})`); }
