/**
 * classify-language-mismatch-content.mjs — triage the non-English language_review
 * bucket by READING the pages, not trusting one ai signal.
 *
 * For each candidate (catalog language = classical, ai_metadata.language = a
 * modern Euro lang), sample mid pages and measure per-language stopword density
 * + Greek/Cyrillic script ratio. Then:
 *   - dominant == catalog language  -> FALSE POSITIVE (original w/ modern
 *     apparatus; ai over-weighted the apparatus). Leave, clear the review flag.
 *   - dominant == a modern lang, classical nearly absent -> genuine vernacular;
 *     correct the `language` field to the dominant language. (--apply)
 *   - mixed / unclear -> leave flagged for human review.
 *
 * Reads /tmp/noneng-triage.json (ids). Usage:
 *   node scripts/maintenance/classify-language-mismatch-content.mjs          # report
 *   node scripts/maintenance/classify-language-mismatch-content.mjs --apply  # fix clear vernacular + clear false-positive flags
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const SW = {
  latin: 'et in est non cum ad qui quod sed ut ex per sunt enim hoc esse si aut nam atque ab de quae quam ipse autem'.split(' '),
  german: 'der die das und ist von zu den nicht mit auch ein eine auf im dem sich des wird werden für als aus dass nach bei'.split(' '),
  french: 'le la les de des et que qui une dans pour est par sur plus au aux ce il ne pas nous avec son ont été cette'.split(' '),
  italian: 'il la di che un per non con del della le si nel gli come questo sono anche più ma suo nella delle alla'.split(' '),
  spanish: 'el la de que los las en un una por con del se su para es como más al sus este entre cuando muy sin'.split(' '),
  dutch: 'de het een van en in is dat op te met voor niet zijn aan die ook als maar door werd wordt deze'.split(' '),
  english: 'the and of to in is that it was as with for his by this are be or from at on which have'.split(' '),
};
const swSets = Object.fromEntries(Object.entries(SW).map(([k, v]) => [k, new Set(v)]));
const norm = s => ({ 'ancient greek': 'greek', eng: 'english' }[String(s||'').toLowerCase().trim()] || String(s||'').toLowerCase().trim());
const strip = t => (t||'').replace(/<(meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning)[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ');

function classify(text) {
  const t = strip(text);
  const greek = (t.match(/[Ͱ-Ͽἀ-῿]/g)||[]).length;
  const cyr = (t.match(/[Ѐ-ӿ]/g)||[]).length;
  const latinCh = (t.match(/[A-Za-zÀ-ÿ]/g)||[]).length;
  const words = (t.toLowerCase().match(/[a-zà-ÿ]+/g)||[]);
  const total = words.length || 1;
  const dens = {};
  for (const [k, set] of Object.entries(swSets)) dens[k] = words.filter(w => set.has(w)).length / total;
  dens.greek = greek / (greek + latinCh + cyr + 1);
  dens.russian = cyr / (greek + latinCh + cyr + 1);
  const ranked = Object.entries(dens).sort((a,b)=>b[1]-a[1]);
  return { dominant: ranked[0][0], score: ranked[0][1], dens, words: total };
}

const cand = JSON.parse(fs.readFileSync('/tmp/noneng-triage.json','utf8'));
const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const P = mc.db('bookstore').collection('pages');
const B = mc.db('bookstore').collection('books');

const out = { falsePositive: [], vernacular: [], unclear: [] };
for (const c of cand) {
  const pgs = await P.find({ book_id: c.id, 'ocr.data': { $exists: true, $ne: '' } }, { projection: { 'ocr.data':1, page_number:1 } }).sort({ page_number:1 }).limit(300).toArray();
  if (pgs.length < 3) { out.unclear.push({ ...c, reason: 'too few OCR pages' }); continue; }
  const idxs = [0.3, 0.5, 0.7].map(f => Math.floor(f*(pgs.length-1)));
  const agg = {}; let totalWords = 0;
  for (const i of idxs) { const r = classify(pgs[i].ocr.data); for (const [k,v] of Object.entries(r.dens)) agg[k] = (agg[k]||0) + v*r.words; totalWords += r.words; }
  for (const k of Object.keys(agg)) agg[k] /= (totalWords||1);
  const ranked = Object.entries(agg).sort((a,b)=>b[1]-a[1]);
  const dominant = ranked[0][0];
  const cur = norm(c.current);
  const classicalDens = (agg[cur] || agg.greek*0) || 0; // catalog-language density (latin/greek captured)
  const curDens = cur === 'greek' ? agg.greek : (agg[cur] ?? 0);
  const rec = { id:c.id, title:c.title, current:c.current, detected:c.detected, dominant, dominantScore:+ranked[0][1].toFixed(3), curDens:+(curDens||0).toFixed(3) };
  // RELIABILITY GATE: the classifier only measures Latin-script + Greek/Cyrillic
  // script bodies. For Arabic/Hebrew/Sanskrit/Chinese/Coptic/Syriac the BODY is
  // invisible to it (no stopword/script detection), so curDens≈0 is an artifact,
  // not evidence the original is absent. Only auto-judge when the catalog
  // language is one we can actually read: latin or greek.
  const RELIABLE = new Set(['latin','greek']);
  if (norm(dominant) === cur) out.falsePositive.push(rec);                          // dominant IS the catalog language → correctly tagged
  else if (RELIABLE.has(cur) && ranked[0][1] >= 0.05 && (curDens||0) < 0.015) out.vernacular.push(rec); // reliably a modern lang, classical absent
  else out.unclear.push(rec);                                                        // non-Latin/Greek script, or mixed → human review
}

const fmtLang = d => ({ german:'German', french:'French', italian:'Italian', spanish:'Spanish', dutch:'Dutch', english:'English', greek:'Greek', russian:'Russian', latin:'Latin' }[d] || d);
console.log(`triaged ${cand.length} candidates:`);
console.log(`  FALSE POSITIVE (original w/ apparatus — clear review flag): ${out.falsePositive.length}`);
console.log(`  VERNACULAR (genuine modern-lang — fix language): ${out.vernacular.length}`);
console.log(`  UNCLEAR (leave flagged for human): ${out.unclear.length}`);
const pairs = a => { const m={}; for (const r of a){ const k=`${r.current}→${fmtLang(r.dominant)}`; m[k]=(m[k]||0)+1; } return Object.entries(m).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`${k}:${v}`).join('  '); };
console.log('\n  false-positive pairs:', pairs(out.falsePositive));
console.log('  vernacular pairs:', pairs(out.vernacular));
console.log('\n  sample vernacular (will fix):');
for (const r of out.vernacular.slice(0,15)) console.log(`    [${r.current}→${fmtLang(r.dominant)} ${r.dominantScore}] ${r.title}`);
fs.writeFileSync('/tmp/noneng-classified.json', JSON.stringify(out,null,2));

if (APPLY) {
  // backup
  const ids = [...out.vernacular, ...out.falsePositive].map(r=>r.id);
  const before = await B.find({ id:{$in:ids} }, { projection:{ id:1, language:1, language_review:1, _id:0 } }).toArray();
  fs.writeFileSync('scripts/output/classify-noneng-backup-2026-06-16.json', JSON.stringify(before,null,2));
  let fixedLang=0, clearedFp=0;
  for (const r of out.vernacular) fixedLang += (await B.updateOne({ id:r.id }, { $set: { language: fmtLang(r.dominant), 'field_provenance.language':'content_classifier_2026_06_16', updated_at:new Date() }, $unset: { language_review:'', language_review_detail:'' } })).modifiedCount;
  for (const r of out.falsePositive) clearedFp += (await B.updateOne({ id:r.id }, { $unset: { language_review:'', language_review_detail:'' }, $set: { language_verified_content:true, updated_at:new Date() } })).modifiedCount;
  console.log(`\n[--apply] fixed language on ${fixedLang} vernacular books; cleared review flag on ${clearedFp} verified-original false-positives. Backup saved.`);
}
await mc.close();
process.exit(0);
