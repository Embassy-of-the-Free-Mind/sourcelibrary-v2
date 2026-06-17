/**
 * resolve-work-ids.mjs — author-anchored work_id resolution (demo: Sanskrit).
 *
 * Matches our books to catalog works (Supabase `works`, Wikidata-QID'd) using
 * the fit rule: AUTHOR anchor + title match. Author agreement is required for a
 * named-author match; a near-unique distinctive title is required for the
 * anonymous-classics fallback. Only HIGH confidence is written (--apply);
 * MEDIUM/LOW are reported for review, never auto-assigned.
 *
 *   node scripts/analysis/resolve-work-ids.mjs            # dry-run, evidence shown
 *   node scripts/analysis/resolve-work-ids.mjs --apply    # write work_id on HIGH only (+backup)
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const LANG = (process.argv.find(a=>a.startsWith('--lang='))||'--lang=sanskrit').split('=')[1].toLowerCase();
// per-language config: catalog tradition filter, book language values, and the
// generic single-word work titles to reject (genre/common nouns that many
// distinct works share). Author-anchor/containment/specificity logic is shared.
const CONFIG = {
  sanskrit: { trad:'sanskrit', bookLangs:['Sanskrit'], generic:['ratnakara','sara','sangraha','vilasa','muhurta','ganita','manorama','vivarana','kundali','tilaka','bharata','svapna','sindhu','darpana','sagara','prakasa','samudrika','martanda','chintamani','kaumudi','sastra','shastra','sutika','bhavadhyaya'] },
  pali:     { trad:'pali', bookLangs:['Pali','Pāli'], generic:['sutta','nikaya','pitaka','vagga','gatha','atthakatha','katha','vatthu','jataka','pali'] },
  tibetan:  { trad:'tibetan', bookLangs:['Tibetan'], generic:['mdo','rgyud','grel','bstan','chos','gsung','bum','skor','phyi','nang'] },
  chinese:  { trad:'chinese', bookLangs:['Chinese','Classical Chinese'], generic:['jing','lun','shu','ji','zhuan','juan','bian','zhi','xu','jiao'] },
  hebrew:   { trad:'hebrew', bookLangs:['Hebrew','Aramaic'], generic:['sefer','torah','mishnah','perush','sidur','megillah'] },
  arabic:   { trad:'islamicate', bookLangs:['Arabic','Persian'], generic:['kitab','sharh','risala','diwan','tafsir','maqala','bab'] },
}[LANG] || { trad:LANG, bookLangs:[LANG[0].toUpperCase()+LANG.slice(1)], generic:[] };
const deacc = s => (s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase();
// apparatus/edition words only — NOT work-identity words like samhita/sutra/jataka
// (those distinguish Bṛhat-Saṃhitā from Bṛhat-Jātaka, so they must stay).
const STOP = new Set(['the','a','an','of','and','with','commentary','translation','translated','edition','ed','sanskrit','text','vol','volume','part','book','complete','selected','bhashya','bhasya','tika','vyakhya','his','its','royal']);
function titleTokens(t){
  let s = deacc(t).replace(/[\(\[].*?[\)\]]/g,' ').split(/ [—–-] |:| with | trans| edited/)[0];
  return new Set(s.replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>3 && !STOP.has(w)));
}
function authorTokens(a){
  let s = deacc(a).replace(/\(.*?\)|trans\.?|ed\.?|comm\.?|anonymous/g,' ');
  return new Set(s.replace(/[^a-z ]/g,' ').split(/\s+/).filter(w=>w.length>3));
}
const jacc=(A,B)=>{ if(!A.size||!B.size) return 0; let i=0; for(const x of A) if(B.has(x)) i++; return i/(A.size+B.size-i); };
// a shared token only counts as "distinctive" if it is RARE across the catalog
// (low document frequency) — kills common words like siddhanta/chintamani/ratnakara.
let DF=new Map();
const shareDistinct=(A,B)=>{ for(const x of A) if(x.length>=6 && B.has(x) && (DF.get(x)||0)<=3) return x; return null; };

// ---- pull works for this tradition from the catalog (paginated) ----
const sb=createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
let works=[]; for(let off=0;;off+=1000){
  const { data } = await sb.from('works').select('id,title,title_romanized,title_english,author,wikidata_qid,original_language,tradition').or(`tradition.ilike.%${CONFIG.trad}%`).range(off,off+999);
  if(!data||!data.length) break; works.push(...data); if(data.length<1000) break;
}
// index works by author token + precompute title token sets
const worksIdx=new Map();
for(const w of works){
  w._tt=new Set([...titleTokens(w.title_romanized||w.title||''), ...titleTokens(w.title||'')]);
  for(const tk of w._tt) DF.set(tk,(DF.get(tk)||0)+1);   // document frequency across catalog titles
  for(const at of authorTokens(w.author||'')){ if(!worksIdx.has(at)) worksIdx.set(at,[]); worksIdx.get(at).push(w); }
}
console.log(`catalog: ${works.length} ${LANG} works loaded (${worksIdx.size} author tokens)`);

// ---- pull our Sanskrit books ----
const mc=new MongoClient(process.env.MONGODB_URI); await mc.connect();
const B=mc.db('bookstore').collection('books');
const books=await B.find({$or:[{language:{$in:CONFIG.bookLangs}},{original_language:{$in:CONFIG.bookLangs}}], title:{$exists:true,$ne:''}})
  .project({id:1,title:1,author:1,text_role:1,work_id:1,_id:0}).toArray();

const out={high:[],medium:[],low:[]};
for(const b of books){
  if(b.work_id){ continue; } // already linked
  const bt=titleTokens(b.title), ba=authorTokens(b.author);
  // candidate works = those sharing an author token (named-author path)
  let cands=new Set();
  for(const at of ba) for(const w of (worksIdx.get(at)||[])) cands.add(w);
  let best=null, bestScore=0, via='';
  for(const w of cands){ const s=jacc(bt,w._tt); if(s>bestScore){bestScore=s;best=w;via='author+title';} }
  // anonymous-classics fallback: no good author match → require a RARE shared
  // token AND a real title overlap (best jaccard among rare-token candidates).
  let distinct=null;
  if(!best || bestScore<0.5){
    for(const w of works){ const d=shareDistinct(bt,w._tt); if(!d) continue; const s=jacc(bt,w._tt);
      if(s>bestScore || (via!=='author+title' && s>=bestScore)){ best=w; bestScore=s; via='distinctive-title'; distinct=d; } }
  }
  if(!best) continue;
  const authorMatch = ba.size && [...authorTokens(best.author||'')].some(x=>ba.has(x));
  // CONTAINMENT = is the work's canonical name fully inside the book's title?
  // (book = an edition OF that work). This is the decisive fit signal: it
  // accepts "Kāmasūtra of Vātsyāyana"→"Kāmasūtra" but rejects "Rāmāyaṇa"→
  // "Adbhuta Rāmāyaṇa" (work carries a distinctive token the book lacks).
  let inter=0; for(const x of best._tt) if(bt.has(x)) inter++;
  const cont = best._tt.size ? inter/best._tt.size : 0;
  const rec={ book:b.title.slice(0,46), bookAuthor:(b.author||'').slice(0,20), role:b.text_role||'?', bookId:b.id,
    work:(best.title_romanized||best.title||'').slice(0,40), qid:best.wikidata_qid||('catalog:'+best.id), via, titleSim:+bestScore.toFixed(2), cont:+cont.toFixed(2), authorMatch:!!authorMatch, distinct };
  // The work must be SPECIFIC — a multi-token name or a long (≥9 char) single
  // token — else it's a generic catalog stub ("Muhūrta", "Gaṇita", "Bharata")
  // that many distinct works trivially contain; for those require near-exact sim.
  // a single-token work title that is a generic Sanskrit word (genre/common
  // noun) is NOT specific even if long — many distinct works share it.
  const GENERIC = new Set(CONFIG.generic);
  const workSpecific = (best._tt.size>=2 || [...best._tt].some(x=>x.length>=9)) && !(best._tt.size===1 && GENERIC.has([...best._tt][0]));
  const baseOK = cont>=0.8 && (workSpecific || bestScore>=0.6);
  rec.specific = workSpecific;
  // HIGH (auto-write): name contained + specific, AND (author agrees OR rare token).
  if(baseOK && (authorMatch || (via==='distinctive-title' && distinct))) out.high.push(rec);
  else if((authorMatch && cont>=0.5) || (distinct && cont>=0.67)) out.medium.push(rec);
  else out.low.push(rec);
}
console.log(`\n${LANG} books needing work_id: matched HIGH ${out.high.length} | MEDIUM ${out.medium.length} | LOW ${out.low.length}`);
console.log('\n=== HIGH-confidence proposals (evidence) ===');
for(const r of out.high.slice(0,30)) console.log(`  [${r.role}] "${r.book}" (${r.bookAuthor})\n        → ${r.qid} "${r.work}"  via=${r.via} sim=${r.titleSim} authorMatch=${r.authorMatch}${r.distinct?' tok='+r.distinct:''}`);
console.log('\n=== MEDIUM (would queue for review, NOT written) ===');
for(const r of out.medium.slice(0,12)) console.log(`  [${r.role}] "${r.book}" → ${r.qid} "${r.work}" sim=${r.titleSim} authorMatch=${r.authorMatch}`);
fs.writeFileSync('/tmp/work-id-proposals.json',JSON.stringify(out,null,2));
console.log('\nfull -> /tmp/work-id-proposals.json');

if(APPLY){
  const before = await B.find({ id:{$in:out.high.map(r=>r.bookId)} }, { projection:{id:1,work_id:1,_id:0} }).toArray();
  fs.writeFileSync(`scripts/output/resolve-work-ids-backup-${LANG}.json`, JSON.stringify(before,null,2));
  let n=0;
  for(const r of out.high){
    n += (await B.updateOne({ id:r.bookId, work_id:{$exists:false} }, { $set:{ work_id:r.qid, work_title:r.work, work_id_source:'resolve-work-ids:'+r.via, work_id_confidence:'high', updated_at:new Date() } })).modifiedCount;
  }
  console.log(`\n[--apply] wrote work_id on ${n}/${out.high.length} HIGH matches (${LANG}). Backup -> scripts/output/resolve-work-ids-backup-${LANG}.json`);
}
await mc.close(); process.exit(0);
