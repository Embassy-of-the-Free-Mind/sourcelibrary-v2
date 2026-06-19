/**
 * resolve-work-ids-wikidata.mjs — work_id resolution against WIKIDATA directly.
 *
 * For traditions the local `works` catalog doesn't cover (Greek, Latin, Pali),
 * the candidate source is Wikidata: resolve each book's canonical author to a
 * Wikidata QID (authors thesaurus), SPARQL that author's works (P50), then match
 * the book title to those works. Author-anchored by construction (candidates =
 * only that author's works), so containment + a light generic-word guard is
 * enough. Only HIGH (--apply) is written, with backup.
 *
 *   node scripts/analysis/resolve-work-ids-wikidata.mjs --lang=greek          # dry + evidence
 *   node scripts/analysis/resolve-work-ids-wikidata.mjs --lang=greek --apply  # write HIGH (+backup)
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const LANG = (process.argv.find(a=>a.startsWith('--lang='))||'--lang=greek').split('=')[1].toLowerCase();
const BOOKLANGS = { greek:['Greek','Ancient Greek'], latin:['Latin'], pali:['Pali','Pāli'] }[LANG] || [LANG[0].toUpperCase()+LANG.slice(1)];
const UA = 'SourceLibrary-work-resolver/1.0 (https://sourcelibrary.org; derek@playpowerlabs.com)';
// Fold precomposed ligatures BEFORE NFKD (æ/œ/ß don't canonically decompose, so
// they otherwise survive and make "Philosophiæ" ≠ "Philosophiae" — zero Latin/Greek
// HIGHs). Then NFKD + strip combining marks.
const deacc = s => (s||'')
  .replace(/[æÆ]/g,'ae').replace(/[œŒ]/g,'oe').replace(/ß/g,'ss')
  .normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase();
// apparatus words only. NOT container words (fragments/works/opera) — those must
// survive tokenization so the container-skip can see and reject them; they live
// in GENERIC instead. (Stripping them here left only the author name → snapped.)
const STOP = new Set(['the','a','an','of','and','on','with','to','in','de','book','books','vol','volume','part','complete','selected','edition','trans','translation','his','her']);
const GENERIC = new Set(['letters','poems','poem','life','lives','works','fragments','fragment','history','hymns','odes','epistles','dialogues','treatise','commentary','speeches','orations','elegies','epigrams','opera','tragoediae','comoediae','fabulae','opuscula','carmina','poetae','poetica']);
const tok = t => new Set(deacc(t).replace(/[\(\[].*?[\)\]]/g,' ').split(/ [—–-] |:| with | trans| edited/)[0]
  .replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>3 && !STOP.has(w)));

// ---- SPARQL: works for a batch of author QIDs ----
async function worksForAuthors(qids){
  const values = qids.map(q=>`wd:${q}`).join(' ');
  // label only — altLabels injected foreign tokens into container items
  // ("Fragments"), defeating the generic-skip and faking matches.
  // work_id must point at the abstract WORK, never a person (Q5) or a specific
  // EDITION/version (Q3331189). The Pascal bug: a collected-works *edition* labelled
  // just "Blaise Pascal" (P31=Q3331189) — when authors.name is only a surname, the
  // given-name token survives the author-strip in both title and label, faking
  // cont=1.0. Excluding editions also drops the Boethius-Venetian / Dürer-woodcuts
  // edition-QIDs the dry-run flagged. Under-cluster over mis-cluster: works that
  // exist in Wikidata only as editions are dropped (LOW), not mis-linked.
  const query = `SELECT ?author ?w ?wLabel WHERE {
    VALUES ?author { ${values} }
    ?w wdt:P50 ?author .
    MINUS { ?w wdt:P31 wd:Q5 }
    MINUS { ?w wdt:P31 wd:Q3331189 }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
  const r = await fetch('https://query.wikidata.org/sparql?'+new URLSearchParams({query, format:'json'}),
    { headers:{ 'User-Agent':UA, 'Accept':'application/sparql-results+json' }, signal:AbortSignal.timeout(60000) });
  if(!r.ok) throw new Error('SPARQL '+r.status);
  const d = await r.json();
  const byAuthor = new Map();
  for(const b of d.results.bindings){
    const a = b.author.value.split('/').pop();
    const label = b.wLabel?.value||'';
    if(/^Q\d+$/.test(label)) continue;   // no English label → unusable for matching
    if(!byAuthor.has(a)) byAuthor.set(a,[]);
    byAuthor.get(a).push({ qid:b.w.value.split('/').pop(), label, _tt:tok(label) });
  }
  return byAuthor;
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db = mc.db('bookstore');
const books = await db.collection('books').find(
  { $or:[{language:{$in:BOOKLANGS}},{original_language:{$in:BOOKLANGS}}], author_id:{$exists:true,$ne:null}, work_id:{$exists:false}, title:{$exists:true,$ne:''} },
  { projection:{ id:1, title:1, author:1, author_id:1, text_role:1, _id:0 } }
).toArray();
// author_id -> wikidata_id
const aids = [...new Set(books.map(b=>b.author_id))];
const authors = await db.collection('authors').find({ _id:{$in:aids}, wikidata_id:{$exists:true,$ne:null} }, { projection:{ _id:1, wikidata_id:1, name:1 } }).toArray();
const aidToQid = new Map(authors.map(a=>[a._id, a.wikidata_id]));
const aidToAuthorTok = new Map(authors.map(a=>[a._id, tok(a.name||'')]));  // author-name tokens to strip from titles
const qids = [...new Set([...aidToQid.values()].map(q=>q.replace(/^wd:/,'')))];
console.log(`${LANG}: ${books.length} unlinked books w/ author; ${qids.length} distinct author QIDs to query Wikidata`);

// fetch works per author (batched)
const worksByQid = new Map();
for(let i=0;i<qids.length;i+=40){
  const batch = qids.slice(i,i+40);
  try { const m = await worksForAuthors(batch); for(const [a,ws] of m) worksByQid.set(a,ws); }
  catch(e){ console.log(`  SPARQL batch ${i} failed: ${e.message}`); }
  await sleep(800);
}
const totalWorks = [...worksByQid.values()].reduce((s,w)=>s+w.length,0);
console.log(`fetched ${totalWorks} works across ${worksByQid.size} authors from Wikidata`);

const out={high:[],medium:[],low:[]};
for(const b of books){
  const qid = (aidToQid.get(b.author_id)||'').replace(/^wd:/,'');
  const cands = worksByQid.get(qid);
  if(!cands || !cands.length){ continue; }
  // strip the author's own name tokens — the anchor already fixes the author,
  // so the name must not drive title containment (kills "X → Fragments by X").
  const aTok = aidToAuthorTok.get(b.author_id) || new Set();
  const bt = new Set([...tok(b.title)].filter(x=>!aTok.has(x)));
  let best=null, bestCont=0, bestInter=0, bestTT=null;
  for(const w of cands){
    const wtt = new Set([...w._tt].filter(x=>!aTok.has(x)));   // strip author name from work label too
    if(!wtt.size) continue;
    // skip CONTAINER works (collected works / fragments / "Book II"): label is
    // empty or all-generic after author-strip — these snap many distinct works.
    if([...wtt].every(x=>GENERIC.has(x))) continue;
    if(wtt.has('fragments')||wtt.has('fragment')) continue;  // "Fragments [by X]" container, even if author not stripped
    // container/edition labels that snapped collected-works books incorrectly
    if(/with an english translation|amddiffyniad|^opera |^the works of|collected works|complete works/i.test(w.label)) continue;
    let inter=0; for(const x of wtt) if(bt.has(x)) inter++;
    const cont = inter/wtt.size;
    if(cont>bestCont || (cont===bestCont && inter>bestInter)){ bestCont=cont; bestInter=inter; best=w; bestTT=wtt; }
  }
  if(!best || bestInter===0){ continue; }
  const wTokens=[...bestTT];
  const generic = wTokens.length===1 && GENERIC.has(wTokens[0]);
  const rec={ book:b.title.slice(0,48), role:b.text_role||'?', bookId:b.id, authorQid:qid,
    work:best.label.slice(0,40), qid:best.qid, cont:+bestCont.toFixed(2), inter:bestInter };
  // HIGH: the work's full name is inside the book title (containment≥0.8) and it
  // isn't a bare generic word. Author-anchored, so no separate author check.
  if(bestCont>=0.8 && !generic) out.high.push(rec);
  else if(bestCont>=0.8 && generic) out.medium.push(rec);
  else out.low.push(rec);
}
console.log(`\n${LANG}: HIGH ${out.high.length} | MEDIUM(generic, review) ${out.medium.length} | LOW ${out.low.length}`);
console.log('\n=== HIGH proposals (evidence) ===');
for(const r of out.high.slice(0,40)) console.log(`  [${r.role.slice(0,4)}] "${r.book}" → ${r.qid} "${r.work}" cont=${r.cont} (author ${r.authorQid})`);
fs.writeFileSync(`/tmp/wikidata-work-proposals-${LANG}.json`, JSON.stringify(out,null,2));
console.log(`\nfull -> /tmp/wikidata-work-proposals-${LANG}.json`);

if(APPLY){
  const before = await db.collection('books').find({ id:{$in:out.high.map(r=>r.bookId)} },{projection:{id:1,work_id:1,_id:0}}).toArray();
  fs.writeFileSync(`scripts/output/wikidata-work-ids-backup-${LANG}.json`, JSON.stringify(before,null,2));
  let n=0;
  for(const r of out.high) n += (await db.collection('books').updateOne({ id:r.bookId, work_id:{$exists:false} }, { $set:{ work_id:r.qid, work_title:r.work, work_id_source:'wikidata:P50', work_id_confidence:'high', updated_at:new Date() } })).modifiedCount;
  console.log(`\n[--apply] wrote work_id (Wikidata QID) on ${n}/${out.high.length} ${LANG} books. Backup saved.`);
}
await mc.close(); process.exit(0);
