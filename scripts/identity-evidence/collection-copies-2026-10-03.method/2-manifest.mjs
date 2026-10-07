// One entry per same-edition work-volume: members + cover URL + mid-page URL.
import {MongoClient} from 'mongodb';import fs from 'fs';
const S=process.env.S;
const res=JSON.parse(fs.readFileSync(S+'/clusters.json'));
const c=new MongoClient(process.env.MONGODB_URI);await c.connect();const db=c.db('bookstore');
const byKey={};
for(const r of res) for(const cl of r.clusters) if(cl.sameEdition){ const e=byKey[cl.key]=byKey[cl.key]||{key:cl.key,books:{},collections:[]}; e.collections.push(r.slug); for(const b of cl.books) e.books[b.id]=b; }
const out=[];
for(const e of Object.values(byKey)){
  const books=Object.values(e.books);
  for(const b of books){
    const mid=Math.max(1,Math.floor((b.pages_count||2)/2));
    const p=await db.collection('pages').findOne({book_id:b.id,page_number:{$gte:mid}},{projection:{_id:0,page_number:1,display_photo:1,photo:1},sort:{page_number:1}});
    b.mid_url=p?.display_photo||null; b.mid_page=p?.page_number;
    b.provider=b.image_source?.provider||(b.held_by||[])[0]||'?';
  }
  out.push({key:e.key,collections:e.collections,books:books.map(b=>({id:b.id,title:(b.display_title||b.title||'').slice(0,60),year:b.year,lang:b.language,pages:b.pages_count,ocr_pct:b.ocr_pct,tr_pct:b.tr_pct,provider:b.provider,cover:b.thumbnail||null,mid:b.mid_url,mid_page:b.mid_page}))});
}
fs.writeFileSync(S+'/manifest.json',JSON.stringify(out,null,1));
const sizes={};for(const o of out){sizes[o.books.length]=(sizes[o.books.length]||0)+1;}
console.log('work-volumes',out.length,'size dist',JSON.stringify(sizes),'missing mid',out.flatMap(o=>o.books).filter(b=>!b.mid).length,'missing cover',out.flatMap(o=>o.books).filter(b=>!b.cover).length);
await c.close();
