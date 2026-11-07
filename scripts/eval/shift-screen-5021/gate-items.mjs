// PRIOR ART: none — job-local step; the gate shape follows scripts/audit/leaf-shift-confirm-5021.mjs selectBooks (seeded, stratified). Gate 1: SEED=50211; gate 2 (held out): SEED=50212 EXCLUDE=<gate 1 items>.
// Part of the #5021 shift screen (scripts/eval/experiments/2026-11-03-shift-screen-5021.md). Paths are under $JOB_SCRATCH.
// Gate set for #5021 screen: 150 pages. Seeded.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const S = process.env.JOB_SCRATCH;
function mulberry32(a){return()=>{a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const rnd = mulberry32(Number(process.env.SEED||50211));
const shuffle = xs => { const a=[...xs]; for (let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const EXCL=new Set((process.env.EXCLUDE?fs.readFileSync(process.env.EXCLUDE,"utf8").split("\n").filter(Boolean).map(l=>{const j=JSON.parse(l);return j.book_id+":"+j.page}):[]));const EXB=new Set((process.env.EXCLUDE?fs.readFileSync(process.env.EXCLUDE,"utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l)).filter(j=>j.arm.startsWith("synthetic")).map(j=>j.book_id):[]));const labels = fs.readFileSync(`${S}/risk/labels.jsonl`,"utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l)).filter(r=>!EXCL.has(r.book_id+":"+r.page)).sort((a,b)=>(a.book_id+a.page).localeCompare(b.book_id+b.page));
// stratify: round-robin across languages, at most 1 page per book first pass
function pick(pool, n) {
  const byLang = new Map();
  for (const r of shuffle(pool)) { const k=r.language||'-'; if(!byLang.has(k)) byLang.set(k,[]); byLang.get(k).push(r); }
  const out=[]; const books=new Set(); const langs=[...byLang.keys()].sort();
  for (let pass=0; out.length<n && pass<50; pass++) for (const l of langs) { if(out.length>=n) break; const xs=byLang.get(l); const i=xs.findIndex(r=>pass>2||!books.has(r.book_id)); if(i<0) continue; const [r]=xs.splice(i,1); books.add(r.book_id); out.push(r);} 
  return out;
}
const pos = pick(labels.filter(r=>r.y===1), 65);
const neg = pick(labels.filter(r=>r.y===0), 65);
const AS_OF='2026-11-03T09:15:00Z';
const items = [...pos, ...neg].map(r=>({book_id:r.book_id,page:r.page,y:r.y,arm:`${r.arm}:${r.verdict}`,language:r.language,as_of:AS_OF}));
// Synthetic Han/Tibetan: clean windows from single-page-lane or v12+ pages of Chinese/Tibetan books.
const c = new MongoClient(process.env.MONGODB_URI,{readPreference:'secondaryPreferred'}); await c.connect(); const db=c.db('bookstore');
for (const [lang, re] of [['Chinese',/^(Chinese|Classical Chinese)/i],['Tibetan',/^Tibetan/i]]) {
  const books = shuffle((await db.collection('books').find({language:re,visible:true,pages_count:{$gt:0},pages_translated:{$gt:20}},{projection:{id:1,language:1}}).sort({_id:1}).toArray()));
  let got=0;
  for (const b of books.filter(b=>!EXB.has(b.id))) {
    if (got>=10) break;
    const pages = await db.collection('pages').find({book_id:b.id,page_number:{$gt:2}, 'translation.data':{$exists:true}},{projection:{page_number:1,'translation.prompt_version':1,'translation.data':1,'ocr.data':1}}).sort({page_number:1}).limit(300).toArray();
    const ok = pages.filter((p,i)=>i>0&&i<pages.length-1&&pages[i-1].page_number===p.page_number-1&&pages[i+1].page_number===p.page_number+1&&String(p.translation?.data||'').length>400&&String(pages[i+1].translation?.data||'').length>400&&String(p.ocr?.data||'').length>200);
    if (!ok.length) continue;
    const p = ok[Math.floor(rnd()*ok.length)];
    // alternate: 5 synthetic shifts (English of n+1 on n) and 5 own windows per script
    const syn = got%2===0;
    items.push({book_id:b.id,page:p.page_number,y:syn?1:0,arm:syn?'synthetic:next':'synthetic-clean:own',language:b.language,...(syn?{synthetic:'next'}:{}),pv:p.translation?.prompt_version??null});
    got++;
  }
  console.error(lang, got);
}
await c.close();
fs.writeFileSync((process.env.OUTF || `${S}/work/gate-items.jsonl`), items.map(i=>JSON.stringify(i)).join('\n')+'\n');
const t={}; for(const i of items){const k=`${i.y} ${i.language}`;t[k]=(t[k]||0)+1;} console.log(items.length,t);
