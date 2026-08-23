const BASE = 'https://sourcelibrary.org';
const QUERIES = [
  { q: 'buddhist mandala cosmology tibetan' },
  { q: 'mandala vajrayana deity circle diagram' },
  { subject: 'buddhism' },
  { q: 'thangka tibetan wheel of life bhavacakra' },
  { q: 'tantric yantra meditation circle' },
  { q: 'chakra lotus wheel dharma' },
];
async function run(query){
  const u = new URL('/api/gallery', BASE);
  u.searchParams.set('minQuality','0.6'); u.searchParams.set('limit','40'); u.searchParams.set('maxPerBook','6');
  for (const [k,v] of Object.entries(query)) u.searchParams.set(k,String(v));
  try{
    const r = await fetch(u); if(!r.ok){console.log(JSON.stringify(query),'HTTP',r.status);return;}
    const j = await r.json(); const items=j.items||[];
    console.log('\n== '+JSON.stringify(query)+' -> '+items.length+' ==');
    for(const it of items.slice(0,8)) console.log(`  q=${(it.galleryQuality??0).toFixed(2)} type=${it.type||'?'} | ${(it.bookTitle||'').slice(0,45)} | ${(it.description||'').slice(0,55)}`);
  }catch(e){console.log(JSON.stringify(query),'ERR',e.message);}
}
for(const q of QUERIES) await run(q);
