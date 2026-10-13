// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import fs from 'fs';
const U = Object.fromEntries(JSON.parse(fs.readFileSync('lab-feat.json')).map(r => [r.key, r]));
const L = Object.fromEntries(fs.readFileSync('labels.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse).map(r => [r.key + '|' + r.set, r]));
const A = Object.fromEntries(fs.readFileSync('align.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse).map(a => [a.key, a]));
const conf = JSON.parse(fs.readFileSync('/mnt/HC_Volume_105839809/jobs/paddle-flagged-6388/w/contain-confirmed.json'));
console.error('confirmed shape', JSON.stringify(conf[0]).slice(0, 200));
const pick = [];
const add = (key, stratum) => { const u = U[key]; if (!u) throw new Error('no ' + key); pick.push({ key, stratum, bid: u.bid, pn: u.pn, title: u.title, layout: u.layout, kanripo: A[key]?.status === 'aligned' && A[key].kanripo_text.length >= 20 }); };
for (const c of conf) add(c.uid, "contained");
const byPb = pb => Object.values(A).find(a => a.ref_pb === pb)?.key;
for (const pb of ['KR3g0012_WYG_003-8a', 'KR3g0012_WYG_003-12b']) add(byPb(pb), 'contained');
for (const pb of ['KR3g0012_WYG_003-7b', 'KR3g0012_WYG_003-4a', 'KR1a0045_WYG_001-14b', 'KR3f0026_WYG_073-35a', 'KR1a0123_WYG_004-48a', 'KR1a0123_WYG_006-71a', 'KR3j0117_WYG_013-2b', 'KR3k0058_WYG_142-4a', 'KR3k0058_WYG_112-13b', 'KR3h0070_WYG_001-14b', 'KR3k0039_WYG_011-56a']) add(byPb(pb), 'invented-unconfirmed');
add('6992ce243ea667fbac8284b0_6', 'invented-unconfirmed');
for (const pb of ['KR3k0020_WYG_040-23b', 'KR1a0045_WYG_001-13b', 'KR1d0087_WYG_083-69a', 'KR3k0018_WYG_001-2a', 'KR3h0019_WYG_001-13b', 'KR3k0033_WYG_007-16a']) add(byPb(pb), 'flagged-clean');
const seen = new Set(); for (const p of pick) { if (seen.has(p.key)) throw new Error('dup ' + p.key); seen.add(p.key); }
pick.forEach((p, i) => { p.uid = `t${String(i + 1).padStart(2, '0')}`; });
fs.writeFileSync('bake.json', JSON.stringify(pick, null, 1));
console.log(pick.length, pick.filter(p => p.kanripo).length, pick.map(p => `${p.uid} ${p.stratum} ${p.kanripo ? 'K' : '-'} ${p.title.slice(0, 20)} p${p.pn}`).join('\n'));
