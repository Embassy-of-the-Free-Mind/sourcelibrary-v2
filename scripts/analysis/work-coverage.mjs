/**
 * work-coverage.mjs — cluster editions by work, compute original-vs-translation
 * coverage, and surface a RELIABLE "missing original" list.
 *
 * Motivation: `text_role: modern-translation` does NOT mean we lack the
 * original — the original usually sits as a separate, unlinked book. Inferring
 * gaps from the (half-filled) original_edition_id link produced a wrong gap
 * list (2026-06-17). The fix: cluster all editions of a work, then read
 * coverage off the cluster.
 *
 * Cluster key = work_id (Wikidata QID) when present, else a romanized
 * work-title core + author surname. Both our originals and our translations
 * tend to carry the romanized work name (e.g. "Mahābhārata", "Dhammapada",
 * "Suśruta-saṃhitā"), so the title-core join works across the translation
 * boundary for most of the catalog.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/analysis/work-coverage.mjs            # report + self-validation
 *   node scripts/analysis/work-coverage.mjs --backfill # write have_original / original_missing flags (with backup)
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const BACKFILL = process.argv.includes('--backfill');

// classical / source languages — an "original" must be in one of these
const ORIGINAL_LANGS = new Set(['sanskrit','pali','pāli','prakrit','tibetan','greek','ancient greek','latin','classical chinese','chinese','hebrew','aramaic','arabic','syriac','coptic','geez','ge\'ez','avestan','pahlavi','old persian','persian','church-slavonic']);

const deaccent = s => (s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'');
// reduce a title to its work core
function workKey(title) {
  let t = deaccent(String(title||'')).toLowerCase();
  t = t.replace(/[\(\[].*?[\)\]]/g,' ');                 // drop parentheticals/brackets
  t = t.split(/ [—–-] |:| with | trans| edited| ed\.| translated/)[0]; // drop subtitle/apparatus
  t = t.replace(/\b(vol|volume|part|pt|book|kanda|parvan|fasc)\.?\s*[ivxlcdm0-9]+\b/g,' ');
  t = t.replace(/\b(the|a|an|of|and|with|complete|text|sanskrit|pali|greek|latin|samhita|sutra|sutras|commentary|hymns?|selected|edition)\b/g,' ');
  t = t.replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  return t.split(' ').filter(w=>w.length>2).slice(0,4).join(' ');  // distinctive head
}
const authorKey = a => deaccent(String(a||'')).toLowerCase().replace(/\(.*?\)|trans\.?|ed\.?|comm\.?/g,'').replace(/[^a-z ]/g,' ').trim().split(/\s+/).filter(w=>w.length>2).slice(-1)[0]||''; // surname-ish

const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const B = mc.db('bookstore').collection('books');
// pull books that are an original-language edition OR a translation — i.e. anything with a text_role
const books = await B.find(
  { $or: [ { text_role: { $exists: true } }, { language: { $exists: true } } ], title: { $exists: true, $ne: '' } },
  { projection: { id:1, title:1, author:1, language:1, original_language:1, text_role:1, work_id:1, visible:1 } }
).toArray();

// build clusters
const clusters = new Map();
for (const b of books) {
  const wk = workKey(b.title);
  if (!wk) continue;
  const key = b.work_id ? `wid:${b.work_id}` : `${wk}|${authorKey(b.author)}`;
  if (!clusters.has(key)) clusters.set(key, []);
  clusters.get(key).push(b);
}

const isOriginalEdition = b => b.text_role !== 'modern-translation' && ORIGINAL_LANGS.has(String(b.language||'').toLowerCase());
const isTranslation = b => b.text_role === 'modern-translation' || String(b.language||'').toLowerCase()==='english';

const rows = [];
for (const [key, members] of clusters) {
  const origs = members.filter(isOriginalEdition);
  const trans = members.filter(isTranslation);
  if (!trans.length && !origs.length) continue;
  const origLang = (members.find(m=>m.original_language)?.original_language) || origs[0]?.language || trans[0]?.original_language || '?';
  rows.push({
    key, n: members.length,
    title: (members.find(isTranslation)||members[0]).title,
    origLang,
    hasOriginal: origs.length>0, hasTranslation: trans.length>0,
    origId: origs[0]?.id || null,
    transIds: trans.map(t=>t.id),
    status: origs.length && trans.length ? 'both' : origs.length ? 'original-only' : 'translation-only',
  });
}

// RELIABILITY: a cluster is trustworthy ONLY when keyed by a shared work_id
// (Wikidata QID). Title-keyed clusters can't bridge an English-titled
// translation to its source-language original, so their coverage is UNKNOWN,
// not a gap. This is the guard against over-reporting (the 2026-06-17 error).
const reliable = rows.filter(r => r.key.startsWith('wid:'));
const unknown  = rows.filter(r => !r.key.startsWith('wid:'));
const both = reliable.filter(r=>r.status==='both');
const transOnly = reliable.filter(r=>r.status==='translation-only');     // CONFIRMED gaps
const origOnly = reliable.filter(r=>r.status==='original-only');
console.log(`clustered ${books.length} editions; ${rows.length} works have a translation or original.`);
console.log(`\nRELIABLE (work_id-keyed) — ${reliable.length} works:`);
console.log(`  ✓ BOTH original + translation:        ${both.length}`);
console.log(`  ○ original only (no translation):     ${origOnly.length}`);
console.log(`  ⚠ CONFIRMED gap (translation, no orig): ${transOnly.length}`);
console.log(`\nUNKNOWN COVERAGE (no work_id, can't tell): ${unknown.length} works`);
console.log(`  → populating work_id on these is the work that makes coverage knowable (#2318).`);

const byLang = arr => { const m={}; for(const r of arr){ const l=String(r.origLang).toLowerCase(); m[l]=(m[l]||0)+1; } return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join('  '); };
console.log('\n  confirmed-gap by original language:', byLang(transOnly) || '(none yet — few work_id clusters)');

console.log('\n=== SELF-VALIDATION (these should read "both") ===');
const probes = ['mahabharata','dhammapada','susruta','atharvaveda','milinda','plato'];
for (const p of probes) {
  const hit = rows.find(r => workKey(r.title).includes(p) || r.key.includes(p));
  console.log(`  ${p}: ${hit ? hit.status+` (orig=${hit.hasOriginal}, trans=${hit.hasTranslation})` : 'no cluster'}`);
}

console.log('\n=== sample TRANSLATION-ONLY works (reliable acquire targets) ===');
for (const r of transOnly.slice(0,30)) console.log(`  [${r.origLang}] ${(r.title||'').slice(0,56)}`);

fs.writeFileSync('/tmp/work-coverage.json', JSON.stringify({ both, origOnly, transOnly }, null, 2));
console.log('\nfull -> /tmp/work-coverage.json');

if (BACKFILL) {
  const ids = [...both.flatMap(r=>r.transIds), ...transOnly.flatMap(r=>r.transIds)];
  const before = await B.find({ id:{$in:ids} },{ projection:{id:1,original_edition_id:1,original_missing:1,have_original:1,_id:0} }).toArray();
  fs.writeFileSync('scripts/output/work-coverage-backfill-backup.json', JSON.stringify(before,null,2));
  let linked=0, missing=0;
  for (const r of both) for (const tid of r.transIds)
    linked += (await B.updateOne({ id:tid }, { $set: { have_original:true, original_edition_id:r.origId, original_coverage_source:'work-coverage-cluster', updated_at:new Date() }, $unset:{ original_missing:'' } })).modifiedCount;
  for (const r of transOnly) for (const tid of r.transIds)
    missing += (await B.updateOne({ id:tid }, { $set: { have_original:false, original_missing:true, original_coverage_source:'work-coverage-cluster', updated_at:new Date() } })).modifiedCount;
  console.log(`\n[--backfill] linked ${linked} translations to a held original; flagged ${missing} as original_missing. Backup saved.`);
}
await mc.close();
process.exit(0);
