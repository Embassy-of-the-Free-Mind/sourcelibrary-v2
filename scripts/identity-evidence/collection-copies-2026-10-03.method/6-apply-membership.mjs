// Apply duplicate-copy verdicts to collection membership + highlights. DRY unless APPLY=1.
import {MongoClient} from 'mongodb';import fs from 'fs';
const S=process.env.S, APPLY=process.env.APPLY==='1';
const index=JSON.parse(fs.readFileSync(S+'/index.json'));
const verdicts={};for(const f of fs.readdirSync(S+'/verdicts')) for(const l of fs.readFileSync(S+'/verdicts/'+f,'utf8').split('\n')) { if(!l.trim()) continue; try{const v=JSON.parse(l); verdicts[v.cluster]=v;}catch{} }
const over=Object.fromEntries((process.env.OVERRIDE||'').split(',').filter(Boolean).map(x=>x.split(':')).map(([c,k])=>[Number(c),k]));
const skip=new Set((process.env.SKIP||'').split(',').filter(Boolean).map(Number));
const c=new MongoClient(process.env.MONGODB_URI);await c.connect();const db=c.db('bookstore');
const pulls={}; // slug -> Set(book ids to remove)
const swaps={}; // slug -> {loserId: keeperId}
let nCopies=0;
for(const e of index){
  const v=verdicts[e.cluster]; if(!v||v.verdict!=='copies'||skip.has(e.cluster)) continue;
  const K=e.members[over[e.cluster]||v.keeper]?.id; if(!K) continue; nCopies++;
  const ids=Object.values(e.members).map(b=>b.id);
  for(const slug of e.collections){
    const present=(await db.collection('books').find({id:{$in:ids},collections:slug,visible:true},{projection:{_id:0,id:1,pages_translated:1}}).toArray());
    if(present.length<2) continue;
    const keep=present.find(b=>b.id===K)?K:present.sort((a,b)=>(b.pages_translated||0)-(a.pages_translated||0))[0].id;
    for(const b of present) if(b.id!==keep){ (pulls[slug]=pulls[slug]||new Set()).add(b.id); (swaps[slug]=swaps[slug]||{})[b.id]=keep; }
  }
}
const backup={books:{},collections:{}};
let nPull=0,nHl=0;
for(const [slug,set] of Object.entries(pulls)){
  const ids=[...set]; nPull+=ids.length;
  const col=await db.collection('collections').findOne({slug},{projection:{_id:0,highlighted_books:1}});
  let hb=col?.highlighted_books||[]; const before=JSON.stringify(hb);
  const out=[];const seen=new Set();
  for(const h of hb){ const k=swaps[slug][h.book_id]; const id=k||h.book_id; if(seen.has(id)) continue; seen.add(id); out.push(k?{...h,book_id:k}:h); }
  if(JSON.stringify(out)!==before){ nHl++; backup.collections[slug]=hb; }
  for(const id of ids){ backup.books[id]=backup.books[id]||[]; backup.books[id].push(slug); }
  if(APPLY){
    await db.collection('books').updateMany({id:{$in:ids}},{$pull:{collections:slug},$unset:{[`collection_relevance.${slug}`]:''},$currentDate:{updated_at:true}});
    if(JSON.stringify(out)!==before) await db.collection('collections').updateOne({slug},{$set:{highlighted_books:out},$currentDate:{updated_at:true}});
  }
}
fs.writeFileSync(S+(APPLY?'/applied-backup.json':'/dry-run.json'),JSON.stringify(backup,null,1));
console.log(APPLY?'APPLIED':'DRY','| copies verdicts',nCopies,'| collections touched',Object.keys(pulls).length,'| membership removals',nPull,'| highlight lists changed',nHl);
await c.close();
