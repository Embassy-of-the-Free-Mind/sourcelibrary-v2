// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import fs from 'fs'; import readline from 'readline';
const titles = JSON.parse(fs.readFileSync('titles.json'));
const LAB = JSON.parse(fs.readFileSync('lab-feat2.json'));
const pop = [];
for await (const l of readline.createInterface({ input: fs.createReadStream('allfeat.jsonl') })) { const r = JSON.parse(l); if (r.strict || r.sflags.length || r.run >= 4 || r.distinct < 0.35) pop.push({ bid: r.bid, iss: r.iss, f: r, s: { strict: r.strict, sflags: r.sflags } }); }
const PRIOR = /三才圖會|武備志|洪範皇極|易學象數論|皇極經世|曆|歷|歴|算|數理精蘊|儀象|星|律呂|樂律|圖說|圖解|易圖|河洛|太乙|六壬|奇門|韻圖|切韻|詞譜/u;
const prior = p => PRIOR.test(titles[p.bid] || p.title || '');
const rl = p => p.s.sflags.includes('repeated_line');
const R = {
  'strict': p => p.s.strict,
  'T1 strict | (repline & run>=5 & dup>0)': p => p.s.strict || (rl(p) && p.f.run >= 5 && p.f.dup > 0),
  'T2 strict | (repline & run>=4)': p => p.s.strict || (rl(p) && p.f.run >= 4),
  'S1 strict & (run>=4|dup>0|distinct<0.3)': p => p.s.strict && (p.f.run >= 4 || p.f.dup > 0 || p.f.distinct < 0.3),
  'S2 strict & (run>=3|dup>0|distinct<0.35|prior)': p => p.s.strict && (p.f.run >= 3 || p.f.dup > 0 || p.f.distinct < 0.35 || prior(p)),
  'S3 T1 & (run>=3|dup>0|distinct<0.35|prior)': p => (p.s.strict || (rl(p) && p.f.run >= 5 && p.f.dup > 0)) && (p.f.run >= 3 || p.f.dup > 0 || p.f.distinct < 0.35 || prior(p)),
  'S4 T1 & (run>=4|dup>0|distinct<0.3|prior)': p => (p.s.strict || (rl(p) && p.f.run >= 5 && p.f.dup > 0)) && (p.f.run >= 4 || p.f.dup > 0 || p.f.distinct < 0.3 || prior(p)),
  'TAB distinct<0.3 | prior': p => p.f.distinct < 0.3 || prior(p),
  'TAB2 distinct<0.35 | dup>0 | prior': p => p.f.distinct < 0.35 || p.f.dup > 0 || prior(p),
};
const inv = LAB.filter(r => r.verdict === 'invented');
const invT = inv.filter(r => r.layout !== 'prose');
const f495 = LAB.filter(r => r.set === 'flagged495');
const pct = (a, b) => b ? (100 * a / b).toFixed(1) : '-';
const W = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return `${(100 * (c - h)).toFixed(0)}–${(100 * (c + h)).toFixed(0)}`; };
const out = {};
for (const [name, fn] of Object.entries(R)) {
  const fi = inv.filter(fn).length, fit = invT.filter(fn).length;
  const ff = f495.filter(fn);
  const tp = ff.filter(r => r.layout === 'table').length, alltab = f495.filter(r => r.layout === 'table').length;
  const ffInv = ff.filter(r => r.verdict === 'invented').length;
  const n = pop.filter(fn); const by = {}; for (const p of n) by[p.iss] = (by[p.iss] || 0) + 1;
  out[name] = { inv_recall: `${fi}/${inv.length}`, inv_recall_pct: +pct(fi, inv.length), inv_recall_ci: W(fi, inv.length), invT_recall: `${fit}/${invT.length}`, f495_flagged: ff.length, f495_inv_precision: +pct(ffInv, ff.length), f495_table_precision: +pct(tp, ff.length), f495_table_recall: `${tp}/${alltab}`, f495_table_recall_pct: +pct(tp, alltab), qa3: LAB.filter(r => r.set === 'qa3').filter(fn).length, pop: n.length, pop_pct: +pct(n.length, 1568108), by_issue: by };
  console.log(name.padEnd(48), JSON.stringify(out[name]));
}
fs.writeFileSync('rules.json', JSON.stringify(out, null, 1));
// misses for the chosen
for (const r of inv.filter(r => !R['S3 T1 & (run>=3|dup>0|distinct<0.35|prior)'](r))) console.log('S3 MISS', r.key, r.title, r.layout, JSON.stringify({ run: r.f.run, dup: r.f.dup, d: r.f.distinct }), r.why?.slice(0, 100));
for (const r of inv.filter(r => !R['S1 strict & (run>=4|dup>0|distinct<0.3)'](r))) console.log('S1 MISS', r.key, r.title, r.layout, JSON.stringify({ run: r.f.run, dup: r.f.dup, d: r.f.distinct.toFixed(2) }), (r.why || '').slice(0, 90));
