/**
 * audit-language-mismatch.mjs — standing check for catalog-language mislabels.
 *
 * The pipeline's title-page metadata phase stores the librarian model's
 * content-read of the language in `ai_metadata.language`. Comparing that to
 * the catalog `language` field surfaces mislabels automatically — the
 * content-grounded version of the 2026-06-16 hand audit (see
 * lesson_ia_nonlatin_language_mistag).
 *
 * Two buckets:
 *   ENGLISH_AS_ORIGINAL — ai says English (or a modern Euro lang) but the book
 *     is tagged a classical language with text_role:'original'. These are
 *     modern translations mislabeled as source texts (SBE/Loeb/Mead/etc.).
 *   LANG_DRIFT — any other normalized mismatch (e.g. import-time IA mistag:
 *     Sanskrit scan tagged Marathi/Hindi).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/audit-language-mismatch.mjs            # report
 *   node scripts/maintenance/audit-language-mismatch.mjs --flag     # set language_review marker
 *   node scripts/maintenance/audit-language-mismatch.mjs --retag-english   # retag confirmed English-as-original (guarded)
 */
import { MongoClient } from 'mongodb';

const FLAG = process.argv.includes('--flag');
const RETAG = process.argv.includes('--retag-english');

const CLASSICAL = new Set(['sanskrit','tibetan','pali','greek','latin','chinese','hebrew','arabic','syriac','coptic','geez','avestan','prakrit','church-slavonic','aramaic','old-persian','pahlavi']);
const MODERN_EURO = new Set(['english','french','german','italian','spanish','dutch','russian','portuguese']);

// normalize a language label to a canonical token
function norm(s) {
  if (!s) return '';
  let t = String(s).toLowerCase().trim();
  const map = {
    'ancient greek':'greek','koine greek':'greek','classical greek':'greek','grc':'greek','el':'greek',
    'pāli':'pali','pali (transliteration)':'pali',
    'san':'sanskrit','sa':'sanskrit',
    'lat':'latin','la':'latin',
    'classical chinese':'chinese','literary chinese':'chinese','mandarin':'chinese','zh':'chinese','zh-hant':'chinese',
    'old church slavonic':'church-slavonic','church slavonic':'church-slavonic',
    "ge'ez":'geez','geʿez':'geez','ethiopic':'geez',
    'he':'hebrew','ar':'arabic','eng':'english','en':'english','fr':'french','de':'german','nl':'dutch','it':'italian','es':'spanish','ru':'russian',
    'marathi':'marathi','hindi':'hindi','nepali':'nepali','ne':'nepali',
  };
  return map[t] || t;
}
// split a possibly multi-language field into a set of canonical tokens
function langSet(s) { return new Set(String(s||'').split(/[;,/|]/).map(norm).filter(Boolean)); }

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const B = mc.db('bookstore').collection('books');

const cursor = B.find(
  { 'ai_metadata.language': { $exists: true, $ne: '' }, language: { $exists: true, $ne: '' } },
  { projection: { id:1, title:1, author:1, language:1, text_role:1, visible:1, 'ai_metadata.language':1, 'ai_metadata.confidence':1, 'ai_metadata.secondary_languages':1 } }
);

// placeholder / non-single-language catalog values that aren't real mislabels
const PLACEHOLDER = new Set(['visual','und','unknown','undetermined','multiple','various','']);
const englishAsOriginal = [], langDrift = [];
let scanned = 0;
for await (const b of cursor) {
  scanned++;
  const curRaw = String(b.language).toLowerCase();
  if (PLACEHOLDER.has(norm(b.language)) || /[;/]| and /.test(curRaw)) continue; // skip placeholders + multi-language fields
  const cur = langSet(b.language);
  const ai = norm(b.ai_metadata?.language);
  const conf = b.ai_metadata?.confidence || 'medium';
  if (!ai || cur.has(ai)) continue;                       // agrees (or ai lang is one of the tagged langs)
  const secondary = new Set([...(b.ai_metadata?.secondary_languages||[])].map(norm));
  if (secondary.has([...cur][0])) {/* book lang is a secondary of ai — still a primary-language mismatch, keep */}
  if (conf === 'low') continue;                            // ignore low-confidence reads
  const curIsClassical = [...cur].some(l => CLASSICAL.has(l));
  const rec = { id:b.id, title:(b.title||'').slice(0,52), author:(b.author||'').slice(0,26), current:b.language, detected:b.ai_metadata.language, conf, text_role:b.text_role||null, visible:b.visible!==false };
  if (MODERN_EURO.has(ai) && curIsClassical && b.text_role !== 'modern-translation') englishAsOriginal.push(rec);
  else if (b.text_role !== 'modern-translation') langDrift.push(rec);
}

const groupPairs = (arr) => {
  const m = {};
  for (const r of arr) { const k = `${r.current} → ${r.detected}`; m[k] = (m[k]||0)+1; }
  return Object.entries(m).sort((a,b)=>b[1]-a[1]);
};

console.log(`scanned ${scanned} enriched books\n`);
console.log(`== ENGLISH/modern-as-original (likely modern translations mislabeled): ${englishAsOriginal.length} ==`);
for (const [k,n] of groupPairs(englishAsOriginal).slice(0,20)) console.log(`   ${k}: ${n}`);
console.log(`\n== LANG_DRIFT (other mismatches, e.g. IA import mistag): ${langDrift.length} ==`);
for (const [k,n] of groupPairs(langDrift).slice(0,25)) console.log(`   ${k}: ${n}`);
console.log('\n-- sample English-as-original (high conf) --');
for (const r of englishAsOriginal.filter(r=>r.conf==='high').slice(0,25)) console.log(`   [${r.current}→${r.detected}|${r.text_role}] ${r.author} — ${r.title} (${r.id})`);

import fs from 'fs';
fs.writeFileSync('/tmp/language-mismatch-audit.json', JSON.stringify({ englishAsOriginal, langDrift }, null, 2));
console.log('\nfull -> /tmp/language-mismatch-audit.json');

if (FLAG) {
  const all = [...englishAsOriginal, ...langDrift];
  let n=0;
  for (const r of all) n += (await B.updateOne({ id:r.id }, { $set: { language_review: true, language_review_detail: { detected:r.detected, current:r.current, confidence:r.conf, bucket: englishAsOriginal.includes(r)?'english_as_original':'lang_drift', flagged_at:new Date() } } })).modifiedCount;
  console.log(`\n[--flag] set language_review on ${n} books`);
}
if (RETAG) {
  // Guarded: only high-confidence ENGLISH-detected (language→English is unambiguous),
  // English-titled (avoid native-title false positives like Arabic-original w/ translation).
  const NATIVE=/[ऀ-ॿༀ-࿿Ͱ-Ͽἀ-῿֐-׿؀-ۿ܀-ݏⲀ-⳿一-鿿]/;
  const targets = englishAsOriginal.filter(r=>r.conf==='high' && norm(r.detected)==='english' && !NATIVE.test(r.title));
  let n=0;
  for (const r of targets) {
    const b = await B.findOne({ id:r.id }, { projection:{ language:1 } });
    n += (await B.updateOne({ id:r.id }, { $set: { text_role:'modern-translation', is_translation:true, language:'English', original_language:b.language, 'field_provenance.text_role':'audit_language_mismatch_auto', updated_at:new Date() } })).modifiedCount;
  }
  console.log(`\n[--retag-english] retagged ${n}/${targets.length} high-confidence English-as-original as modern-translation`);
}
await mc.close();
process.exit(0);
