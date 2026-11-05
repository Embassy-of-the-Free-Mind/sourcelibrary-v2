#!/usr/bin/env node
// Checks written AFTER the full run was read (#8142). Not pre-registered and deciding nothing; the entry labels them so.
// Forced-choice order balance, Gemini's own read of the arms, and offset vs ranking in the judges' disagreement.
// PRIOR ART: analyze.mjs (frozen) is the pre-registered analysis and has none of these. Run after gunzipping results/ into $OUT.
import fs from 'node:fs';
const O=process.env.OUT||'/root/jobs/wisdom-counsel-8142/out';const rd=f=>fs.readFileSync(f,'utf8').trim().split('\n').map(JSON.parse);
const fk=JSON.parse(fs.readFileSync(O+'/key-forced.json'));
console.log('C shown first',fk.filter(k=>k.one==='C').length,'B shown first',fk.filter(k=>k.one==='B').length);
for(const j of ['opus','gemini']){const v=new Map(rd(`${O}/verdicts-forced-${j}.jsonl`).map(r=>[r.id,r]));
 const t={first:0,second:0,Cwin:0,Bwin:0,CfirstCwin:0,BfirstCwin:0};
 for(const k of fk){const r=v.get(k.blind);const win=r.choice===1?k.one:(k.one==='C'?'B':'C');t[r.choice===1?'first':'second']++;t[win+'win']++;if(win==='C')t[k.one==='C'?'CfirstCwin':'BfirstCwin']++;}
 console.log(j,JSON.stringify(t));}
const opF=new Map(rd(O+'/verdicts-forced-opus.jsonl').map(r=>[r.id,r])),gF=new Map(rd(O+'/verdicts-forced-gemini.jsonl').map(r=>[r.id,r]));
let same=0;for(const k of fk)if(opF.get(k.blind).choice===gF.get(k.blind).choice)same++;console.log('forced judges same pick',same,'of',fk.length);
const R=['f1','f2','f3','f4','f6'],comp=(r,fs_=R)=>fs_.reduce((a,f)=>a+r[f],0)/fs_.length;
const keyF=JSON.parse(fs.readFileSync(O+'/key-full.json')),keyN=JSON.parse(fs.readFileSync(O+'/key-noise.json'));
function load(st,j){const m=new Map(rd(`${O}/verdicts-rubric-${st}-${j}.jsonl`).map(r=>[r.id,r]));return m}
const S={opus:{},gemini:{}};for(const j of ['opus','gemini'])for(const[st,key]of[['full',keyF],['noise',keyN]]){const m=load(st,j);for(const k of key){const r=m.get(k.blind);(S[j][k.dilemma]=S[j][k.dilemma]||{})[k.arm]=r}}
const ds=Object.keys(S.opus);
const pair=(j,a,b,fs_=R)=>{const d=ds.map(x=>comp(S[j][x][a],fs_)-comp(S[j][x][b],fs_));const m=d.reduce((p,c)=>p+c,0)/d.length;let seed=7;const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/2**32;const bs=[];for(let i=0;i<5000;i++){let s=0;for(let n=0;n<d.length;n++)s+=d[Math.floor(rnd()*d.length)];bs.push(s/d.length)}bs.sort((x,y)=>x-y);return `${a}-${b} ${m.toFixed(3)} [${bs[125].toFixed(3)},${bs[4874].toFixed(3)}]`};
for(const j of ['opus','gemini'])console.log(j,'retained:',pair(j,'C','B'),pair(j,'C','M'),pair(j,'M','A'),pair(j,'D','C'),'| A-A2',pair(j,'A','A2'));
const six=['f1','f2','f3','f4','f5','f6'];console.log('opus six facets',pair('opus','C','B',six),pair('opus','C','M',six));
const pear=(x,y)=>{const mx=x.reduce((a,b)=>a+b)/x.length,my=y.reduce((a,b)=>a+b)/y.length;let n=0,dx=0,dy=0;for(let i=0;i<x.length;i++){n+=(x[i]-mx)*(y[i]-my);dx+=(x[i]-mx)**2;dy+=(y[i]-my)**2}return n/Math.sqrt(dx*dy)};
const rank=a=>{const s=[...a].map((v,i)=>[v,i]).sort((p,q)=>p[0]-q[0]);const r=[];for(let i=0;i<s.length;){let k=i;while(k+1<s.length&&s[k+1][0]===s[i][0])k++;for(let m=i;m<=k;m++)r[s[m][1]]=(i+k)/2;i=k+1}return r};
const X=[],Y=[];for(const d of ds)for(const a of ['A','A2','B','C','D','M']){X.push(comp(S.opus[d][a]));Y.push(comp(S.gemini[d][a]))}
console.log('composite 240 answers: pearson',pear(X,Y).toFixed(3),'spearman',pear(rank(X),rank(Y)).toFixed(3),'means',(X.reduce((a,b)=>a+b)/240).toFixed(2),(Y.reduce((a,b)=>a+b)/240).toFixed(2),'gemini at 4.5+',Y.filter(v=>v>=4.5).length);
const diffO=ds.map(d=>comp(S.opus[d].C)-comp(S.opus[d].B)),diffG=ds.map(d=>comp(S.gemini[d].C)-comp(S.gemini[d].B));console.log('C-B per-dilemma correlation across judges',pear(diffO,diffG).toFixed(3));
for(const j of ['opus','gemini']){const v=new Map(rd(`${O}/verdicts-forced-${j}.jsonl`).map(r=>[r.id,r]));const n={B:[0,0,0],C:[0,0,0]};
 for(const k of fk){const r=v.get(k.blind);const w=r.choice===1?k.one:(k.one==='C'?'B':'C');n[w][0]++;if(/concrete|practical|specific|steps|workable|actionable|mechanism/i.test(r.why))n[w][1]++;if(/moraliz|moralis|rhetoric|sermon|preach|lectur/i.test(r.why))n[w][2]++;}
 console.log(j,'reasons [wins, concrete-words, moralising-words]',JSON.stringify(n));}
