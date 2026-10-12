// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import fs from 'fs';
const F = '/mnt/HC_Volume_105839809/jobs/paddle-flagged-6388/w/';
const groups = JSON.parse(fs.readFileSync(F + 'groups.json')).flat();
const byUid = Object.fromEntries(groups.map(g => [g.uid, g]));
const rows = [];
for (const l of fs.readFileSync(F + 'verdicts.jsonl', 'utf8').split('\n').filter(Boolean)) {
  const v = JSON.parse(l);
  for (const x of v.verdicts) {
    const uid = v.uids[x.k - 1]; if (!uid || uid.startsWith('ctl')) continue;
    const g = byUid[uid]; if (!g) { console.error('no group', uid); continue; }
    rows.push({ set: 'flagged495', key: `${g.bid}_${g.pn}`, bid: g.bid, pn: g.pn, title: g.title, run_src: g.run_src, layout: x.layout, verdict: x.verdict, text: g.text, why: x.invented_what || '' });
  }
}
console.log('flagged495', rows.length);
const revs = JSON.parse(fs.readFileSync('contained-revs.json'));
const pn = Object.fromEntries(JSON.parse(fs.readFileSync('contained-pn.json')).map(p => [p.id, p]));
const titles = JSON.parse(fs.readFileSync('titles.json'));
for (const r of revs) { const p = pn[r.page_id]; rows.push({ set: 'contained', key: `${p.bid}_${p.pn}`, bid: p.bid, pn: p.pn, pid: r.page_id, title: titles[p.bid], verdict: 'invented', layout: null, text: r.data, pp: r.engine?.postprocess || null }); }
const Q = '/mnt/HC_Volume_105839809/worktrees/job-table-detect-6388/scripts/eval/paddle-zh-qa-6388/';
const res = JSON.parse(fs.readFileSync(Q + 'results.json'));
const pages = res.pages; console.error('qa3 pages type', Array.isArray(pages), JSON.stringify(pages[0] || Object.values(pages)[0]).slice(0, 400));
for (const l of fs.readFileSync(Q + 'texts.jsonl', 'utf8').split('\n').filter(Boolean)) {
  const t = JSON.parse(l); const [, bid, p] = t.uid.split('|');
  const pr = (Array.isArray(pages) ? pages.find(x => x.uid === t.uid) : pages[t.uid]) || {};
  rows.push({ set: 'qa3', key: `${bid}_${p}`, bid, pn: +p, pid: t.page_id, title: titles[bid], verdict: pr.final || pr.verdict || null, layout: null, text: t.text });
}
fs.writeFileSync('labels.jsonl', rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const by = {}; for (const r of rows) { const k = r.set + '|' + r.layout + '|' + r.verdict; by[k] = (by[k] || 0) + 1; } console.log(by);
