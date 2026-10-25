// PRIOR ART: guard.mjs report/sample (#7152) and seam-repair.mjs verdicts — this is the job-local script as it ran (job seam-prevent-7118, 2026-10-22..24); paths point at that job's scratch and worktree.
// The 48 h dry numbers for #7118 (job seam-prevent-7118): the shadow (branch code, 10-22 21:26 → 10-24 02:21 UTC) and
// the merged guard in the lanes (#7152 on main, after 02:21), pooled and per source. Test-run rows (page ids that are
// not Mongo ids) are dropped.
import fs from 'fs';
const S = process.env.JOB_SCRATCH;
const SRC = { shadow: S + '/shadow-guard', merged: '/mnt/HC_Volume_105839809/seam-guard-6742' };
const END = new Date(process.argv[2] || '2026-10-24T21:26:24Z'), START = new Date('2026-10-22T21:26:24Z');
const rd = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const real = (id) => /^[0-9a-f]{24}$/.test(String(id || ''));
const inWin = (x) => new Date(x.at) >= START && new Date(x.at) <= END;
const count = (xs, f) => xs.reduce((a, x) => { const k = f(x); if (k != null) a[k] = (a[k] || 0) + 1; return a; }, {});
const out = {};
for (const [name, dir] of Object.entries(SRC)) {
  // writes seen: the shadow logged every write it looked at in shadow.log (held-book skips included); the merged guard
  // logs one guard-writes row per write that reached it
  let writes;
  if (name === 'shadow') writes = fs.readFileSync(dir + '/shadow.log', 'utf8').split('\n').filter(l => l.includes('"page":')).map(l => JSON.parse(l.slice(25)));
  else writes = rd(dir + '/guard-writes.jsonl').filter(w => real(w.page) && inWin(w));
  const joins = rd(dir + '/guard.jsonl').filter(j => real(j.trigger) && inWin(j));
  const judged = joins.filter(j => !j.skipped), lab = judged.filter(j => j.label);
  const skippedJoins = joins.filter(j => j.skipped);
  const writeSkips = count(writes.filter(w => w.skipped), w => w.skipped);
  out[name] = {
    writesSeen: writes.length, writeSkips,
    joinsChecked: judged.length, labelled: lab.length, defective: lab.filter(j => j.label !== 'ok').length,
    shareDefective: lab.length ? +(lab.filter(j => j.label !== 'ok').length / lab.length).toFixed(3) : null,
    majors: lab.filter(j => j.severity === 'major').length, accepted: judged.filter(j => j.accepted).length,
    refused: count(judged.filter(j => j.refused), j => j.refused), arms: count(judged, j => j.arm),
    joinsSkippedByReason: count(skippedJoins, j => String(j.skipped).replace(/claude-weekly:.*/, 'claude-weekly-50%')),
    sonnetJoinsByDay: count(judged.filter(j => j.arm === 'sonnet'), j => j.at.slice(0, 10)),
    sonnetListUsd: +judged.filter(j => j.arm === 'sonnet').reduce((a, j) => a + (j.usage?.list_usd || 0), 0).toFixed(2),
  };
}
console.log(JSON.stringify(out, null, 1));
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ window: [START, END], ...out }, null, 1));
