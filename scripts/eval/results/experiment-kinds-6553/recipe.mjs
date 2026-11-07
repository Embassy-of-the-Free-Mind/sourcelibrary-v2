import fs from 'fs'; import {execFileSync} from 'child_process';
const [,, outDir, startB, endB] = process.argv;
const dir='/data/scratch/sl/sourcelibrary/.claude/worktrees/job-experiment-kinds-6553/scripts/eval/experiments/';
const L = fs.readFileSync('entries.jsonl','utf8').trim().split('\n').map(JSON.parse);
const K = Object.fromEntries(fs.readFileSync('labels.jsonl','utf8').trim().split('\n').map(JSON.parse).map(r=>[r.file,r.kind]));
const snip=(t,re)=>{const m=t.match(re);if(!m)return '';const i=m.index;return t.slice(Math.max(0,i-80),i+120).replace(/\s+/g,' ');};
const fmt=o=>{const t=fs.readFileSync(dir+o.file,'utf8');
 const paths=[...new Set([...t.matchAll(/scripts\/[A-Za-z0-9_.\/-]+/g)].map(m=>m[0]))].slice(0,8).join(' ');
 const design=(t.match(/(?:^|\n)#{2,4}\s*(design|method|setup|how)[^\n]*\n([\s\S]{0,700})/i)||[,'',''])[2].replace(/\s+/g,' ');
 return `### ${o.file}\nkind: ${K[o.file]}\nheading: ${o.heading}\nlead: ${o.lead.split(' ').slice(0,120).join(' ')}\ndesign: ${design}\nscripts cited: ${paths}\nsnips: control=[${snip(t,/planted|control/i)}] blind=[${snip(t,/blind/i)}] noise=[${snip(t,/noise floor|A-vs-A|A vs A|test-retest/i)}] batch=[${snip(t,/pages per call|per call|batch size/i)}]\n`;};
const B=40, nb=Math.ceil(L.length/B);
const tax=`RECIPES (the design shape that was run; pick one; use "other:<short-name>" only if none fits):
paired-arm-judge: two or more routes/prompts/settings run on the same pages, outputs scored by a model judge (often Opus against the image)
cer-vs-reference: engines/arms scored by CER/WER or exact match against a reference transcription or edition
screen-with-controls: a detector/gate/screen run over pages, scored against known positives/negatives or planted controls, threshold picked
sample-and-review: random/stratified draw of live books/pages read by a model or human reviewer to estimate a rate (spot check, shelf review)
census-query: database/corpus counts or inventory, no model reading
cause-replay: re-run or trace a failure/incident to find its mechanism
apply-gated-repair: a fix applied to stored data in batches behind a gate, with counts and undo
retrieval-eval: queries against a search/embedding index scored for recall/precision/latency
judge-or-measure-check: compare judges, judge vs human, metric vs truth, judge agreement
cost-meter: measure quota/$/time per call
probe-few: a handful of items tried with a new model or task, no scoring protocol
design-only: a plan or prereg, no run`;
for (let b=+startB; b<Math.min(+endB,nb); b++) {
  const out=`${outDir}/r-${String(b).padStart(2,'0')}.json`; if (fs.existsSync(out)) continue;
  const chunk=L.slice(b*B,(b+1)*B);
  const p=`${tax}

For each Source Library experiment write-up below give:
- recipe: one id from RECIPES
- controls: true if planted items, known positives/negatives, or an A-vs-A control were used; false if not; null if unclear
- judge_blind: true if a model/human judge saw arms unlabelled/shuffled; false if the judge knew which arm; null if no judge or unclear
- noise_floor: true if an A-vs-A / test-retest / same-arm repeat measured the noise; false otherwise
- batch_tested: true if pages-per-call or batch size was varied or tested; false if a batch size was used untested; null if not applicable
- code: "new" if the write-up's run used a script written for this run (a new dir or one-off file), "reused" if it ran an existing shared harness or scripts/eval/lib helper, "unclear"
- main_script: the main script path cited, or null
Output ONLY a JSON array in order: [{"file":"...","recipe":"...","controls":true,"judge_blind":null,"noise_floor":false,"batch_tested":null,"code":"new","main_script":"..."}]

${chunk.map(fmt).join('\n')}`;
  const pf=`${outDir}/r-${b}.prompt`; fs.writeFileSync(pf,p);
  for (let a=0;a<2;a++){ try{ execFileSync('./lean.sh',[pf,out+'.raw'],{timeout:590000});
    const o=JSON.parse(fs.readFileSync(out+'.raw','utf8'));const t=o.result;const arr=JSON.parse(t.slice(t.indexOf('['),t.lastIndexOf(']')+1));
    if(arr.length!==chunk.length) throw new Error('len '+arr.length);
    fs.writeFileSync(out,JSON.stringify({cost:o.total_cost_usd,labels:arr}));console.log('r',b,'ok',o.total_cost_usd);break;
  }catch(e){console.log('r',b,'fail',a,e.message.slice(0,200));}}
}
