// PRIOR ART: zh-punct-8140/score.mjs on PR #8146 (character-restoration scoring of a punctuated copy; not on main, and
// it scores punctuation, not planted sites) and scripts/eval/lib/paired-stats.mjs (bootstrap; used through lib.mjs).
/**
 * #8171 scorer. Reads <priv>/out (arms) and <priv>/judge (task T), writes scripts/eval/results/zh-planted-8171/
 * scores.json and summary.md. Ids, offsets, edit types and outcomes only: no reference text, no model output.
 *   node scripts/eval/zh-planted-8171/score.mjs --priv=DIR
 * Outcomes per edit: follow | revert | neither | unjudged. Follow rate = follow / (follow + revert + neither).
 */
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { fileURLToPath } from 'url';
import { clean, outcomeInCopy, align, diffRatioCI, ratioCI, CATEGORY } from './lib.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const PRIV = argOf('priv');
const RES = path.join(here, '..', 'results', 'zh-planted-8171'); fs.mkdirSync(RES, { recursive: true });
const sample = JSON.parse(fs.readFileSync(path.join(here, 'sample.json'), 'utf8'));
const P = Object.fromEntries(sample.passages.map((p) => [p.slug, p]));
const rec = (slug) => JSON.parse(fs.readFileSync(path.join(PRIV, 'plant', `${slug}.json`), 'utf8'));
const out = (dir, slug) => { const f = path.join(PRIV, 'out', dir, `${slug}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const judged = (kind, slug) => { const f = path.join(PRIV, 'judge', kind, `${slug}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };

// hand labels: passages sorted by slug, edits by offset
const L = fs.readFileSync(path.join(here, 'hand-labels.txt'), 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('').replace(/\s/g, '');
const label = {}; { let i = 0; for (const p of [...sample.passages].sort((a, b) => (a.slug < b.slug ? -1 : 1))) p.edits.forEach((_, k) => { label[`${p.slug}:${k}`] = L[i++]; }); }
const oneInFive = (slug, k) => parseInt(crypto.createHash('sha256').update(`hand:${slug}:${k}`).digest('hex').slice(0, 8), 16) % 5 === 0;

const rows = []; // { slug, group, sub, k, type, cat, label, five, arm, task, outcome, flag }
function addP(arm) {
  for (const p of sample.passages) {
    const o = out(`${arm}-P-edited`, p.slug); if (!o) continue;
    const r = rec(p.slug); const A = [...r.edited]; const O = [...clean(o.answer || '')];
    const pairs = O.length ? align(A, O) : [];
    r.edits.forEach((e, k) => {
      const res = outcomeInCopy(r.edited, e, clean(o.answer || ''), pairs);
      rows.push(base(p, k, e, arm, 'P', res.outcome === 'other' ? 'neither' : res.outcome, null));
    });
  }
}
function base(p, k, e, arm, task, outcome, flag) {
  return { slug: p.slug, group: p.group, sub: p.sub, k, type: e.type, cat: CATEGORY[e.type], label: label[`${p.slug}:${k}`], five: oneInFive(p.slug, k), arm, task, outcome, flag };
}
function readJudge(j, T, k) {
  const v = j.parsed?.[T]?.[String(k + 1)] ?? j.parsed?.[T]?.[k + 1];
  if (!v) return { reading: 'unjudged', flag: null };
  const rd = String(v.reading).toLowerCase();
  const o = j.order[k + 1];
  const reading = rd === '1' ? o.r1 : rd === '2' ? o.r2 : rd === 'neither' ? 'neither' : 'unjudged';
  return { reading, flag: v.flag === true };
}
function addT() {
  for (const p of sample.passages) {
    const j = judged('edited', p.slug); if (!j) continue;
    const r = rec(p.slug);
    for (const [T, arm] of Object.entries(j.labels)) r.edits.forEach((e, k) => {
      const { reading, flag } = readJudge(j, T, k);
      const outcome = reading === 'edited' ? 'follow' : reading === 'orig' ? 'revert' : reading;
      rows.push(base(p, k, e, arm, 'T', outcome, flag));
    });
  }
}
for (const a of ['G', 'G2', 'O']) addP(a);
addT();

const units = (rs, num = (x) => x.outcome === 'follow') => {
  const by = new Map();
  for (const x of rs) { if (x.outcome === 'unjudged') continue; const u = by.get(x.slug) || [0, 0]; u[0] += num(x) ? 1 : 0; u[1] += 1; by.set(x.slug, u); }
  return [...by.values()];
};
const GROUPS = { A: (x) => x.group === 'A', B: (x) => x.group === 'B', 'B-strict': (x) => x.group === 'B' && x.sub !== 'kanripo-screen', 'B-ext': (x) => x.group === 'B' && x.sub === 'kanripo-screen', C: (x) => x.group === 'C' };
const pct = (v) => (v == null || !Number.isFinite(v) ? '–' : (100 * v).toFixed(1));
const ci = (c) => `[${pct(c[0])}, ${pct(c[1])}]`;
function cell(rs) {
  const n = { follow: 0, revert: 0, neither: 0, unjudged: 0 }; for (const x of rs) n[x.outcome] += 1;
  const f = ratioCI(units(rs)), rv = ratioCI(units(rs, (x) => x.outcome === 'revert'));
  return { n, judged: n.follow + n.revert + n.neither, passages: new Set(rs.map((x) => x.slug)).size, follow: f.rate, follow_ci: f.ci, revert: rv.rate, revert_ci: rv.ci };
}
const res = { issue: 8171, made_at: new Date().toISOString(), cells: {}, gaps: {}, decision: {} };
const filters = { all: () => true, clean: (x) => x.label === 'o', five: (x) => x.five, neg: (x) => x.cat === 'neg', num: (x) => x.cat === 'num', name: (x) => x.cat === 'name' };
const subsetSlugs = new Set(sample.passages.filter((p) => p.subset).map((p) => p.slug));
const sets = { all: () => true, subset: (x) => subsetSlugs.has(x.slug) };
for (const arm of ['G', 'G2', 'O']) for (const task of ['P', 'T']) for (const [sn, sf] of Object.entries(sets)) {
  if (arm !== 'G' && sn === 'all') continue;
  const rs0 = rows.filter((x) => x.arm === arm && x.task === task && sf(x)); if (!rs0.length) continue;
  for (const [fn, ff] of Object.entries(filters)) {
    const rs = rs0.filter(ff); const key = `${arm}/${task}/${sn}/${fn}`;
    res.cells[key] = Object.fromEntries(Object.entries(GROUPS).map(([g, gf]) => [g, cell(rs.filter(gf))]));
    const gu = (g) => units(rs.filter(GROUPS[g]));
    res.gaps[key] = Object.fromEntries([['A-C', 'A', 'C'], ['B-C', 'B', 'C'], ['Bstrict-C', 'B-strict', 'C'], ['Bext-C', 'B-ext', 'C'], ['A-B', 'A', 'B']].map(([n, a, b]) => [n, diffRatioCI(gu(a), gu(b))]));
  }
}
// decision (G, all passages, all edits, per task)
for (const task of ['P', 'T']) {
  const g = res.gaps[`G/${task}/all/all`]; if (!g) continue;
  const fires = g['A-C'].ci[1] < 0;
  const bc = g['B-C'];
  const upper = fires && bc.diff <= -0.10 && bc.ci[1] < 0;
  res.decision[task] = { A_fires: fires, A_minus_C: g['A-C'], B_minus_C: bc, branch: !fires ? 'cannot fire' : upper ? 'upper bounds' : 'keep' };
}
// flags (T): rate of flagged sites, by outcome
res.flags = {};
for (const arm of ['G', 'G2', 'O']) for (const [g, gf] of Object.entries(GROUPS)) {
  const rs = rows.filter((x) => x.arm === arm && x.task === 'T' && gf(x) && x.outcome !== 'unjudged'); if (!rs.length) continue;
  const by = (o) => { const s = rs.filter((x) => x.outcome === o); return { n: s.length, flagged: s.filter((x) => x.flag).length }; };
  res.flags[`${arm}/${g}`] = { sites: rs.length, flagged: rs.filter((x) => x.flag).length, follow: by('follow'), revert: by('revert'), neither: by('neither') };
}
// judge gate: baselines (truth = orig) and wrong-passage (truth = neither)
{
  const g = { baseline: { sites: 0, orig: 0, edited: 0, neither: 0, unjudged: 0 }, wrong: { sites: 0, orig: 0, edited: 0, neither: 0, unjudged: 0 } };
  for (const kind of ['baseline', 'wrong']) {
    const dir = path.join(PRIV, 'judge', kind); if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const r = rec(j.slug);
      r.edits.forEach((_, k) => { const { reading } = readJudge(j, 'T1', k); g[kind].sites++; g[kind][reading]++; });
    }
  }
  const b = g.baseline, w = g.wrong;
  res.judge_gate = { ...g, baseline_true: b.sites ? b.orig / b.sites : null, baseline_other: b.sites ? b.edited / b.sites : null, wrong_neither: w.sites ? w.neither / w.sites : null };
  res.judge_gate.pass = res.judge_gate.baseline_true >= 0.85 && res.judge_gate.baseline_other <= 0.05 && res.judge_gate.wrong_neither >= 0.80;
}
// P baseline drift: unedited copies, did the output keep the original at the sites?
{
  const d = { sites: 0, kept: 0, changed: 0, unjudged: 0 };
  for (const p of sample.passages.filter((x) => x.baseline)) {
    const o = out('G-P-orig', p.slug); if (!o) continue;
    const r = rec(p.slug);
    r.edits.forEach((e) => {
      const site = { pos: e.at, lenEdited: [...e.before].length, after: e.before, before: e.after };
      const x = outcomeInCopy(r.text, site, clean(o.answer || ''));
      d.sites++; d[x.outcome === 'follow' ? 'kept' : x.outcome === 'unjudged' ? 'unjudged' : 'changed']++;
    });
  }
  res.p_baseline_drift = d;
}
// G2 vs G agreement on the subset (same site, same task)
res.g2_agreement = {};
for (const task of ['P', 'T']) {
  const key = (x) => `${x.slug}:${x.k}`;
  const g = new Map(rows.filter((x) => x.arm === 'G' && x.task === task).map((x) => [key(x), x.outcome]));
  const pairs = rows.filter((x) => x.arm === 'G2' && x.task === task && g.has(key(x))).map((x) => [g.get(key(x)), x.outcome]);
  res.g2_agreement[task] = { sites: pairs.length, same: pairs.filter(([a, b]) => a === b).length, g_follow: pairs.filter(([a]) => a === 'follow').length, g2_follow: pairs.filter(([, b]) => b === 'follow').length };
}
// per-site rows without text
res.rows = rows.map(({ slug, group, sub, k, type, label: l, arm, task, outcome, flag }) => ({ slug, group, sub, k, type, label: l, arm, task, outcome, flag }));
fs.writeFileSync(path.join(RES, 'scores.json'), JSON.stringify(res, null, 1));

// summary
let md = `# #8171 scores (generated by score.mjs, ${res.made_at.slice(0, 10)})\n\nFollow rate % [95 % passage-bootstrap CI] (judged edits / passages). Revert % alongside.\n\n`;
for (const [key, cs] of Object.entries(res.cells)) {
  md += `## ${key}\n\n| group | follow | revert | neither | judged / passages |\n|---|---|---|---|---|\n`;
  for (const [g, c] of Object.entries(cs)) md += `| ${g} | ${pct(c.follow)} ${ci(c.follow_ci)} | ${pct(c.revert)} ${ci(c.revert_ci)} | ${c.n.neither} | ${c.judged} / ${c.passages} |\n`;
  md += '\n' + Object.entries(res.gaps[key]).map(([n, d]) => `${n}: ${pct(d.diff)} ${ci(d.ci)}`).join(' · ') + '\n\n';
}
md += `## Decision (G, all)\n\n\`\`\`\n${JSON.stringify(res.decision, null, 1)}\n\`\`\`\n\n## Judge gate\n\n\`\`\`\n${JSON.stringify(res.judge_gate, null, 1)}\n\`\`\`\n\n`;
md += `## Flags\n\n\`\`\`\n${JSON.stringify(res.flags, null, 1)}\n\`\`\`\n\n## P baseline drift\n\n\`\`\`\n${JSON.stringify(res.p_baseline_drift)}\n\`\`\`\n\n## G2 vs G\n\n\`\`\`\n${JSON.stringify(res.g2_agreement)}\n\`\`\`\n`;
fs.writeFileSync(path.join(RES, 'summary.md'), md);
console.log(md.slice(0, 6000));
