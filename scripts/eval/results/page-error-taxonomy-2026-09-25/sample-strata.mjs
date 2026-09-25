// PRIOR ART: scripts/eval/ocr-difficulty-taxonomy.mjs — measures instability from page_revisions repeat pairs; this draws one consecutive page pair per book from the local mirror (~/sl-corpus) for BY-EYE reading, a different question.
// Draw one consecutive mid-book page pair per book, ≥6 books per stratum, from the local mirror.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const DB = '/Users/dereklomas/sl-corpus/corpus.sqlite';
const BOOKS = '/Users/dereklomas/sl-corpus/books';
const OUT = process.argv[2] || '/Users/dereklomas/.claude/jobs/b8f5a5e8/tmp/sample.json';
const PER = 6;
const q = (sql) => JSON.parse(execFileSync('sqlite3', ['-json', DB, sql], { maxBuffer: 64e6 }).toString() || '[]');
const base = "visible=1 and pages_count between 40 and 900 and pages_translated > 0.7*pages_count and pages_ocr>0";
const tagv = (t, n) => (String(t||'').match(new RegExp('<'+n+'>([^<]*)</'+n+'>')) || [])[1];
const body = (t) => String(t||'').replace(/<(meta|header|footer|warning|scan-quality|note)>[\s\S]*?<\/\1>/g,' ').replace(/<[^>]+>/g,' ');
const rl = (t) => (body(t).match(/[\p{L}\p{N}]/gu)||[]).length;
const isText = (pg) => (pg.type||'text')==='text' || pg.type==='';
const printed = (pg) => !/manuscript|handwritten|hand-written|cursive/i.test(tagv(pg.ocr,'script')||'');
const S = {
  dense:      { sql: `${base} and language in ('Latin','German','French','Italian','English','Dutch') and year_num between 1500 and 1799`,
                pair: (a,b)=> isText(a)&&isText(b)&&rl(a.ocr)>2600&&rl(b.ocr)>2600&&!/<columns>[2-9]/.test(a.ocr)&&!/<columns>[2-9]/.test(b.ocr)&&printed(a) },
  multicol:   { sql: `${base} and language in ('Latin','German','French','Italian','English','Dutch','Greek','Hebrew')`,
                pair: (a,b)=> isText(a)&&isText(b)&&/<columns>[2-9]/.test(a.ocr)&&/<columns>[2-9]/.test(b.ocr)&&rl(a.ocr)>800 },
  manuscript: { sql: `${base}`, pair: (a,b)=> !printed(a)&&!printed(b)&&rl(a.ocr)>300&&rl(b.ocr)>300 },
  short:      { sql: `${base}`, pair: (a,b)=> isText(a)&&isText(b)&&rl(a.ocr)>=25&&rl(a.ocr)<260&&rl(b.ocr)>=25&&rl(b.ocr)<900 },
  illustrated:{ sql: `${base}`, pair: (a,b)=> ['illustration','diagram','plate','map','frontispiece'].includes(a.type)&&rl(b.ocr)>200 },
  music:      { sql: `${base} and (lower(title) like '%musi%' or lower(title) like '%cantion%' or lower(title) like '%motet%' or lower(title) like '%madrigal%' or lower(title) like '%missa%' or lower(title) like '%psalm%' or lower(title) like '%harmon%' or lower(subjects) like '%music%' or lower(collections) like '%music%')`,
                pair: (a,b)=> /music|score|staff|stave|notation|tablature/i.test(a.ocr.slice(0,1500))&&rl(b.ocr)>50 },
  tables:     { sql: `${base}`, pair: (a,b)=> (a.type==='index'||a.type==='table'||/\|---\|/.test(a.ocr))&&(b.type==='index'||b.type==='table'||/\|---\|/.test(b.ocr))&&rl(a.ocr)>300 },
  greek:      { sql: `${base} and language in ('Greek','Greek-Latin','Greek/Latin')`, pair: (a,b)=> isText(a)&&isText(b)&&/[Ͱ-Ͽἀ-῿]{40}/.test(body(a.ocr).replace(/\s/g,''))&&rl(a.ocr)>400&&rl(b.ocr)>400 },
  rtl:        { sql: `${base} and language in ('Hebrew','Arabic','Syriac','Persian')`, pair: (a,b)=> isText(a)&&isText(b)&&/[֐-ۿ܀-ݏ]{30}/.test(body(a.ocr).replace(/\s/g,''))&&rl(a.ocr)>200&&rl(b.ocr)>200 },
  cjk_tib:    { sql: `${base} and language in ('Chinese','Classical Chinese','Japanese','Korean','Tibetan')`, pair: (a,b)=> isText(a)&&isText(b)&&/[一-鿿ༀ-࿿぀-ヿ가-힯]{20}/.test(body(a.ocr).replace(/\s/g,''))&&rl(a.ocr)>150&&rl(b.ocr)>150 },
  incunabula: { sql: `${base} and year_num between 1450 and 1500`, pair: (a,b)=> isText(a)&&isText(b)&&rl(a.ocr)>600&&rl(b.ocr)>600 },
  c17:        { sql: `${base} and year_num between 1600 and 1699 and language in ('Latin','German','French','Italian','English','Dutch')`, pair: (a,b)=> isText(a)&&isText(b)&&rl(a.ocr)>600&&rl(b.ocr)>600 },
  c19:        { sql: `${base} and year_num between 1800 and 1899`, pair: (a,b)=> isText(a)&&isText(b)&&rl(a.ocr)>600&&rl(b.ocr)>600 },
};
const only = process.argv[3] ? process.argv[3].split(',') : Object.keys(S);
const out = {};
for (const name of only) {
  const st = S[name]; const picks = []; const seen = new Set();
  const cands = q(`select id,slug,title,author,language,year_num,pages_count,published from catalog where ${st.sql} order by random() limit 400`);
  for (const c of cands) {
    if (picks.length >= PER) break;
    const f = `${BOOKS}/${c.id}.jsonl`; if (!existsSync(f)) continue;
    let pages; try { pages = readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)); } catch { continue; }
    pages.sort((x,y)=>x.p-y.p);
    const N = pages.length; const lo = Math.floor(N*0.2), hi = Math.floor(N*0.8);
    const byP = new Map(pages.map(pg=>[pg.p,pg]));
    const cand = [];
    for (let i=lo;i<hi;i++) { const a = byP.get(i), b = byP.get(i+1); if (!a||!b||!a.ocr||!b.ocr||!a.tr||!b.tr) continue; try { if (st.pair(a,b)) cand.push([a,b]); } catch {} }
    if (!cand.length) continue;
    const [a,b] = cand[Math.floor(Math.random()*cand.length)];
    picks.push({ stratum: name, book: { id: c.id, slug: c.slug, title: c.title, author: c.author, language: c.language, year: c.year_num, published: c.published, pages_count: c.pages_count },
      pages: [a,b].map(pg=>({ p: pg.p, type: pg.type, lang: pg.lang, ocr_len: rl(pg.ocr), tr_len: rl(pg.tr), ocr: pg.ocr, tr: pg.tr })) });
  }
  out[name] = picks; console.error(name, picks.length, 'of', cands.length, 'candidates');
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote', OUT);
