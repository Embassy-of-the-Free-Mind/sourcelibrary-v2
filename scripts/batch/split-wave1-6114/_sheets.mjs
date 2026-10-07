import sharp from 'sharp'; import fs from 'node:fs';
const OUT='/root/split-wave1-6114/triage';
const ids=fs.readFileSync(`${OUT}/triage.jsonl`,'utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(r=>!r.held).map(r=>r.id);
const index=[];
for (let s=0;s*5<ids.length;s++){const chunk=ids.slice(s*5,s*5+5);const name=`t-${String(s+1).padStart(2,'0')}.jpg`;
 const full=await sharp({create:{width:1920,height:chunk.length*440,channels:3,background:'white'}}).composite(chunk.map((id,i)=>({input:`${OUT}/strips/${id}.jpg`,left:0,top:i*440}))).png().toBuffer();
 await sharp(full).resize({width:1500}).jpeg({quality:75}).toFile(`${OUT}/${name}`);index.push({sheet:name,ids:chunk});}
fs.writeFileSync(`${OUT}/t-index.json`,JSON.stringify(index));console.log(ids.length,index.length);
