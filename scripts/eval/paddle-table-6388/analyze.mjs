// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import fs from 'fs'; import readline from 'readline';
const titles = JSON.parse(fs.readFileSync('titles.json'));
const LAB = JSON.parse(fs.readFileSync('lab-feat.json'));
const labKeys = new Set(LAB.map(r => r.key));
const pop = []; const popByKey = {};
const rl = readline.createInterface({ input: fs.createReadStream('allfeat.jsonl') });
for await (const l of rl) { const r = JSON.parse(l); const o = { key: r.key, bid: r.bid, iss: r.iss, f: r, s: { strict: r.strict, sflags: r.sflags } }; pop.push(o); if (labKeys.has(r.key)) popByKey[r.key] = o; }
// labelled pages take pp from the population row when served
for (const r of LAB) { const p = popByKey[r.key]; if (p && r.f.tables == null) { r.f.tables = p.f.tables; r.f.img = p.f.img; } }
console.log('pop', pop.length, 'labelled with pop row', Object.keys(popByKey).length);
const issCount = {}; for (const p of pop) issCount[p.iss] = (issCount[p.iss] || 0) + 1; console.log('by issue', issCount);
const tbl = pop.filter(p => p.f.tables > 0).length, img = pop.filter(p => p.f.img > 0).length;
console.log('pop tables>0', tbl, 'img>0', img, 'pp null', pop.filter(p => p.f.tables == null).length);
const PRIOR = /三才圖會|武備志|洪範皇極|易學象數論|皇極經世|曆|歷|歴|算|數理精蘊|儀象|星|律呂|樂律|圖說|圖解|易圖|河洛|太乙|六壬|奇門|韻圖|切韻|詞譜/u;
const prior = p => PRIOR.test(titles[p.bid] || p.title || '');
const RULES = {
  'tables>0': p => p.f.tables > 0,
  'img>0': p => p.f.img > 0,
  'strict': p => p.s.strict,
  'repeated_line': p => p.s.sflags.includes('repeated_line'),
  'strict|repeated_line': p => p.s.strict || p.s.sflags.includes('repeated_line'),
  'any guard flag': p => p.s.sflags.length > 0 || p.s.strict,
  'run>=4': p => p.f.run >= 4,
  'run>=5': p => p.f.run >= 5,
  'dup>0': p => p.f.dup > 0,
  'short>=0.4': p => p.f.short >= 0.4,
  'distinct<0.3': p => p.f.distinct < 0.3,
  'top>=0.15': p => p.f.top >= 0.15,
  'prior(title)': prior,
  'cv>=0.8': p => p.f.cv >= 0.8,
};
const combos = {
  'R1 run>=4 | dup>0': p => p.f.run >= 4 || p.f.dup > 0,
  'R2 (strict|repline) & (run>=4|dup>0)': p => (p.s.strict || p.s.sflags.includes('repeated_line')) && (p.f.run >= 4 || p.f.dup > 0),
  'R3 (strict|repline) & (run>=4|dup>0|distinct<0.3)': p => (p.s.strict || p.s.sflags.includes('repeated_line')) && (p.f.run >= 4 || p.f.dup > 0 || p.f.distinct < 0.3),
  'R4 run>=4 | dup>0 | repline': p => p.f.run >= 4 || p.f.dup > 0 || p.s.sflags.includes('repeated_line'),
  'R5 (strict|repline) & (run>=3|dup>0|distinct<0.35|prior)': p => (p.s.strict || p.s.sflags.includes('repeated_line')) && (p.f.run >= 3 || p.f.dup > 0 || p.f.distinct < 0.35 || prior(p)),
};
const inv = LAB.filter(r => r.verdict === 'invented');
const table = LAB.filter(r => r.layout === 'table' || r.layout === 'table?');
const f495 = LAB.filter(r => r.set === 'flagged495');
const qa3 = LAB.filter(r => r.set === 'qa3');
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
const rows = [];
for (const [name, fn] of Object.entries({ ...RULES, ...combos })) {
  const fi = inv.filter(fn).length, ft = table.filter(fn).length;
  const ff = f495.filter(fn); const ffInv = ff.filter(r => r.verdict === 'invented').length; const ffTab = ff.filter(r => r.layout === 'table').length;
  const popN = pop.filter(fn).length;
  const byIss = {}; for (const p of pop) if (fn(p)) byIss[p.iss] = (byIss[p.iss] || 0) + 1;
  rows.push([name, `${fi}/${inv.length} ${pct(fi, inv.length)}`, `${ft}/${table.length} ${pct(ft, table.length)}`, `inv ${pct(ffInv, ff.length)} tab ${pct(ffTab, ff.length)} (n ${ff.length})`, `${qa3.filter(fn).length}/${qa3.length}`, `${popN} ${pct(popN, pop.length)}`, JSON.stringify(byIss)]);
}
console.log(['rule', 'recall invented', 'recall table', 'precision in flagged495', 'qa3 flagged', 'population', 'by issue'].join(' | '));
for (const r of rows) console.log(r.join(' | '));
fs.writeFileSync('lab-feat2.json', JSON.stringify(LAB));
