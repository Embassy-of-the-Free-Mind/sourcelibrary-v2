// worst.js <arm scored dir> <engine> — worst pages per priority cell (engine CER), with lite's CER beside
const fs = require('fs'), path = require('path');
const RES = '/root/sourcelibrary/.claude/worktrees/job-ocr-bakeoff-5660c/scripts/eval/results/open-engine-print-5660';
const [dir, e] = process.argv.slice(2);
const cells = new Map(JSON.parse(fs.readFileSync(RES + '/cells-r3.json')).pages.filter(p => p.cell).map(p => [p.slug, p.cell]));
const rows = [];
for (const f of fs.readdirSync(path.join(RES, dir)).filter(f => /^(eebo|english|ref-ws)/.test(f))) for (const p of JSON.parse(fs.readFileSync(path.join(RES, dir, f))).pages) {
  const c = cells.get(p.slug); if (!['english-1600-1699', 'latin-1500-1699', 'english-1700+'].includes(c)) continue;
  const m = p.engines?.[e], l = p.engines?.['gemini-3.1-flash-lite']; if (!m || typeof m.cer !== 'number') continue;
  rows.push({ c, slug: p.slug, cer: m.cer, lite: l?.cer, loop: m.loop, d: m.cer - (l?.cer ?? 0) });
}
for (const c of ['english-1600-1699', 'latin-1500-1699', 'english-1700+']) {
  const r = rows.filter(x => x.c === c).sort((a, b) => (process.env.BY_D ? b.d - a.d : b.cer - a.cer)).slice(0, 3);
  console.log(c, r.map(x => `${x.slug} ${x.cer.toFixed(3)} (lite ${x.lite?.toFixed(3)})${x.loop ? ' LOOP' : ''}`).join(' | '));
}
