#!/usr/bin/env node
/**
 * Residential direct-insert of Harvard-Yenching IIIF books that 429 from the
 * datacenter import route. Generalizes harvard-wuzhen-direct.mjs to a list.
 * See .claude/docs/import-workflow.md (datacenter-429 angle).
 *
 * Targets found via CURIOSity subject facet f[subjects_ssim][]=Taoism
 * (clean Daoist hits, unlike noisy keyword search), 2026-06-01. Deduped against
 * holdings; excludes works we already have (Baopuzi, the 道言內外秘訣全書 Wuzhen
 * anthology imported separately) and Daodejing-commentary dups.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/harvard-iiif-direct-batch.mjs --dry-run
 *   node scripts/import/harvard-iiif-direct-batch.mjs --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makePageDoc } from '../lib/book-docs.mjs';
import { insertBookIfNew } from '../lib/acquire-book.mjs';

const COMMIT = process.argv.includes('--commit');

const BOOKS = [
  { fhcl: '26080845', record: '49-990080920610203941', title: '雲笈七籤 (全122卷) — Yunji qiqian, complete 122 juan', author: '張君房 Zhang Junfang (Song)', published: '明萬曆 Ming Wanli (1573–1620)', colls: ['east-asia','mysticism','sacred-texts','chinese-classics'] },
  // 上清靈寶大法 (FHCL:29074785) DEFERRED — its manifest returns HTTP 406; needs investigation.
  { fhcl: '26078742', record: '49-990080881460203941', title: '呂祖全書 (64卷) — Lü Zu quanshu (Complete Works of Patriarch Lü Dongbin)', author: '呂洞賓 Lü Dongbin (attrib.)', published: '清乾隆40 Qing Qianlong 40 (1775)', colls: ['east-asia','alchemy','mysticism','chinese-classics'] },
  { fhcl: '26303985', record: '49-990077587250203941', title: '性命雙修萬神圭旨 — Xingming guizhi (Principles of Joint Cultivation of Nature and Life)', author: '尹真人 Yin Zhenren (attrib.)', published: '明萬曆43 Ming Wanli 43 (1615)', colls: ['east-asia','alchemy','mysticism','chinese-classics'] },
  // NOTE: 譚子化書 (record 990077576960) resolves to the SAME 831pp object as 道宗六書 below
  // (化書 is one of the 6種 bound in 道宗六書) — importing the container once, not both.
  { fhcl: '25667331', record: '49-990077576880203941', title: '道宗六書 (6種36卷, incl. 譚子化書) — Daozong liushu (Six Books of the Daoist Lineage)', author: 'various (Daoist); incl. 譚峭 Tan Qiao', published: '明萬曆4 Ming Wanli 4 (1576)', colls: ['east-asia','alchemy','mysticism','chinese-classics'] },
  { fhcl: '26080853', record: '49-990080884390203941', title: '華陽金仙證論 ; 慧命經 — Huayang jinxian zhenglun ; Huiming jing (Liu Huayang, neidan)', author: '柳華陽 Liu Huayang (b. 1736)', published: '清嘉慶4 Qing Jiaqing 4 (1799)', colls: ['east-asia','alchemy','mysticism','chinese-classics'] },
];

function slugify(s, n=70){ return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').substring(0,n).replace(/-$/,''); }
async function uniqueSlug(db, base){ let s=base,i=2; while(await db.collection('books').findOne({slug:s},{projection:{_id:1}})) s=`${base}-${i++}`; return s; }

async function fetchManifest(fhcl){
  const url = `https://nrs.harvard.edu/urn-3:FHCL:${fhcl}:MANIFEST`;
  for (let a=1;a<=4;a++){
    try { const r = await fetch(url,{signal:AbortSignal.timeout(45000),headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}});
      if (r.ok) return { url, manifest: await r.json() };
      if (r.status===429){ await new Promise(x=>setTimeout(x, 8000*a)); continue; }
      return { url, err: r.status };
    } catch(e){ if(a===4) return { url, err: e.message }; await new Promise(x=>setTimeout(x, 5000*a)); }
  }
  return { url, err: '429/exhausted' };
}

function pagesFrom(manifest){
  const canvases = manifest.sequences?.[0]?.canvases || [];
  return canvases.map(c => { const res=c.images?.[0]?.resource; const svc=res?.service?.['@id'];
    const photo = res?.['@id'] || (svc?`${svc}/full/full/0/default.jpg`:null);
    return photo ? { photo, thumbnail: svc?`${svc}/full/200,/0/default.jpg`:photo } : null;
  }).filter(Boolean);
}

async function main(){
  const client = COMMIT ? new MongoClient(process.env.MONGODB_URI,{maxPoolSize:3}) : null;
  if (client) await client.connect();
  const db = client?.db('bookstore');
  const results = [];
  for (const b of BOOKS){
    const manifestUrl = `https://nrs.harvard.edu/urn-3:FHCL:${b.fhcl}:MANIFEST`;
    const fp = `iiif:${manifestUrl}`;
    if (db){ const ex = await db.collection('books').findOne({ $or:[{source_fingerprint:fp},{'image_source.iiif_manifest':manifestUrl}] },{projection:{slug:1}});
      if (ex){ console.log(`– ${b.fhcl} skip (held: ${ex.slug})`); results.push({fhcl:b.fhcl,skip:true}); continue; } }
    const { manifest, err } = await fetchManifest(b.fhcl);
    if (err){ console.log(`✗ ${b.fhcl} manifest ${err}`); results.push({fhcl:b.fhcl,err}); continue; }
    const pages = pagesFrom(manifest);
    const label = typeof manifest.label==='string'?manifest.label:'';
    if (!COMMIT){ console.log(`· ${b.fhcl} ${pages.length}p | ${b.title.slice(0,50)} | ${label.slice(0,40)}`); results.push({fhcl:b.fhcl,pages:pages.length}); await new Promise(x=>setTimeout(x,1500)); continue; }
    const bookId=new ObjectId(), id=bookId.toHexString(), now=new Date();
    const slug=await uniqueSlug(db, slugify(b.title.split('—')[1]||b.title));
    const acquired = await insertBookIfNew(db, {
      _id:bookId, id, slug, title:b.title, display_title:label||b.title.split('—')[0].trim(),
      author:b.author, language:'Chinese', original_language:'Chinese', published:b.published,
      categories:[], collections:b.colls, thumbnail:pages[0]?.thumbnail||'',
      pages_count:pages.length, pages_ocr:0, pages_translated:0, pages_archived:0, content_type:'book',
      dublin_core:{ dc_identifier:[`IIIF:${manifest['@id']||manifestUrl}`,`HOLLIS:${b.record.replace('49-','')}`], dc_source:manifestUrl },
      image_source:{ provider:'harvard', provider_name:'Harvard-Yenching Library',
        source_url:`https://curiosity.lib.harvard.edu/chinese-rare-books/catalog/${b.record}`, iiif_manifest:manifestUrl,
        license:'Harvard viewer terms (https://nrs.lib.harvard.edu/urn-3:hul.ois:hlviewerterms)',
        contributing_library:'Harvard-Yenching Library (CURIOSity Chinese Rare Books)', attribution:'Provided by Harvard University.', access_date:now },
      notes:`Daoist text from Harvard-Yenching, imported direct from IIIF manifest (residential fetch) to bypass datacenter 429. CURIOSity subject:Taoism.`,
      status:'draft', hidden:true, visible:false, source_fingerprint:fp,
      normalized_title:slugify(b.title.split('—')[0]).replace(/-/g,' '), normalized_author:slugify(b.author).replace(/-/g,' '),
      created_at:now, updated_at:now,
    }, { importer: 'script:harvard-iiif-direct-batch', sourceIdentifier: b.fhcl, sourceUrl: manifestUrl });
    // The gate declined this candidate; the reason is a row in `dedup_skips`.
    if (!acquired.inserted){ console.log(`– ${b.fhcl} skip — ${acquired.message}`); results.push({fhcl:b.fhcl,skip:true}); continue; }
    for (let s=0;s<pages.length;s+=500){ const docs=pages.slice(s,s+500).map((p,k)=>{ const pid=new ObjectId();
      return makePageDoc({ _id:pid, id:pid.toHexString(), book_id:id, page_number:s+k+1, photo:p.photo, thumbnail:p.thumbnail, photo_original:p.photo, created_at:now, updated_at:now }); });
      await db.collection('pages').insertMany(docs,{ordered:false}); }
    console.log(`✓ ${b.fhcl} → ${slug} (${pages.length}p)`); results.push({fhcl:b.fhcl,ok:true,pages:pages.length,slug});
    await new Promise(x=>setTimeout(x,2000));
  }
  if (client) await client.close();
  const ok=results.filter(r=>r.ok); console.log(`\n${COMMIT?'IMPORTED':'DRY'}: ${ok.length}/${BOOKS.length}, ${ok.reduce((s,r)=>s+(r.pages||0),0)} pages`);
}
main().catch(e=>{console.error(e);process.exit(1);});
