#!/usr/bin/env node
// Human-typed pages through the rubric ladder (#7263 route-free analyses, section 8). No model calls; reads committed
// verdict files only and changes no grade.
//
// PRIOR ART: scripts/eval/confidence-7866/regrade.mjs — gradeOf() is the ladder, imported unchanged. It grades the
// #7866 served pages; this applies the same function to the human-typed arms already judged in
// scripts/eval/judge-cal-7866bar-7263/results (the #7866-bar human arm, and the #7941 three-way arms), beside the
// machine pages of the same study, raw and with adjudicated false flags removed.
//
//   node scripts/eval/route-free-7263/human_grades.mjs [--out file.json]
import fs from 'node:fs';
import { gradeOf, GRADES, bucketOf } from '../confidence-7866/regrade.mjs';

const R = 'scripts/eval/judge-cal-7866bar-7263/results/';
const jl = (f) => fs.readFileSync(R + f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const SEVERE = new Set(['misleads', 'wrong_text']);

// A flag is dropped as false when an adjudicator says the typed (or read) text is right at that point. Two readings:
// 'any' drops it when either adjudicator says so; 'confirmed' keeps only flags every adjudicator calls wrong.
function strip(v, verdictsFor) {
  const out = { any: [], confirmed: [] };
  (v.defects || []).forEach((d, i) => {
    if (!SEVERE.has(d.severity)) { out.any.push(d); out.confirmed.push(d); return; }
    const vs = verdictsFor(d, i);
    if (!vs.includes('typed_right')) out.any.push(d);
    if (vs.length && vs.every((x) => x === 'typed_wrong')) out.confirmed.push(d);
  });
  return { any: { ...v, defects: out.any }, confirmed: { ...v, defects: out.confirmed } };
}

const tally = (vs) => Object.fromEntries(GRADES.map((g) => [g, vs.filter((v) => gradeOf(v) === g).length]));
const buckets = (vs) => vs.reduce((m, v) => ((m[bucketOf(gradeOf(v))] = (m[bucketOf(gradeOf(v))] || 0) + 1), m), {});

// 1. #7866-bar: 60 print pages (de, la, en), human-typed edition and the machine read, same judge prompt.
const human = jl('verdicts-human.jsonl');
const uids = new Set(human.map((v) => v.uid));
const machine = jl('verdicts.jsonl').filter((v) => v.set === 'item' && uids.has(v.uid));
// adjudications.jsonl: per page, per judge, the severe points in the page's flag order (class + severity match)
const adj = {};
for (const a of jl('adjudications.jsonl')) (adj[a.uid] ||= []).push(a);
const humanAdj = human.map((v) => strip(v, (d, i) => {
  const sev = (v.defects || []).map((x, j) => [x, j]).filter(([x]) => SEVERE.has(x.severity));
  const pos = sev.findIndex(([, j]) => j === i);
  return (adj[v.uid] || []).map((a) => a.points?.[pos]?.verdict).filter(Boolean);
}));
const bar = {
  pages: human.length, machine_pages: machine.length,
  adjudicated_pages: Object.keys(adj).length,
  human_raw: tally(human), human_any_false_flag_removed: tally(humanAdj.map((x) => x.any)),
  human_confirmed_only: tally(humanAdj.map((x) => x.confirmed)),
  machine_raw: tally(machine),
  buckets: { human_raw: buckets(human), human_confirmed_only: buckets(humanAdj.map((x) => x.confirmed)), machine_raw: buckets(machine) },
  by_language: Object.fromEntries(['ge', 'la', 'en'].map((l) => [l, {
    human_raw: tally(human.filter((v) => v.uid.startsWith(l))), machine_raw: tally(machine.filter((v) => v.uid.startsWith(l))) }])),
};

// 2. #7941 three-way: human, ours, archive on the same pages; adjudications keyed `<arm>-<uid>#<defect index>`.
const tv = jl('three-way-verdicts.jsonl');
// adjudication ran on 46 pages (all arms of a page together, seeded order, until the Opus cap): the stripped grades
// are reported on those pages only, beside the raw grades of the same pages, so an unadjudicated flag is not dropped.
const tadj = {}, tpages = new Set();
for (const a of jl('three-way-adjudications.jsonl')) { tpages.add(a.uid); for (const p of a.points || []) (tadj[p.key] ||= []).push(p.verdict); }
const arms = {};
for (const arm of ['human', 'ours', 'archive']) {
  const vs = tv.filter((v) => v.arm === arm);
  const va = vs.filter((v) => tpages.has(v.uid));
  const st = va.map((v) => strip(v, (d, i) => (tadj[`${arm}-${v.uid}#${i}`] || []).filter(Boolean)));
  arms[arm] = { pages: vs.length, raw: tally(vs), adjudicated_pages: va.length, adjudicated_raw: tally(va),
    adjudicated_any_false_flag_removed: tally(st.map((x) => x.any)), adjudicated_confirmed_only: tally(st.map((x) => x.confirmed)),
    severe_flags: vs.reduce((n, v) => n + (v.defects || []).filter((d) => SEVERE.has(d.severity)).length, 0),
    severe_flags_adjudicated: vs.reduce((n, v) => n + (v.defects || []).filter((d, i) => SEVERE.has(d.severity) && tadj[`${arm}-${v.uid}#${i}`]).length, 0) };
}
const res = { bar7866: bar, three_way_7941: arms };
const out = process.argv.indexOf('--out');
if (out > 0) fs.writeFileSync(process.argv[out + 1], JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
