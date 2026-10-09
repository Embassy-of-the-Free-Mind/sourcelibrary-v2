// PRIOR ART: scripts/eval/pareto-6182/opus-arm.mjs (pareto-6182's subscription Opus arm: prompt files + batch lists for subagents); this stages the same for CS/CH under PREREG-claude-arms.md as amended.
// Stage the subscription-subagent Claude arms (#6182): one prompt file per unit, batch lists per arm.
import fs from 'fs'; import crypto from 'crypto';
const D='/root/pareto-claude-sub-6182';
const U=fs.readFileSync('/root/pareto-6182/units.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(u=>u.set!=='tib-rev');
const h=u=>crypto.createHash('sha256').update('6182:'+u.uid).digest('hex');
const pri={'tib-ref58':0,'tib-ref113':1,xl:2};
U.sort((a,b)=>pri[a.set]-pri[b.set]||h(a).localeCompare(h(b)));
fs.mkdirSync(D+'/prompts',{recursive:true});
for(const u of U) fs.writeFileSync(`${D}/prompts/${u.uid}.txt`,u.prompt);
for(const arm of ['CS','CH']){
  fs.mkdirSync(`${D}/${arm}/out`,{recursive:true});fs.mkdirSync(`${D}/${arm}/batches`,{recursive:true});
  let b=[],chars=0,n=0;const flush=()=>{if(!b.length)return;n++;fs.writeFileSync(`${D}/${arm}/batches/${arm}-${String(n).padStart(3,'0')}.txt`,b.join('\n')+'\n');b=[];chars=0};
  for(const u of U){ if(b.length>=10||chars+u.prompt.length>95000) flush(); b.push(`${D}/prompts/${u.uid}.txt ${D}/${arm}/out/${u.uid}.txt`); chars+=u.prompt.length }
  flush(); console.log(arm,n,'batches');
}
fs.writeFileSync(D+'/order.json',JSON.stringify(U.map(u=>({uid:u.uid,set:u.set,lang:u.lang}))));
