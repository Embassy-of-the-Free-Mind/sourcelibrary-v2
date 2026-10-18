// Librarian citations (#6946) — score the per-link judge labels.
// PRIOR ART: scripts/eval/librarian-speed-6904/score.mjs (pairwise preference + α); this scores per-link labels
// of one answer at a time, so before/after and run-vs-run compare on the same instrument.
//
// Usage: node score.mjs <judge dir> <tag:run> [<tag:run> …]      e.g. before:J1 before:J2 after:J1
// A link is WRONG-PAGE when its label is other or none: the page it names does not say the thing.
// wrong_fact (the linked page is about it, the claim misstates a date, name or attribution) is counted
// apart: no link move can fix it, and the pass never rewrites a claim. `missing` (page not loaded, so not
// judgeable) is left out of every rate.
import fs from 'node:fs';
import path from 'node:path';

const [dir, ...specs] = process.argv.slice(2);
const WRONG = new Set(['other', 'none']);

function load(tag, run) {
  const links = JSON.parse(fs.readFileSync(path.join(dir, `links-${tag}.json`), 'utf8'));
  const out = {};
  for (const [key, ls] of Object.entries(links)) {
    const qid = key.replace(/:.*/, '');
    if (ls.length === 0) { out[qid] = []; continue; }
    const f = path.join(dir, 'out', `${qid}-${tag}-${run}.json`);
    if (!fs.existsSync(f)) { out[qid] = null; continue; }
    const got = JSON.parse(fs.readFileSync(f, 'utf8')).links ?? [];
    const byId = new Map(got.map(l => [l.id, l]));
    out[qid] = ls.map(l => ({ ...l, label: byId.get(l.id)?.label ?? 'unlabelled', otherPage: byId.get(l.id)?.page, note: byId.get(l.id)?.note }));
  }
  return out;
}

const table = [];
const runs = {};
for (const spec of specs) {
  const [tag, run] = spec.split(':');
  const r = load(tag, run);
  runs[spec] = r;
  const counts = { cited: 0, other: 0, none: 0, wrong_fact: 0, missing: 0, unlabelled: 0 };
  let answers = 0, answersWrong = 0, judged = 0, notJudged = 0;
  for (const ls of Object.values(r)) {
    if (ls === null) { notJudged++; continue; }
    answers++;
    let wrong = false;
    for (const l of ls) { counts[l.label] = (counts[l.label] ?? 0) + 1; if (WRONG.has(l.label)) wrong = true; }
    if (wrong) answersWrong++;
    judged += ls.filter(l => l.label !== 'missing' && l.label !== 'unlabelled').length;
  }
  const wrongLinks = counts.other + counts.none;
  table.push({
    spec, answers, links: judged, ...counts, wrongPage: wrongLinks, wrongPageRate: judged ? +(wrongLinks / judged).toFixed(3) : null,
    wrongFactRate: judged ? +(counts.wrong_fact / judged).toFixed(3) : null, answersWrongPage: answersWrong,
  });
}
console.table(table);

// Run-vs-run agreement on the same answers (only meaningful for the same tag).
const keys = Object.keys(runs);
for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
  const [a, b] = [runs[keys[i]], runs[keys[j]]];
  if (keys[i].split(':')[0] !== keys[j].split(':')[0]) continue;
  let n = 0, agree5 = 0, agreeBin = 0, a1 = 0, b1 = 0;
  for (const qid of Object.keys(a)) {
    if (!a[qid] || !b[qid]) continue;
    a[qid].forEach((l, k) => {
      const m = b[qid][k];
      if (!m || l.label === 'missing' || m.label === 'missing') return;
      n++;
      if (l.label === m.label) agree5++;
      const x = WRONG.has(l.label), y = WRONG.has(m.label);
      if (x === y) agreeBin++;
      if (x) a1++;
      if (y) b1++;
    });
  }
  const po = agreeBin / n, pa = a1 / n, pb = b1 / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  console.log(`${keys[i]} vs ${keys[j]}: ${n} links, label agreement ${(agree5 / n).toFixed(2)}, wrong-page agreement ${po.toFixed(2)}, Cohen κ ${((po - pe) / (1 - pe)).toFixed(2)}, wrong-page rate ${pa.toFixed(3)} vs ${pb.toFixed(3)} (|Δ| ${Math.abs(pa - pb).toFixed(3)})`);
}
