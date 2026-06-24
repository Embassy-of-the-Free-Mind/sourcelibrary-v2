// scripts/maintenance/backfill-language-provenance.mjs
//
// Issue #2184 remediation. The import boundary is fixed going forward (#2185 /
// PR #2198), but the EXISTING corpus still carries the old provenance shape:
// `field_provenance.language` records the writing STAGE ("import / internet_archive")
// but NOT the value, and NOT what each source actually claimed. A wrong value
// therefore wears a trustworthy badge and nothing can detect the contradiction.
//
// This backfill makes stored provenance honest, in three tiers:
//
//   A. ENRICH (all stage-only records) — strictly additive. Record `value` (the
//      current language) + `claims` (every source signal we hold: the import's
//      own assertion, ai_metadata.language, IA ocr_detected_lang, booksbylanguage_*
//      collection). Preserves the existing source/provider/date. Changes nothing
//      a reader sees — it just makes the provenance auditable.
//
//   B. FLIP (page-OCR-confirmed mislabels) — for records where an empirical
//      signal disagrees with the catalogued language AND the per-page Gemini
//      <lang> tag confirms the catalogued language is ABSENT from the scan
//      (catFrac == 0), set language = dominant page language, original_language =
//      the old (work) language, is_translation = true, language_review = true.
//      The flip itself is recorded in provenance: prior_value + page evidence +
//      basis. This CHANGES public display, so it only runs with --apply --flip.
//
//   C. FLAG (softer disagreement) — an empirical signal disagrees but the scan
//      isn't cleanly "absent" (bilingual / front-matter / noisy AI). Set
//      language_review = true and record the disagreement, but DON'T flip —
//      leave it for human triage.
//
// DRY RUN BY DEFAULT. Writes only with --apply. By default --apply runs tier A
// (and C flags) but NOT the language flips; add --flip to include tier B.
//
// Usage:
//   set -a; source .env.production.local; set +a
//   node scripts/maintenance/backfill-language-provenance.mjs              # dry run, all tiers reported
//   node scripts/maintenance/backfill-language-provenance.mjs --apply      # write A + C, report B
//   node scripts/maintenance/backfill-language-provenance.mjs --apply --flip  # write A + B + C
//   node scripts/maintenance/backfill-language-provenance.mjs --json report.json

import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
// --flip-display actually rewrites the public `language` for the clean candidate
// set. Without it, --apply only enriches provenance (A) and flags candidates for
// review (B) — display is never changed automatically. Flipping is a curation
// decision: facsimiles (Book of Kells) and bilingual editions produce false
// positives, so it stays opt-in.
const FLIP_DISPLAY = args.includes('--flip-display');
const JSON_OUT = (() => { const i = args.indexOf('--json'); return i >= 0 ? args[i + 1] : null; })();
const SAMPLE_PAGES = 20;

// ---- language normalisation (mirror of src/lib/language-utils.ts displayLanguage) ----
const CODE = {
  ar:'Arabic',cs:'Czech',da:'Danish',de:'German',el:'Greek',en:'English',es:'Spanish',fa:'Persian',
  fr:'French',he:'Hebrew',hu:'Hungarian',it:'Italian',ja:'Japanese',la:'Latin',nl:'Dutch',no:'Norwegian',
  pl:'Polish',pt:'Portuguese',ru:'Russian',sa:'Sanskrit',sv:'Swedish',tr:'Turkish',zh:'Chinese',
  ara:'Arabic',ces:'Czech',cze:'Czech',dan:'Danish',deu:'German',ger:'German',ell:'Greek',gre:'Greek',
  grc:'Greek',eng:'English',spa:'Spanish',fas:'Persian',per:'Persian',fra:'French',fre:'French',heb:'Hebrew',
  hun:'Hungarian',ita:'Italian',jpn:'Japanese',lat:'Latin',nld:'Dutch',dut:'Dutch',nor:'Norwegian',pol:'Polish',
  por:'Portuguese',rus:'Russian',san:'Sanskrit',swe:'Swedish',tur:'Turkish',zho:'Chinese',chi:'Chinese',
  hin:'Hindi',tel:'Telugu',tam:'Tamil',mar:'Marathi',syr:'Syriac',urd:'Urdu',
  // Indic / other 2-letter codes (the gap that produced "Hi"/"Te" in the first dry run)
  hi:'Hindi',te:'Telugu',ta:'Tamil',mr:'Marathi',ml:'Malayalam',kn:'Kannada',bn:'Bengali',
  gu:'Gujarati',pa:'Punjabi',or:'Odia',si:'Sinhala',ur:'Urdu',ko:'Korean',vi:'Vietnamese',
  mal:'Malayalam',kan:'Kannada',ben:'Bengali',guj:'Gujarati',pan:'Punjabi',ori:'Odia',
};
const PLACEHOLDER = new Set(['none','n/a','na','unknown','und','null','','multiple','mul','mixed','various','zxx','undetermined']);
function displayLanguage(raw) {
  if (!raw) return null;
  const x = String(raw).toLowerCase().trim().replace(/^(modern|ancient|old|classical|medieval|middle|early)\s+/, '');
  if (!x || PLACEHOLDER.has(x)) return null;
  if (CODE[x]) return CODE[x];
  return x.charAt(0).toUpperCase() + x.slice(1);
}
const same = (a, b) => { const x = displayLanguage(a), y = displayLanguage(b); return !!x && !!y && x.toLowerCase() === y.toLowerCase(); };

// ---- connect ----
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set — source .env.production.local first.'); process.exit(1); }
const c = new MongoClient(uri);
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

const FILTER = {
  'field_provenance.language.source': { $exists: true },
  'field_provenance.language.value': { $exists: false }, // not yet backfilled (idempotent)
};

const all = await books.find(FILTER, {
  projection: {
    language: 1, title: 1, slug: 1,
    'image_source.provider': 1,
    'catalog_metadata.ocr_detected_lang': 1,
    'catalog_metadata.collections': 1,
    'ai_metadata.language': 1,
    'field_provenance.language': 1,
  },
}).toArray();

console.error(`${all.length} stage-only records to process${APPLY ? (FLIP_DISPLAY ? ' (APPLY + FLIP DISPLAY)' : ' (APPLY, provenance + flags only)') : ' (DRY RUN)'}.\n`);

const STAMP = '2026-05-30'; // fixed; scripts can't call Date.now() deterministically across resume, but here it's fine

const enrich = [];   // tier A — every record
const conflicts = []; // empirical signal disagrees with catalogued language → page-OCR check
let scanned = 0;

for (const b of all) {
  scanned++;
  if (scanned % 2000 === 0) console.error(`  ...${scanned}/${all.length}`);

  const current = displayLanguage(b.language);
  const provider = b.image_source?.provider || 'unknown';

  // Gather claims (each source + the value it asserts).
  const claims = [];
  // 1. the import's own assertion (what's stored as the catalogued language)
  if (current) claims.push({ source: `import:${provider}`, value: current });
  // 2. our AI enrichment's detected language (empirical — it read the pages)
  const aiLang = displayLanguage(b.ai_metadata?.language);
  if (aiLang) claims.push({ source: 'ai_enrichment', value: aiLang });
  // 3. IA OCR-detected language
  const ocrLang = displayLanguage(b.catalog_metadata?.ocr_detected_lang);
  if (ocrLang) claims.push({ source: 'ia_ocr_detected', value: ocrLang });
  // 4. IA booksbylanguage_* collection tag
  const cols = Array.isArray(b.catalog_metadata?.collections) ? b.catalog_metadata.collections : [];
  const colLangRaw = cols.map((x) => /^booksbylanguage_(.+)$/i.exec(String(x))?.[1]).find(Boolean) || null;
  const colLang = displayLanguage(colLangRaw);
  if (colLang) claims.push({ source: 'ia_collection', value: colLang });

  // De-dup claims by (source,value).
  const seen = new Set();
  const dedupClaims = claims.filter((cl) => { const k = cl.source + '|' + cl.value.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });

  // Merge into the existing provenance object (preserve source/provider/date).
  const existing = b.field_provenance?.language || {};
  const newProv = {
    ...existing,
    value: current || b.language || 'Unknown',
    claims: dedupClaims,
    backfilled: true,
    backfill_basis: 'issue #2184 — recorded the value + each source claim onto the existing import-stage stamp',
    backfill_date: STAMP,
  };
  enrich.push({ id: b._id, prov: newProv });

  // Empirical disagreement? (AI / OCR / collection says something other than catalogued)
  const empirical = [aiLang, ocrLang, colLang].filter(Boolean);
  const disagree = current && empirical.some((e) => !same(e, current));
  if (disagree) {
    conflicts.push({ b, current, claims: dedupClaims, empirical: [...new Set(empirical)] });
  }
}

console.error(`Tier A (provenance enrich): ${enrich.length} records.`);
console.error(`Empirical disagreements to verify against page-OCR: ${conflicts.length}.\n`);

// ---- Tier B/C: page-OCR confirmation for the conflict subset ----
const flips = [];  // tier B — clean single-language mislabel candidates

for (const { b, current } of conflicts) {
  const tagged = await pages.find(
    { book_id: b._id.toString(), 'ocr.data': /<lang>/i },
    { projection: { 'ocr.data': 1, page_number: 1 } }
  ).sort({ page_number: 1 }).toArray();

  let dom = null, catFrac = null, nTags = 0;
  if (tagged.length >= 3) {
    const step = Math.max(1, Math.floor(tagged.length / SAMPLE_PAGES));
    const sampled = tagged.filter((_, i) => i % step === 0).slice(0, SAMPLE_PAGES);
    const tags = sampled
      .map((p) => displayLanguage((p.ocr.data.match(/<lang>([^<]+)<\/lang>/i) || [])[1]))
      .filter((t) => t && !/[,/]/.test(t));
    nTags = tags.length;
    if (tags.length >= 3) {
      catFrac = tags.filter((t) => same(t, current)).length / tags.length;
      const freq = {};
      tags.forEach((t) => (freq[t] = (freq[t] || 0) + 1));
      dom = Object.entries(freq).sort((x, y) => y[1] - x[1])[0][0];
    }
  }

  const rec = {
    id: b._id, slug: b.slug || null, title: (b.title || '').slice(0, 60),
    from: current, dom, catFrac, nTags, provider: b.image_source?.provider,
  };

  // A compound/multi-language catalogued label (e.g. "Greek/latin", "Sanskrit-english",
  // "Multiple (...)") can never string-match a single page <lang> tag, so it shows
  // catFrac 0 spuriously — those are bilingual/parallel editions, NOT mislabels.
  // Exclude them from the review/flip set; their claims are still recorded by tier A.
  const isCompound = (s) => /[\/\-,]|multiple|\band\b/i.test(s || '');

  if (dom && catFrac === 0 && !same(dom, current) && !isCompound(current) && !isCompound(dom)) {
    // Clean single-language candidate: catalogued language absent across the
    // whole sampled book, one clear dominant scan language. The strongest
    // mislabel signal — but still needs human confirmation (facsimiles whose
    // script the OCR can't read produce false positives), so it's flagged +
    // a proposed value is recorded, not auto-flipped unless --flip-display.
    flips.push(rec);
  }
  // Everything else (compound labels, bilingual, front-matter, no page tags):
  // the disagreement is already captured in tier-A claims. No flag, no flip.
}

console.error(`Tier B (clean single-language mislabel candidates, page-OCR-confirmed): ${flips.length}`);
console.error(`  (compound/bilingual disagreements are captured in tier-A claims only — not flagged)\n`);

console.error('--- Tier B candidates (sample 50) ---');
console.table(flips.slice(0, 50).map((f) => ({ from: f.from, proposed: f.dom, title: f.title })));

// ---- WRITE ----
if (APPLY) {
  // Tier A — enrich provenance (additive). Batched bulkWrite.
  let aWrites = 0;
  for (let i = 0; i < enrich.length; i += 500) {
    const batch = enrich.slice(i, i + 500).map((e) => ({
      updateOne: { filter: { _id: e.id }, update: { $set: { 'field_provenance.language': e.prov } } },
    }));
    const r = await books.bulkWrite(batch, { ordered: false });
    aWrites += r.modifiedCount;
  }
  console.error(`Tier A applied: ${aWrites} provenance records enriched.`);

  // Tier B — flag clean mislabel candidates for review and RECORD the proposed
  // correction in provenance, but leave the displayed `language` untouched unless
  // --flip-display is given. This stages a fix without acting on it.
  let flagged = 0, flipped = 0;
  for (const f of flips) {
    const set = {
      language_review: true,
      'field_provenance.language.proposed_value': f.dom,
      'field_provenance.language.review_basis': `page-OCR <lang> tags: catalogued "${f.from}" absent across ${f.nTags} sampled pages; dominant scan language "${f.dom}". Candidate translation-mislabel — issue #2184.`,
      'field_provenance.language.review_date': STAMP,
    };
    if (FLIP_DISPLAY) {
      set.language = f.dom;
      set.original_language = f.from;
      set.is_translation = true;
      set['field_provenance.language.value'] = f.dom;
      set['field_provenance.language.prior_value'] = f.from;
      set['field_provenance.language.flipped'] = true;
      set['field_provenance.language.flip_date'] = STAMP;
    }
    const r = await books.updateOne({ _id: f.id }, { $set: set });
    if (r.modifiedCount) { flagged++; if (FLIP_DISPLAY) flipped++; }
  }
  console.error(`Tier B applied: ${flagged} flagged for review${FLIP_DISPLAY ? `, ${flipped} languages flipped (display changed)` : ' (display unchanged — pass --flip-display to rewrite language)'}.`);
} else {
  console.error('DRY RUN — no writes. Re-run with --apply (and --flip for tier B).');
}

if (JSON_OUT) {
  const { writeFileSync } = await import('fs');
  writeFileSync(JSON_OUT, JSON.stringify({
    counts: { enrich: enrich.length, conflicts: conflicts.length, candidates: flips.length },
    candidates: flips.map((f) => ({ ...f, id: f.id.toString() })),
    enrich_sample: enrich.slice(0, 5).map((e) => ({ id: e.id.toString(), prov: e.prov })),
  }, null, 2));
  console.error(`Wrote report to ${JSON_OUT}`);
}

await c.close();
