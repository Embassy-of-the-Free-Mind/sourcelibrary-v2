// Collections where >=2 grid members are the same work+volume. Writes JSON; prints counts only.
import {MongoClient} from 'mongodb';import fs from 'fs';
const OUT=process.env.OUT;
const c=new MongoClient(process.env.MONGODB_URI);await c.connect();const db=c.db('bookstore');
const cols=await db.collection('collections').find({visible:{$ne:false},collection_type:{$ne:'visual_art'}},{projection:{_id:0,slug:1,name:1,highlighted_books:1}}).toArray();
const vol=k=>(k||'').split('|')[3]||'v';
const res=[];
for(const col of cols){
  const bs=await db.collection('books').find({collections:col.slug,visible:true,pages_count:{$gt:0},pages_translated:{$gt:0}},{projection:{_id:0,id:1,title:1,display_title:1,published:1,work_id:1,edition_key:1,pages_count:1,pages_translated:1,pages_ocr:1,pages_blank:1,language:1,thumbnail:1,'image_source.provider':1,held_by:1}}).toArray();
  const g={};
  for(const b of bs){ if(!b.work_id) continue; const k=b.work_id+'|'+vol(b.edition_key)+'|'+(b.language||'?'); (g[k]=g[k]||[]).push(b);}
  const yr=b=>String(b.published||'').match(/1[4-9]\d\d/)?.[0]||'?';
  const clusters=Object.entries(g).filter(([k,v])=>v.length>1).map(([k,v])=>{
    const years=new Set(v.map(yr)); const sameEd=v.filter(b=>yr(b)===yr(v[0])).length===v.length && yr(v[0])!=='?';
    return {key:k,sameEdition:sameEd,books:v.map(b=>{const d=(b.pages_count||0)-(b.pages_blank||0);return {...b,year:yr(b),ocr_pct:d>0?Math.min(100,Math.round(100*(b.pages_ocr||0)/d)):0,tr_pct:d>0?Math.min(100,Math.round(100*(b.pages_translated||0)/d)):0};})};});
  if(clusters.length) res.push({slug:col.slug,name:col.name,members:bs.length,highlighted:(col.highlighted_books||[]).map(h=>h.book_id),clusters});
}
fs.writeFileSync(OUT,JSON.stringify(res,null,1));
const nCl=res.reduce((a,r)=>a+r.clusters.length,0), nBooks=res.reduce((a,r)=>a+r.clusters.reduce((x,c)=>x+c.books.length,0),0);
const uniq=new Set(res.flatMap(r=>r.clusters.map(c=>c.key)));
const same=new Set(res.flatMap(r=>r.clusters.filter(c=>c.sameEdition).map(c=>c.key)));
console.log('same-edition unique',same.size,'| same-edition cluster rows',res.reduce((a,r)=>a+r.clusters.filter(c=>c.sameEdition).length,0));
console.log('collections',cols.length,'| with dupes',res.length,'| clusters',nCl,'| unique work-volumes',uniq.size,'| books in clusters',nBooks);
console.log(res.sort((a,b)=>b.clusters.length-a.clusters.length).slice(0,15).map(r=>r.slug+':'+r.clusters.length+'/'+r.members).join('  '));
await c.close();
