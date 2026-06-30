#!/usr/bin/env node
/**
 * #2880 CUMULATIVE scorer (Rounds 1+2) under the CORRECTED not_applicable rubric,
 * plus the #2885a Tier-0 alignment audit (Round 2 has 13 tier0 catalog matches).
 * Pure measurement — no DB writes, no badge flips.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
const R = 'scripts/eval/results';

const FIRST = new Set(['first_no_prior', 'first_from_source', 'first_complete', 'first_modern']);
const priorClaimed = o => Array.isArray(o.prior_translations_found) && o.prior_translations_found.length > 0;
const priorExists = o => o.verdict === 'not_first' || priorClaimed(o);
// already-English / wordless-art items (manually verified across both rounds)
const ALREADY_ENGLISH = new Set([
  '69aec4473b6ebce5e0ee5929','69b52fab1a04ee0f3b4180e9','699246b3bc722ec0ee81144f',
  '695581a157e3b773024f6989','69b3e686abb796bfd9de42ab','69ea3eb8300d991d0f1d4152',
]);
function corr(o){
  if(!o) return 'MISSING';
  if(FIRST.has(o.verdict)) return 'FIRST';
  if(o.verdict==='not_first') return 'NOT_FIRST';
  if(o.verdict==='unverifiable'||o.verdict==='needs_review') return 'INDET';
  if(o.verdict==='not_applicable'){
    if(ALREADY_ENGLISH.has(String(o.book_id))) return 'NA_ENGLISH';
    if(priorExists(o)) return 'NOT_FIRST';
    return 'FIRST';
  }
  return 'OTHER';
}
const strictCls = v => FIRST.has(v)?'FIRST':v==='not_first'?'NOT_FIRST':v==='not_applicable'?'NA':(v==='unverifiable'||v==='needs_review')?'INDET':'OTHER';

function loadRound(keyFile, gemFile, oracleDir){
  const key = JSON.parse(readFileSync(`${R}/${keyFile}`,'utf8'));
  const gem = new Map(JSON.parse(readFileSync(`${R}/${gemFile}`,'utf8')).map(r=>[String(r.book_id),r]));
  const oracle = new Map();
  for(const f of readdirSync(`${R}/${oracleDir}`).filter(f=>f.endsWith('.json'))){
    const o = JSON.parse(readFileSync(`${R}/${oracleDir}/${f}`,'utf8')); oracle.set(String(o.book_id),o);
  }
  return key.map(k=>{
    const o=oracle.get(String(k.id)), g=gem.get(String(k.id));
    return { ...k, o, g, oCorr:o?corr(o):'MISSING', gStrict:g?strictCls(g.verdict):'MISSING',
             gCorr:g?(g.verdict==='not_applicable'&&ALREADY_ENGLISH.has(String(k.id))?'NA_ENGLISH':g.verdict==='not_applicable'&&!priorExists(g)?'FIRST':strictCls(g.verdict)):'MISSING' };
  });
}

const r1 = loadRound('ft-pilot-r1-scoringkey.json','ft-pilot-r1-gemini.json','r1-oracle');
const r2 = existsSync(`${R}/r2-oracle`) ? loadRound('ft-pilot-r2-scoringkey.json','ft-pilot-r2-gemini.json','r2-oracle') : [];
const all = [...r1, ...r2].filter(r=>r.oCorr!=='MISSING' && r.g);

function wilson(k,n){ if(!n) return [0,0,0]; const z=1.959963985,p=k/n,d=1+z*z/n;
  const c=(p+z*z/(2*n))/d, h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d; return [p,Math.max(0,c-h),Math.min(1,c+h)]; }
const pct=x=>(100*x).toFixed(1)+'%';

console.log(`\n===== #2880 CUMULATIVE (R1+R2), CORRECTED rubric — n=${all.length} (R1=${r1.length}, R2=${r2.length}) =====`);
const strata=[...new Set(all.map(r=>r.stratum))];
console.log('stratum                  n | genuine-FIRST [Wilson95] | not_first | NA(Eng) | indet');
for(const s of [...strata,'__ALL__']){
  const sub = s==='__ALL__'?all:all.filter(r=>r.stratum===s);
  const f=sub.filter(r=>r.oCorr==='FIRST').length, nf=sub.filter(r=>r.oCorr==='NOT_FIRST').length;
  const na=sub.filter(r=>r.oCorr==='NA_ENGLISH').length, ind=sub.filter(r=>r.oCorr==='INDET').length;
  const [p,lo,hi]=wilson(f,sub.length);
  console.log(`${(s==='__ALL__'?'OVERALL':s).padEnd(24)} ${String(sub.length).padStart(2)} | ${String(f).padStart(2)}/${sub.length} = ${pct(p)} [${pct(lo)}–${pct(hi)}] | ${nf} | ${na} | ${ind}`);
}
// badged
const bad=all.filter(r=>r.badged), bf=bad.filter(r=>r.oCorr==='FIRST').length;
const [bp,blo,bhi]=wilson(bf,bad.length);
console.log(`\nBADGED genuine-first (cumulative, corrected): ${bf}/${bad.length} = ${pct(bp)} [${pct(blo)}–${pct(bhi)}]`);
const unb=all.filter(r=>!r.badged), uf=unb.filter(r=>r.oCorr==='FIRST').length;
const [up,ulo,uhi]=wilson(uf,unb.length);
console.log(`UNBADGED genuine-first (cumulative, corrected): ${uf}/${unb.length} = ${pct(up)} [${pct(ulo)}–${pct(uhi)}]`);

// Head-to-head Gemini(corrected-mapped) vs oracle(corrected)
const agree4=all.filter(r=>r.gCorr===r.oCorr).length;
console.log(`\nGemini↔oracle 4-class agreement (corrected map): ${agree4}/${all.length} = ${pct(agree4/all.length)}`);
// Tier-1 precision/recall(first), corrected
const tp=all.filter(r=>r.gCorr==='FIRST'&&r.oCorr==='FIRST').length;
const fp=all.filter(r=>r.gCorr==='FIRST'&&r.oCorr!=='FIRST').length;
const fn=all.filter(r=>r.gCorr!=='FIRST'&&r.oCorr==='FIRST').length;
console.log(`Tier-1 precision(first) ${pct(tp/(tp+fp))} (${tp}/${tp+fp}) · recall(first) ${pct(tp/(tp+fn))} (${tp}/${tp+fn})`);

// ===== #2885a alignment audit (R2 tier0 hits) =====
console.log(`\n===== #2885a Tier-0 ALIGNMENT AUDIT (Round 2 catalog matches) =====`);
const hits = r2.filter(r=>r.tier0 && r.tier0.catalog_id && r.o);
console.log(`Books with a Tier-0 best match: ${hits.length}`);
let trueMerge=0, falseMerge=0;
for(const r of hits){
  const oPrior = priorExists(r.o);
  if(oPrior) trueMerge++; else falseMerge++;
  const flag = oPrior ? 'T' : 'F';
  const lang = (r.language||'').slice(0,8).padEnd(8);
  const t0 = (r.tier0.english_title||'').slice(0,30);
  console.log('  ['+flag+'] '+r.id+' '+lang+' tier0="'+t0+'" oracle='+r.o.verdict);
}
console.log(`Tier-0 precision (catalog match → real prior): ${trueMerge}/${hits.length} = ${pct(trueMerge/(hits.length||1))}  (false merges: ${falseMerge})`);
