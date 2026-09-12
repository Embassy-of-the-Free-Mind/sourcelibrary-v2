#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/detect-fabricated-ocr.mjs finds OCR invented for a
 * BLANK leaf (#4149) — a different failure, detected from the IMAGE (ink
 * coverage). This detects the #4584 failure, which is invisible in the image:
 * the OCR is correct and the TRANSLATION asserts content for a region the OCR
 * said it did not read. No image fetch, no API cost.
 *
 * Finds pages where the OCR states in English that a region was not
 * transcribed, the translation does not acknowledge any gap, and the
 * declination ACCOUNTS FOR THE PAGE rather than one word inside a good
 * transcription.
 *
 * ── READ THIS BEFORE TRUSTING THE COUNT ───────────────────────────────────
 * This is a WORK LIST, never an authority. Three earlier generations were
 * built and discarded on 2026-09-02/03, each mostly false positives, and the
 * failures are instructive because they will recur:
 *
 *   v0  bracket placeholder + >=5 enumerated translation lines.
 *       12 hits, 11 false. Flagged *Seven Tablets of Creation* II p.41, which
 *       is EXEMPLARY work: the OCR transcribed the visible cuneiform and the
 *       translation rendered it faithfully (DINGIR+ME -> "divine powers",
 *       LUGAL -> "king"), gaps preserved on both sides. Bulk-withdrawing on
 *       that list would have destroyed good scholarship.
 *
 *   v1  "translation much longer than the OCR it had to work from."
 *       15,948 hits and completely invalid: the length function strips the
 *       hieroglyph/cuneiform Unicode blocks, so ANY genuine translation of a
 *       glyph page looks like invention. Its own positive control failed and
 *       the number was never real.
 *
 *   v2  dropped the length test, kept "OCR declined + translation silent."
 *       733 hits, still mostly false — a single "[illegible]" marking ONE word
 *       inside 10,468 characters of good Latin is not a declination.
 *
 *   v3  (this file) adds the missing condition: the OCR's real transcribed
 *       body must be small, so the declination accounts for the page.
 *       122 hits. Hand-sampling three put precision near a THIRD — the
 *       OCR_MAX threshold still catches pages with short-but-genuine
 *       transcriptions (a Chinese materia medica page, an Almagest table page).
 *
 * So: verify every hit by reading the page before acting on it. The nine
 * controls below encode each false-positive family found so far; a change that
 * breaks one is a regression, and the script aborts rather than print a number.
 *
 * SCOPE, stated plainly: non-Latin-script books with translations
 * (5,576 books / 1.28M translated pages). It cannot see prose fabrication with
 * no bracket placeholder, the runaway-loop failure (#4584 p.118), or
 * Latin-script books. The corpus-wide rate remains unmeasured.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/detect-fabricated-translation.mjs
 */
import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const DECLINED = /\[[^\]]{0,140}\b(?:not transcribed|untranscribed|omitted in transcription|illegible|undeciphered|text lines?\b[^\]]{0,40}\b(?:through|\d+\s*-\s*\d+)|hieroglyphic text (?:block|lines)|cuneiform text)\b[^\]]{0,140}\]/i;
const ACK = /<lacuna>|<unclear>|\[\s*\.{2,}\s*\]|no translatable content|\[[^\]]{0,80}(?:illegible|not transcribed|untranscribed|cuneiform text|hieroglyphic text|omitted)[^\]]{0,80}\]/i;
const APP = /<(meta|summary|keywords|vocab|language|lang|scan-quality|script|page-type|columns|warning|image-desc|detected-images|header|sig|page-num)>[\s\S]*?<\/\1>/gi;
const ocrBody = s => s.replace(APP,' ').replace(/\[[^\]]*\]/g,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const trBody  = s => s.replace(APP,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const OCR_MAX = 600, TR_MIN = 200;
const fire = (o,t) => DECLINED.test(o) && !ACK.test(t) && ocrBody(o).length <= OCR_MAX && trBody(t).length >= TR_MIN;

const get=(b,p)=>db.collection('pages').findOne({book_id:b,page_number:p});
let ok=true;
for (const r of await db.collection('page_revisions').find({source:'withdraw-fabricated-translation-4584'}).toArray()) {
  const pg=await get(r.book_id,r.page_number); const hit=fire(pg.ocr?.data||'', r.data);
  console.log(`POSITIVE ${r.book_id} p.${r.page_number}: ${hit?'fires ✓':'MISSES ✗'}  (ocrBody=${ocrBody(pg.ocr?.data||'').length}, trBody=${trBody(r.data).length})`);
  if(!hit) ok=false;
}
for (const [b,p,why] of [['699253fd59cdabeb78f1a924',231,'repeats placeholder'],['69e0126c4e6773d060856486',78,'real glyphs'],
   ['699249d3a2d53df4853c0502',41,'faithful cuneiform'],['69e7933580b52390feb18277',42,'one illegible word, page transcribed'],
   ['69ef2f3455d5fee247f6c924',20,'one illegible word in 10k chars'],['69d66bc84da4f8dce52f1ba9',1,'blank-page stub']]) {
  const pg=await get(b,p); const hit=fire(pg.ocr?.data||'', pg.translation?.data||'');
  console.log(`NEGATIVE ${b} p.${p} (${why}): ${hit?'FALSE POSITIVE ✗':'silent ✓'}`);
  if(hit) ok=false;
}
if(!ok){console.error('\nCONTROLS FAILED — aborting.');process.exit(1);}
console.log('\nall 9 controls pass — scanning\n');
const NL=/hieroglyph|cuneiform|akkadian|sumerian|tibetan|sanskrit|chinese|japanese|arabic|hebrew|syriac|coptic|demotic|greek|armenian|georgian|ethiopic|ge'ez|persian|ottoman|devanagari|pali|tamil|thai|korean|manchu|mongolian/i;
const langs=(await db.collection('books').distinct('language')).filter(l=>l&&NL.test(l));
const books=await db.collection('books').find({language:{$in:langs},pages_translated:{$gt:0}}).project({id:1,title:1,visible:1}).toArray();
const hits=[];
for(let i=0;i<books.length;i+=150){
  const batch=books.slice(i,i+150), ids=batch.map(b=>b.id);
  const rows=await db.collection('pages').find({book_id:{$in:ids},'ocr.data':{$regex:DECLINED},'translation.data':{$exists:true,$ne:''}},{maxTimeMS:180000})
    .project({book_id:1,page_number:1,ocr:1,translation:1}).toArray();
  for(const r of rows){ if(!fire(r.ocr?.data||'',r.translation?.data||'')) continue;
    const bk=batch.find(b=>b.id===r.book_id); hits.push({t:bk?.title?.slice(0,46),v:bk?.visible,p:r.page_number,id:r.book_id,tr:trBody(r.translation?.data||'').length}); }
}
console.log(`=== ${hits.length} pages survive all conditions ===`);
for(const h of hits.slice(0,30)) console.log(`  ${h.v?'LIVE':'hid '} p.${String(h.p).padStart(4)} tr=${String(h.tr).padStart(5)}  ${h.t}  (${h.id})`);
await c.close();
