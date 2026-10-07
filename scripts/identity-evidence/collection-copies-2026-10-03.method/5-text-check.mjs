// For each 'copies' verdict: does the keeper's mid-page text appear near the middle of each loser? (word-set overlap)
import {MongoClient} from 'mongodb';import fs from 'fs';
const S=process.env.S;
const idx=Object.fromEntries(JSON.parse(fs.readFileSync(S+'/index.json')).map(e=>[e.cluster,e]));
const vs={};for(const f of fs.readdirSync(S+'/verdicts')) for(const l of fs.readFileSync(S+'/verdicts/'+f,'utf8').split('\n')) if(l.trim()){const v=JSON.parse(l);vs[v.cluster]=v;}
const over={231:'B'};
const c=new MongoClient(process.env.MONGODB_URI);await c.connect();const db=c.db('bookstore');
const words=t=>new Set((t||'').toLowerCase().replace(/ſ/g,'s').replace(/v/g,'u').replace(/j/g,'i').replace(/<[^>]+>/g,' ').match(/[\p{L}]{4,}/gu)||[]);
const text=p=>p?.ocr?.data||'';
const rows=[];
for(const [cl,v] of Object.entries(vs)){ if(v.verdict!=='copies') continue; const e=idx[cl]; const K=e.members[over[cl]||v.keeper];
  const kp=await db.collection('pages').find({book_id:K.id},{projection:{_id:0,page_number:1,'ocr.data':1}}).sort({page_number:1}).toArray();
  const km=kp[Math.floor(kp.length/2)]; const kw=words(text(km)); if(kw.size<15){rows.push({cl:+cl,best:null,note:'keeper mid has little text'});continue;}
  for(const [L,b] of Object.entries(e.members)){ if(b.id===K.id) continue;
    const lp=await db.collection('pages').find({book_id:b.id},{projection:{_id:0,page_number:1,'ocr.data':1}}).sort({page_number:1}).toArray();
    const mid=Math.floor(lp.length/2); let best=0;
    for(let i=0;i<lp.length;i++){ const w=words(text(lp[i])); if(!w.size) continue; let inter=0; for(const x of kw) if(w.has(x)) inter++; best=Math.max(best,inter/kw.size); }
    rows.push({cl:+cl,L,best:+best.toFixed(2),loser_ocr:b.ocr_pct});
  }}
fs.writeFileSync(S+'/textcheck.json',JSON.stringify(rows,null,1));
const low=rows.filter(r=>r.best!==null&&r.best<0.35);
console.log('pairs',rows.length,'| low overlap (<0.35)',low.length,'| of which loser OCR<30%',low.filter(r=>r.loser_ocr<30).length,'| no-text',rows.filter(r=>r.best===null).length);
console.log('low & loser OCR>=30:',low.filter(r=>r.loser_ocr>=30).map(r=>r.cl+r.L+':'+r.best).join(' '));
await c.close();
