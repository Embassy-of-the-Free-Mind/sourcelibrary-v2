// PRIOR ART: none — the #6567 pilot's cause split of judge errors; review.mjs scores, this splits. Heuristic: an error is reading-caused when page_says says the reading is wrong or quotes Han not in the Paddle reading.
// node scripts/eval/stale-retranslate-6567/cause-split.mjs (needs $JOB_SCRATCH/review-pilot/judge.jsonl)
import fs from 'node:fs';
const D='scripts/eval/stale-retranslate-6567/';
const map=JSON.parse(fs.readFileSync(D+'pilot-map.json','utf8')).items;
const reqs=new Map(fs.readFileSync(process.env.JOB_SCRATCH+'/review-pilot/judge.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l)).map(r=>[r.uid,r.prompt]));
const parse=t=>{let s=String(t||'');const a=s.indexOf('<<<BEGIN>>>'),b=s.lastIndexOf('<<<END>>>');if(a>=0&&b>a)s=s.slice(a+11,b);const x=s.indexOf('{'),y=s.lastIndexOf('}');try{return JSON.parse(s.slice(x,y+1))}catch{return null}};
const MAT=e=>['mistranslation','omission','addition','untranslated'].includes(e.category)&&['major','critical'].includes(e.severity);
for (const J of ['O','P']) {
  const rows=new Map(fs.readFileSync(D+`reads/pilot-judge-${J}.jsonl`,'utf8').trim().split('\n').map(l=>JSON.parse(l)).map(r=>[r.uid,r]));
  const c={total:0, says_reading_wrong:0, chinese_not_in_reading:0, either:0}; const pages={ocr:new Set(), tr:new Set()};
  for (const m of map) {
    const prompt=reqs.get(m.uid); const reading=prompt.slice(prompt.indexOf('READING:'), prompt.indexOf('===== CANDIDATE'));
    const j=parse(rows.get(m.uid)?.text); const lab=Object.entries(m.labels).find(([,a])=>a==='new')[0];
    for (const e of (j?.candidates?.[lab]?.errors||[]).filter(MAT)) {
      c.total++;
      const says=String(e.page_says||'');
      const a=/transcription|reading|READING|misread|image (reads|says|shows)|clearly/i.test(says);
      const han=(says.match(/\p{Script=Han}{2,}/gu)||[]);
      const R=(reading.match(/\p{Script=Han}/gu)||[]).join(''); const b=han.length>0 && han.some(h=>!R.includes(h));
      if(a)c.says_reading_wrong++; if(b)c.chinese_not_in_reading++; if(a||b){c.either++;pages.ocr.add(m.uid)} else pages.tr.add(m.uid);
    }
  }
  console.log(J, c, 'pages with a reading-caused error', pages.ocr.size, 'pages with a translation-only error', [...pages.tr].filter(x=>!pages.ocr.has(x)).length, 'translation-only errors', c.total-c.either, '/ page', ((c.total-c.either)/30).toFixed(2));
}
