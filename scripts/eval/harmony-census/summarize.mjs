// PRIOR ART: scripts/eval/fragment-sort/summarize.mjs (#7065) tallies one classified file; this one writes the census
// tables (#7117): family × century, by language and lemma, earliest witnesses, Chinese loci, and the topos chains.
// Usage: node summarize.mjs <defs.jsonl> <topoi.jsonl> > summary.md
import fs from 'node:fs';

const [DEFS, TOP] = process.argv.slice(2);
const rd = (f) => (f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const defs = rd(DEFS).filter((d) => d.kind === 'definition');
const top = rd(TOP);
const FAMS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];
const NAME = { F1: 'ratio / consonance', F2: 'diversity / opposites in a whole', F3: 'order / rank', F4: 'balance / temperament / mean', F5: 'social concord', F6: 'other' };
const link = (r) => `https://sourcelibrary.org/book/${r.id}?page=${r.p}`;
const cent = (y) => (y == null ? 'undated' : y < 1300 ? 'before 1300' : `${Math.floor(y / 100) + 1}th c.`);
const ORDER = ['before 1300', '14th c.', '15th c.', '16th c.', '17th c.', '18th c.', '19th c.', '20th c.', '21st c.', 'undated'];
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

function table(rows, keyFn, keys, label) {
  const g = new Map();
  for (const r of rows) { const k = keyFn(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  const ks = keys || [...g.keys()].sort();
  console.log(`| ${label} | definitions | books | ${FAMS.map((f) => `${f} ${NAME[f]}`).join(' | ')} | share with F2 |`);
  console.log(`|---|---:|---:|${FAMS.map(() => '---:').join('|')}|---:|`);
  const tot = { n: 0, b: new Set(), f: Object.fromEntries(FAMS.map((f) => [f, 0])) };
  for (const k of ks) {
    const rs = g.get(k); if (!rs) continue;
    const f = Object.fromEntries(FAMS.map((x) => [x, rs.filter((r) => r.fam.includes(x)).length]));
    const books = new Set(rs.map((r) => r.id));
    console.log(`| ${k} | ${rs.length} | ${books.size} | ${FAMS.map((x) => f[x]).join(' | ')} | ${pct(f.F2, rs.length)} |`);
    tot.n += rs.length; books.forEach((b) => tot.b.add(b)); FAMS.forEach((x) => (tot.f[x] += f[x]));
  }
  console.log(`| **all** | ${tot.n} | ${tot.b.size} | ${FAMS.map((x) => tot.f[x]).join(' | ')} | ${pct(tot.f.F2, tot.n)} |\n`);
}

console.log('## A. Definition census\n');
console.log('Unit: one definitional sentence on one page (kind = definition). Families are multi-label, so the family columns sum to more than n. Century = the date of the witness (the edition or manuscript we hold), not of the work.\n');
table(defs, (r) => cent(r.y), ORDER, 'century');
console.log('### By lane (original language; `en-tr` = our English translation where the original did not match)\n');
table(defs, (r) => r.lane.replace('def-', ''), null, 'lane');
console.log('### By lemma\n');
table(defs, (r) => r.lemma, null, 'lemma');
console.log('### By lemma, before 1700 only\n');
table(defs.filter((r) => r.y && r.y < 1700), (r) => r.lemma, null, 'lemma');

console.log('### Earliest dated witnesses per family (originals first; read these by eye)\n');
for (const f of FAMS) {
  const rs = defs.filter((r) => r.fam.includes(f) && r.y).sort((a, b) => a.y - b.y).slice(0, 6);
  console.log(`**${f} ${NAME[f]}**`);
  for (const r of rs) console.log(`- ${r.y} · ${r.lane} · ${(r.a || '').slice(0, 40)} — ${(r.t || '').slice(0, 70)} · [p.${r.p}](${link(r)}) · “${r.sent.slice(0, 220).replace(/\s+/g, ' ')}”`);
  console.log('');
}

const zh = defs.filter((r) => r.lane === 'def-zh');
if (zh.length) {
  console.log('### Chinese: which classical locus each definition of 和 quotes\n');
  const g = {}; for (const r of zh) { const k = r.locus || '(no canonical locus: commentary or other)'; g[k] ??= { n: 0, b: new Set(), f: {} }; g[k].n++; g[k].b.add(r.id); for (const x of r.fam) g[k].f[x] = (g[k].f[x] || 0) + 1; }
  console.log('| locus | definitions | books | families |\n|---|---:|---:|---|');
  for (const [k, v] of Object.entries(g).sort((a, b) => b[1].n - a[1].n)) console.log(`| ${k} | ${v.n} | ${v.b.size} | ${Object.entries(v.f).sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x} ${n}`).join(', ')} |`);
  console.log('');
}

if (top.length) {
  console.log('## B. Five resonance / sympathy topoi\n');
  const CL = ['known-source', 'derivative', 'variant', 'unmatched'];
  console.log(`| topos | tellings | books | earliest witness | ${CL.join(' | ')} |\n|---|---:|---:|---|${CL.map(() => '---:').join('|')}|`);
  const by = {}; for (const t of top) (by[t.topos] ??= []).push(t);
  for (const [k, rs] of Object.entries(by).sort()) {
    const e = rs.filter((r) => r.y).sort((a, b) => a.y - b.y)[0];
    console.log(`| ${k} | ${rs.length} | ${new Set(rs.map((r) => r.id)).size} | ${e ? `${e.y} [${(e.a || '').slice(0, 25)}](${link(e)})` : '–'} | ${CL.map((c) => rs.filter((r) => r.cls === c).length).join(' | ')} |`);
  }
  console.log('');
  for (const [k, rs] of Object.entries(by).sort()) {
    console.log(`### ${k}: sub-types ${Object.entries(rs.reduce((a, r) => ((a[r.sub] = (a[r.sub] || 0) + 1), a), {})).map(([s, n]) => `${s} ${n}`).join('; ')}\n`);
    for (const r of rs.filter((r) => r.y).sort((a, b) => a.y - b.y).slice(0, 25)) console.log(`- ${r.y} · ${r.cls}${r.auth.length ? ` (${r.auth.join(', ')})` : ''}${r.ref ? ` ← ${r.ref}` : ''} · ${(r.a || '').slice(0, 30)} — ${(r.t || '').slice(0, 60)} · [p.${r.p}](${link(r)}) · ${r.sub}`);
    console.log('');
  }
}
