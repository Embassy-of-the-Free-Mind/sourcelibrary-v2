// PRIOR ART: scripts/eval/pareto-6182/claude-arms.mjs on eval/pareto-claude-6182 (OpenRouter-billed usage.cost; not usable: subscription only). This prices subagent output at the Anthropic list rate instead.
// API-list-equivalent cost for the subscription Claude arms (#6182).
// Per page: Claude input tokens = k_in × the page's Gemini-counted input tokens (L31 arm, same prompt);
// Claude output tokens = output chars / c_out. k_in and c_out are calibrated on the 3 tib-ref58 pages that the
// stopped OpenRouter job ran through Anthropic's own tokenizer (usage.prompt_tokens / completion_tokens).
// Cross-check: the subagent_tokens Claude Code reports per batch, regressed on the estimate (slope ≈ 1 if right).
import fs from 'fs';
const D='/root/pareto-claude-sub-6182';
const rd=f=>fs.readFileSync(f,'utf8').trim().split('\n').map(JSON.parse);
const FP=Object.fromEntries(rd('/root/pareto-6182/arms/L31.jsonl').map(r=>[r.uid,r]));
const order=JSON.parse(fs.readFileSync(D+'/order.json'));
const PRICE={CS:{in:2,out:10,bin:1,bout:5,model:'claude-sonnet-5-5'},CH:{in:1,out:5,bin:0.5,bout:2.5,model:'claude-haiku-4-5-20251001'}};
const cal={CS:{fmt:'/root/pareto-claude-6182/arms/CS-fmt.jsonl',in:14894,out:2829},CH:{fmt:'/root/pareto-claude-6182/arms/CH-fmt.jsonl',in:12501,out:2046}};
const usage=rd(D+'/usage.jsonl').filter(u=>u.subagent_tokens);
const res={};
for(const a of ['CS','CH']){
  const f=rd(cal[a].fmt); const gin=f.reduce((s,r)=>s+FP[r.uid].in,0); const och=f.reduce((s,r)=>s+r.text.length,0);
  const kin=cal[a].in/gin, cout=och/cal[a].out;
  const rows=[];
  for(const u of order){const text=fs.readFileSync(`${D}/${a}/out/${u.uid}.txt`,'utf8');
    const tin=Math.round(FP[u.uid].in*kin), tout=Math.round(text.length/cout);
    rows.push({uid:u.uid,arm:a,model:`${PRICE[a].model} (subagent, subscription)`,set:u.set,lang:u.lang,text,
      in_est:tin,out_est:tout,usd_list_equiv:(tin*PRICE[a].in+tout*PRICE[a].out)/1e6,usd_batch_equiv:(tin*PRICE[a].bin+tout*PRICE[a].bout)/1e6,usd_billed:0,
      date:'2026-10-07',route:'Claude Code subagent (subscription), ≤10 pages per subagent, prompt byte-for-byte via cat'});}
  fs.writeFileSync(`${D}/${a}.jsonl`,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  // cross-check vs subagent_tokens
  const by=Object.fromEntries(rows.map(r=>[r.uid,r]));const pts=[];
  for(const u of usage.filter(u=>u.batch.startsWith(a))){const uids=fs.readFileSync(`${D}/${a}/batches/${u.batch}.txt`,'utf8').trim().split('\n').map(l=>l.split(' ')[0].split('/').pop().slice(0,-4));
    if(u.batch==='CH-055')continue; const est=uids.reduce((s,x)=>s+by[x].in_est+by[x].out_est,0); pts.push([est,u.subagent_tokens,uids.length]);}
  const n=pts.length,mx=pts.reduce((s,p)=>s+p[0],0)/n,my=pts.reduce((s,p)=>s+p[1],0)/n;
  const b=pts.reduce((s,p)=>s+(p[0]-mx)*(p[1]-my),0)/pts.reduce((s,p)=>s+(p[0]-mx)**2,0), a0=my-b*mx;
  const sub=pts.reduce((s,p)=>s+p[1],0), pages=pts.reduce((s,p)=>s+p[2],0);
  const per=(sel)=>{const r=rows.filter(sel);return {n:r.length,in:Math.round(r.reduce((s,x)=>s+x.in_est,0)/r.length),out:Math.round(r.reduce((s,x)=>s+x.out_est,0)/r.length),list_per_1k:+(1000*r.reduce((s,x)=>s+x.usd_list_equiv,0)/r.length).toFixed(2),batch_per_1k:+(1000*r.reduce((s,x)=>s+x.usd_batch_equiv,0)/r.length).toFixed(2)}};
  res[a]={kin:+kin.toFixed(3),chars_per_out_tok:+cout.toFixed(2),xcheck:{batches:n,intercept:Math.round(a0),slope:+b.toFixed(2),subagent_tokens_total:sub,pages},
    all:per(()=>true),tib:per(r=>r.set.startsWith('tib')),xl:per(r=>r.set==='xl'),
    by_lang:Object.fromEntries([...new Set(rows.map(r=>r.lang))].map(l=>[l,per(r=>r.lang===l)]))};
}
fs.writeFileSync(D+'/cost-summary.json',JSON.stringify(res,null,1));
console.log(JSON.stringify(res,(k,v)=>k==='by_lang'?undefined:v,1));
