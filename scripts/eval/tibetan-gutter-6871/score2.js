// PRIOR ART: scripts/eval/tibetan-proofread/score.mjs scores syllable identity against a full reference; this run has a structural reference (line counts) plus per-line check verdicts, so it counts verdicts instead. Ran in the job dir (refA.jsonl = references-A.jsonl, reads/arm-*/ = the reads in reads-and-checks.jsonl.gz).
// score2.js <arm> — prereg criteria, strict (verdicts as marked) and with blank-markers excluded (post hoc).
const fs=require("fs");const arm=process.argv[2];
const V=fs.readFileSync(`verdict-${arm}.jsonl`,"utf8").split("\n").filter(Boolean).map(JSON.parse);
const R=Object.fromEntries(fs.readFileSync("refA.jsonl","utf8").split("\n").filter(Boolean).map(l=>{const o=JSON.parse(l);return[o.id,o]}));
const MARK=/^\s*(empty page|ཤོག་སྟོང[་།]*)\s*$/i;
for(const mode of ["strict","markers-excluded"]){
 let inv=0,refL=0,drop=0,clean=0,okm=0,readBody=0,markers=0;const bad=[];
 for(const v of V){const lines=fs.readFileSync(`reads/arm-${arm==="page"?"page":"bands"}/${v.id}.txt`,"utf8").replace(/\n+$/,"").split("\n");
  let vs=v.line_verdicts; if(vs.length!==lines.length) bad.push(`${v.id} verdicts ${vs.length} != lines ${lines.length}`);
  if(mode!=="strict"){vs=vs.filter((x,i)=>!MARK.test(lines[i]||""));}
  markers+=lines.filter(l=>MARK.test(l)).length;
  const c=k=>vs.filter(x=>x===k).length;const ref=R[v.id].body_lines;refL+=ref;drop+=Math.min(v.dropped_body_lines,ref);
  if(c("invented"))inv++;okm+=c("ok")+c("minor");readBody+=c("ok")+c("minor")+c("wrong")+c("invented")+c("loop");
  if(!v.dropped_body_lines&&!v.loop&&!c("loop")&&!c("invented")&&c("wrong")<=1)clean++;else bad.push(`${v.id}: ${v.notes.slice(0,140)}`);}
 console.log(arm,mode,JSON.stringify({invented_pages:inv,line_recall:+(1-drop/refL).toFixed(3),dropped:drop,ref:refL,clean_pages:clean,okminor:+(okm/readBody).toFixed(3),marker_lines:markers}));
 if(mode==="markers-excluded")console.log(bad.join("\n"));}
