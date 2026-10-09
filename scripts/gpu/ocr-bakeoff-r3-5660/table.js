// table.js [632] — one markdown table across arms from results/open-engine-print-5660/summary-<arm>[-632].json
// (round 1-2 arms from summary.json / summary-olmocr.json, which are on the 632-page map).
const fs = require('fs');
const RES = '/root/sourcelibrary/.claude/worktrees/job-ocr-bakeoff-5660c/scripts/eval/results/open-engine-print-5660';
const v632 = process.argv[2] === '632';
const arms = [
  ['GLM-OCR (0.9B)', 'glm-ocr'], ['dots.ocr (1.7B)', 'dots-ocr'], ['Nanonets-OCR2 (3B)', 'nanonets-ocr2'], ['MinerU2.5-Pro (1.2B)', 'mineru25-pro'],
  ['Kraken CATMuS-Print (CPU)', 'kraken-catmus'], ['Calamari GT4HistOCR, binarized (CPU)', 'calamari-gt4histocr-bin'], ['Calamari GT4HistOCR, grey (CPU; wrong input)', 'calamari-gt4histocr'],
];
const prior = [['olmOCR-2-7B-FP8 (round 2)', 'summary-olmocr.json'], ['PaddleOCR-VL-1.6 (round 1)', 'summary.json']];
const cells = (process.env.CELLS || 'english-1600-1699,latin-1500-1699,english-1700+,latin-1700+,german,greek-print').split(',');
const f3 = x => (x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(3));
const row = (label, s) => {
  if (!s) return null; const e = Object.keys(s.engines)[0]; const out = [label];
  for (const c of cells) {
    const v = s.engines[e][c];
    if (!v || !v.n_pages) { out.push('not run'); continue; }
    const verdict = /ADOPTED/.test(v.verdict || '') ? '**passes**' : /REJECTED/.test(v.verdict || '') ? 'fails' : 'directional';
    const failed = v.checks ? Object.entries(v.checks).filter(([, ok]) => !ok).map(([k]) => k.replace(/_le_.*|_below.*/, '')).join(', ') : '';
    out.push(`${v.engine_cer?.toFixed(3)} (lite ${v.lite_cer?.toFixed(3)}) · Δ ${f3(v.delta)} [${(v.delta_ci95 || []).map(f3).join(', ')}] · ${v.wlt} · cat ${v.catastrophic.engine}/${v.catastrophic.lite} · n ${v.n_pages} (${v.n_library} lib) · ${verdict}${verdict === 'fails' && failed ? ` (${failed})` : ''}`);
  }
  return '| ' + out.join(' | ') + ' |';
};
console.log('| arm | ' + cells.join(' | ') + ' |'); console.log('|' + '---|'.repeat(cells.length + 1));
for (const [label, a] of arms) { const f = `${RES}/summary-${a}${v632 ? '-632' : ''}.json`; if (fs.existsSync(f)) console.log(row(label, JSON.parse(fs.readFileSync(f)))); else console.log(`| ${label} | ${cells.map(() => 'not run').join(' | ')} |`); }
if (v632) for (const [label, f] of prior) console.log(row(label, JSON.parse(fs.readFileSync(`${RES}/${f}`))));
