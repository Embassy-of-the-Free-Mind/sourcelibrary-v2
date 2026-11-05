// PRIOR ART: guard.mjs report/sample (#7152) and seam-repair.mjs verdicts — this is the job-local script as it ran (job seam-prevent-7118, 2026-10-22..24); paths point at that job's scratch and worktree.
// score the guard's blind Opus samples (job seam-prevent-7118): overall + by translator model, severity, label
import fs from 'fs';
const { verdicts } = await import('/mnt/HC_Volume_105839809/worktrees/job-seam-prevent-7118/scripts/maintenance/seam-repair-6742/seam-repair.mjs');
const rd = f => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const rows = [];
for (const D of process.argv.slice(2)) {
  const v = verdicts(D, 'guard'), cand = new Map(rd(D + '/candidates.jsonl').map(c => [c.id, c]));
  for (const r of rd(D + '/repair-guard.jsonl')) { const x = v[r.id]; if (!x) { rows.push({ D, r, c: cand.get(r.id), missing: true }); continue; } rows.push({ D, r, c: cand.get(r.id), x }); }
  const c = rd(D + '/calls.jsonl'); console.log(D.split('/').pop(), 'opus list $', c.reduce((a, k) => a + (k.usage?.list_usd || 0), 0).toFixed(2), 'A/A', Object.values(v).filter(x => x.aa).map(x => x.aa.join('/')).join(' '));
}
const S = (xs) => { const j = xs.filter(x => x.x); return { n: j.length, prefers: j.filter(x => x.x.prefers).length, worse: j.filter(x => x.x.worse).length, rate: j.length ? +(j.filter(x => x.x.prefers).length / j.length).toFixed(3) : null }; };
const by = (f) => { const o = {}; for (const x of rows) (o[f(x)] ||= []).push(x); return Object.fromEntries(Object.entries(o).map(([k, xs]) => [k, S(xs)])); };
const opusJoin = (x) => /opus/.test(x.c.modelA) || /opus/.test(x.c.modelB);
const out = { all: S(rows), missingVerdict: rows.filter(x => x.missing).length, bySample: by(x => x.D.split('/').pop()), byTranslator: by(x => opusJoin(x) ? 'opus-translated join' : 'gemini-translated join'),
  byModelA: by(x => x.c.modelA), bySeverity: by(x => x.r.severity), byLabel: by(x => x.r.label), excludingOpusJoins: S(rows.filter(x => !opusJoin(x))) };
console.log(JSON.stringify(out, null, 1));
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
