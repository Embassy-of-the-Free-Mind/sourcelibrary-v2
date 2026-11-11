#!/usr/bin/env node
// PRIOR ART: scripts/eval/engine-wave2-6011/build-bench.mjs — builds the wave-2 bench from sets.json minus each engine's
// wave-1 reads; this needs every page of the Latin set at once, and gathers images and comparator outputs from
// both wave benches already on this box (no re-export). #6011 pennies test.
//   node scripts/eval/cheap-vlm-latin-6011/build-bench.mjs   (BENCH=<out dir>, default $JOB_SCRATCH/bench)
import fs from 'fs'; import path from 'path';
const S = JSON.parse(fs.readFileSync('/root/engine-wave2-6011/sets.json','utf8')).latin.pages;
const B = process.env.BENCH || `${process.env.JOB_SCRATCH}/bench`;
const TREES = ['/root/engine-wave2-6011/bench','/root/engine-wave1-6011/bench','/root/ocr-bench-5660','/root/ocr-bench/images'];
const imgDirs = st => [...TREES.map(t=>path.join(t,st)), st==='latin-period-5126' ? '/root/engine-wave2-6011/_export' : null, st==='latin-period-5126' ? '/root/engine-wave1-6011/bench/_export':null].filter(Boolean);
const byS = {}; for (const k of S) { const [st, s] = k.split('|'); (byS[st] ??= []).push(s); }
const missing = []; const outCount = {};
for (const [st, slugs] of Object.entries(byS)) {
  const dir = path.join(B, st); fs.mkdirSync(dir, { recursive: true });
  const have = [];
  for (const s of slugs) {
    const src = imgDirs(st).map(d=>path.join(d,`${s}.jpg`)).find(f=>fs.existsSync(f));
    if (!src) { missing.push(`${st}|${s}`); continue; }
    fs.copyFileSync(src, path.join(dir, `${s}.jpg`)); have.push(s);
    for (const d of imgDirs(st)) { const od = path.join(d,'out'); if (!fs.existsSync(od)) continue;
      for (const e of fs.readdirSync(od)) { const f = path.join(od,e,`${s}.txt`); if (!fs.existsSync(f)) continue;
        const dd = path.join(dir,'out',e); fs.mkdirSync(dd,{recursive:true}); const dst=path.join(dd,`${s}.txt`);
        if (!fs.existsSync(dst)) { fs.copyFileSync(f,dst); outCount[e]=(outCount[e]||0)+1;
          const m = path.join(od,e,'_meter.jsonl'); if (fs.existsSync(m)) { const rows=fs.readFileSync(m,'utf8').split('\n').filter(l=>l.includes(`"${s}"`)); if (rows.length) fs.appendFileSync(path.join(dd,'_meter.jsonl'), rows.join('\n')+'\n'); } } } }
  }
  fs.writeFileSync(path.join(dir,'manifest.json'), JSON.stringify({ stratum: st, drawn_by: 'cheap-vlm-latin-6011: wave-2 Latin most-pages set (sets.json latin, 158)', pages: have.map(slug=>({slug})) }, null, 1));
  console.log(st, slugs.length, 'have', have.length);
}
console.log('missing', missing); console.log(outCount);
