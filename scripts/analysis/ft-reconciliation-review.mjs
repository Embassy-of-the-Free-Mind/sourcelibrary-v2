#!/usr/bin/env node
/**
 * FT reconciliation — DIAGNOSIS + reviewed worklist (issue #2234 #2). No writes.
 *
 * The ~447 Latin works where translation_verification gives a "first"-type
 * disposition but is_first_translation=false. Auditing them shows the set is
 * NOT cleanly reconcilable — it is contaminated by upstream data bugs:
 *   - language mis-tagging: English ORIGINALS tagged language:'Latin'
 *     (Jefferson's Notes on Virginia, Spenser's Faerie Queene, Washington's
 *     Farewell Address) — not translations at all.
 *   - unreliable `confirmed_first`: applied to non-translations and to minor
 *     works where it only means "catalog search found nothing."
 *   - qualified firsts (first_from_source/complete/modern) explicitly allow
 *     prior translations — a false flag is often correct.
 * So NO automated flip (or even confident auto-propose) is safe. This emits an
 * honestly-labeled worklist for per-work human review.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';
const QUALIFIED=['first_from_source','first_complete_translation','first_modern_translation'];
const FIRST=['confirmed_first',...QUALIFIED];
const ENG=/^(The |An |A |Notes |Washington|Mercury,|An Essay|An Inquiry|An Enquiry|Games |Korean |Japanese |Mancala|A History|A Short|A Treatise|The Game|The Natural|The Compleat|Justitia|The Faerie)/;
const XLANG=/translat(ed|ion)\s+from\s+(the\s+)?(arabic|greek|hebrew|syriac|aramaic|persian)/i;
const REF=/bibliothec|catalogus|repertor|index libr/i;
const c=new MongoClient(process.env.MONGODB_URI); await c.connect();
const B=c.db('bookstore').collection('books');
const rows=await B.find(
  { language:'Latin', pages_translated:{$gt:0}, is_first_translation:false, 'translation_verification.disposition':{$in:FIRST} },
  { projection:{ title:1,'translation_verification.disposition':1,'translation_verification.translations_found':1,'translation_verification.reasoning':1 } }
).toArray();
const out=rows.map(r=>{ const tv=r.translation_verification||{}; const found=(tv.translations_found||[]).length; const title=r.title||'';
  let action,reason;
  if(found>0){action='KEEP_FALSE';reason=`prior translation found (${found})`;}
  else if(QUALIFIED.includes(tv.disposition)){action='KEEP_FALSE';reason=`qualified-first (${tv.disposition})`;}
  else if(ENG.test(title)){action='LANG_MISTAG_SUSPECT';reason='English-looking title tagged Latin — likely not a translation';}
  else if(XLANG.test(tv.reasoning||'')){action='REVIEW_CROSSLANG';reason='original translated from another language';}
  else if(REF.test(title)){action='REVIEW_REFERENCE';reason='reference/catalogue work';}
  else {action='NEEDS_REVIEW';reason='confirmed_first + nothing found — disposition unreliable, manual check';}
  return { id:String(r._id), title:title.slice(0,80), disposition:tv.disposition, translations_found:found, action, reason }; });
const tally=out.reduce((a,x)=>{a[x.action]=(a[x.action]||0)+1;return a;},{});
writeFileSync('scripts/analysis/ft-reconciliation-candidates.json', JSON.stringify({
  total:out.length, tally,
  note:'NOT auto-actionable. confirmed_first is unreliable (applied to English originals + minor works); language mis-tags present. Per-work human review required. No flag was written.',
  candidates:out },null,2));
console.log(`contested rows: ${out.length}`);
console.log('honest worklist breakdown:', JSON.stringify(tally,null,2));
await c.close();
