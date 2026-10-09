import {MongoClient} from 'mongodb';import fs from 'fs';
const S=process.env.S; const picks={1:7,8:7,74:7,85:3,130:7,154:13,210:5,251:9,272:8,309:12,312:12,320:6,56:5,57:6};
const keepers=Object.fromEntries(JSON.parse(fs.readFileSync(S+'/keepers.json')).map(k=>[k.cluster,k]));
const c=new MongoClient(process.env.MONGODB_URI);await c.connect();const db=c.db('bookstore');
const backup=[];
for(const [cl,pn] of Object.entries(picks)){ const id=keepers[cl].id;
  const p=await db.collection('pages').findOne({book_id:id,page_number:pn},{projection:{_id:0,display_photo:1}});
  if(!p?.display_photo){console.log('no photo',cl);continue;}
  const u=p.display_photo.startsWith('/')?'https://sourcelibrary.org'+p.display_photo:p.display_photo;
  const thumb=/\/pages\/[^/]+\/\d+\.jpg$/.test(u)?u.replace(/\.jpg$/,'-thumb.jpg'):u;
  const b=await db.collection('books').findOne({id},{projection:{_id:0,id:1,thumbnail:1,thumbnail_blob:1,image_display:1}}); backup.push(b);
  const r=await db.collection('books').updateOne({id},{$set:{thumbnail:u,thumbnail_blob:thumb,image_display:u},$currentDate:{updated_at:true}});
  console.log(cl,id,'p'+pn,r.modifiedCount);
}
fs.writeFileSync('scratchpad/collection-dupes-cover-backup-2026-10-03.json',JSON.stringify(backup,null,1));
await c.close();
