// PRIOR ART: scripts/eval/route-judge-6740/defect-rate.py (the per-1,000-words measure the experiments header asks
// for). It reads a defect-rate.mjs inventory of visible-book lanes; this cell test's items live in its own packet/key
// files under $JOB_SCRATCH, so the same three numbers are computed here from them: misleads and wrong_text defects per
// 1,000 words of the judged text, and mean fidelity, per cell (item pages only; controls and plants excluded).
//   node scripts/eval/route-judge-6740/jcb-1600-8049/defect-rates.mjs DIR... > results/defect-rates.json
import fs from 'node:fs';
import path from 'node:path';

const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const cells = {};
for (const dir of process.argv.slice(2)) {
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));
  const items = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'packet.json'), 'utf8')).items.map((i) => [i.id, i]));
  const V = new Map(jsonl(path.join(dir, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  for (const k of key.filter((k) => k.kind === 'item' && V.has(k.judged_as))) {
    const v = V.get(k.judged_as), words = String(items.get(k.judged_as)?.text || '').split(/\s+/).filter(Boolean).length;
    const c = (cells[`${k.cell}|${k.route}`] ??= { cell: k.cell, route: k.route, dirs: new Set(), pages: 0, words: 0, misleads: 0, wrong_text: 0, fid: 0 });
    c.dirs.add(path.basename(dir)); c.pages++; c.words += words; c.fid += Number(v.fidelity) || 0;
    for (const d of v.defects || []) { if (d.severity === 'misleads') c.misleads++; if (d.severity === 'wrong_text') c.wrong_text++; }
  }
}
const out = Object.values(cells).map((c) => ({ cell: c.cell, route: c.route, draws: [...c.dirs], pages: c.pages, words: c.words,
  misleads_per_1k_words: +(1000 * c.misleads / c.words).toFixed(2), wrong_text_per_1k_words: +(1000 * c.wrong_text / c.words).toFixed(2),
  mean_fidelity: +(c.fid / c.pages).toFixed(2) }));
console.log(JSON.stringify({ issue: 8049, measured: new Date().toISOString().slice(0, 10), note: 'written pages judged; one page a book; blind Opus', routes: out }, null, 1));
