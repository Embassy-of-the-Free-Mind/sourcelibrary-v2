#!/usr/bin/env node
/**
 * Apply discovery-pass results: books where the discovery pass found a real
 * English translation get flipped confirmed_first → translation_found.
 *
 * Discovery results are written by discover-translations-estimate.mjs into
 * translation_verification.discovery_estimate_2026_05_30. This script reads
 * those records and mutates dispositions.
 *
 * Decision table:
 *   discovery.translation_exists + high conf + complete  → translation_found
 *   discovery.translation_exists + (medium conf OR partial) → needs_review
 *                                                            (human triage)
 *   discovery.translation_exists + suspect reasoning      → needs_review
 *   discovery.translation_exists=false                    → no change (stays
 *                                                          confirmed_first)
 *
 * Same NEGATIVE_PATTERNS filter as apply-audit-verdicts.mjs.
 *
 * Reversibility: previous_disposition_before_discovery + flag for undo.
 *
 * Usage:
 *   node scripts/maintenance/apply-discovery-results.mjs            # dry-run
 *   node scripts/maintenance/apply-discovery-results.mjs --apply
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

function loadEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync('.env.production.local', 'utf8').split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        env[m[1].trim()] = v;
      }
    }
  } catch {}
  return { ...process.env, ...env };
}

const env = loadEnv();
const apply = process.argv.includes('--apply');
// Stable field names (#2332 Task 2). LEGACY_* are the pre-rename dated markers,
// still honored on read so already-applied / already-estimated books survive the
// transition until migrate-ft-dated-fields.mjs backfills legacy→stable.
const FLAG = 'discovery_applied';
const LEGACY_FLAG = 'discovery_applied_2026_05_30';
const ESTIMATE = 'discovery_estimate';
const LEGACY_ESTIMATE = 'discovery_estimate_2026_05_30';

// Same as apply-audit-verdicts — reasoning text patterns that mean the
// discovered "translation" is actually a study, edition, partial, or
// different work than the Mongo book.
const NEGATIVE_PATTERNS = [
  /\bnot a (full |complete |true )?translation\b/i,
  /\bnot a translation\b/i,
  /\b(does|do) not (include|contain|constitute) a (full|complete)\b/i,
  /\bnot a complete\b/i,
  /\bscholarly (study|article|edition|monograph|work|survey)\b/i,
  /\b(is|was) a (study|analysis|commentary|monograph|edition|introduction|reference)\b/i,
  /\bcritical edition\b/i,
  /\b(greek|latin|chinese|arabic|hebrew|sanskrit|syriac|tibetan|armenian) (text|critical edition)\b/i,
  /\bmonograph\b/i,
  /\b(partial|partially|excerpt|excerpts|abridged|selection of|selections only)\b/i,
  /\bdifferent (work|book|treatise|text|publication)\b/i,
  /\bbut the title (is|was|of the work)\b/i,
  /\bbut it (was|is) titled\b/i,
  /\bactual title (is|was)\b/i,
  /\bthe (actual|correct) work\b/i,
  /\b(was|is) the editor, not the translator\b/i,
  /\bdid not translate\b/i,
  /\bincorrectly (groups|conflates|combines|attributes)\b/i,
  /\bmiddle english\b/i,
  /\bold english (text|translation|version)\b/i,
  /\boriginally written in english\b/i,
];
// Known scholarly digital corpora that ARE the English translation deliverable,
// even when their reasoning mentions underlying "scholarly editions" of the
// source-language text. Override the NEGATIVE_PATTERNS filter for these.
// ETCSL false-positive was the discovery: my filter caught "scholarly edition by
// Sjöberg" (the underlying Sumerian text) and held back ETCSL English translations.
const CORPORA_OVERRIDES = [
  /\bETCSL\b/i,
  /\bElectronic Text Corpus of Sumerian Literature\b/i,
  /\bORACC\b/,
  /\bOpen Richly Annotated Cuneiform Corpus\b/i,
  /\bCTEXT\b|\bChinese Text Project\b/i,
  /\bctext\.org\b/i,
  /\bPerseus Digital Library\b/i,
  /\bGRETIL\b/i,
  /\bGöttingen Register of Electronic Texts in Indian Languages\b/i,
  /\b84000\b.*\b(Translating the Words of the Buddha|tibetan)\b/i,
  /\bBDRC\b|\bTBRC\b|\bBuddhist Digital Resource Center\b/i,
  /\bTLA\b.*\bThesaurus Linguae Aegyptiae\b/i,
  /\bCDLI\b|\bCuneiform Digital Library Initiative\b/i,
  /\bDigital Hammurabi\b/i,
  /\bThLL\b|\bThesaurus Linguae Latinae\b/i,
];
const matchesCorpusOverride = r => r && CORPORA_OVERRIDES.some(p => p.test(r));

// Filter: reasoning is suspect UNLESS it explicitly cites a known scholarly
// corpus that provides the English translation as its deliverable.
function reasoningSuspect(r) {
  if (!r) return false;
  if (matchesCorpusOverride(r)) return false;  // scholarly corpus override
  return NEGATIVE_PATTERNS.some(p => p.test(r));
}

const c = new MongoClient(env.MONGODB_URI); await c.connect();
const db = c.db(env.MONGODB_DB || 'bookstore');

const eligible = await db.collection('books').find({
  'translation_verification.disposition': 'confirmed_first',
  // has an estimate under EITHER name, and not-yet-applied under EITHER name
  $or: [
    { [`translation_verification.${ESTIMATE}`]: { $exists: true } },
    { [`translation_verification.${LEGACY_ESTIMATE}`]: { $exists: true } },
  ],
  [`translation_verification.${FLAG}`]: { $ne: true },
  [`translation_verification.${LEGACY_FLAG}`]: { $ne: true },
}).project({
  id: 1, language: 1, author: 1,
  'translation_verification.disposition': 1,
  'translation_verification.disposition_reasoning': 1,
  [`translation_verification.${ESTIMATE}`]: 1,
  [`translation_verification.${LEGACY_ESTIMATE}`]: 1,
}).toArray();
console.log(`Eligible books (with discovery results): ${eligible.length}`);

const counts = {
  found_high_complete_to_translation_found: 0,
  found_suspect_kept_confirmed_first: 0,
  found_low_or_partial_kept_confirmed_first: 0,
  found_unresolvable_kept_confirmed_first: 0,
  not_found_no_change: 0,
};
const samples = { tf: [], suspect: [], partial: [], unresolvable: [] };
const now = new Date();

// GUARD (stop-the-bleeding, 2026-06-30): a demote is a destructive public claim —
// it must rest on a REAL, RESOLVABLE sighting, never a url-less or fabricated
// "prior". A prior audit found ~450 confirmed_first books already flipped to
// translation_found on discovery priors with no URL and placeholder translators
// (e.g. "Not specified (AI-assisted/Collaborative digital project)"), silently
// stripping genuine first translations. Require BOTH: grounding evidence with a
// real URL, AND a non-placeholder translator — else keep confirmed_first and
// mark for review. (First Principle / §17: never demote on an unverified match.)
const hasResolvableEvidence = (d) =>
  Array.isArray(d.evidence) && d.evidence.some((e) => typeof e?.url === 'string' && /^https?:\/\//.test(e.url));
const PLACEHOLDER_TRANSLATOR =
  /not specified|unspecified|ai[- ]?assisted|machine[- ]?translat|auto[- ]?translat|collaborative digital|generated|\btbd\b|^\s*n\/?a\s*$|^\s*unknown\s*$|^\s*none\s*$/i;
const realTranslator = (t) => {
  const s = (t || '').trim();
  return s.length >= 3 && !PLACEHOLDER_TRANSLATOR.test(s);
};

for (const b of eligible) {
  const d = b.translation_verification[ESTIMATE] ?? b.translation_verification[LEGACY_ESTIMATE];
  if (!d.translation_exists) { counts.not_found_no_change++; continue; }

  // Reasoning-text gate — same as apply-audit-verdicts
  if (reasoningSuspect(d.reasoning)) {
    counts.found_suspect_kept_confirmed_first++;
    if (samples.suspect.length < 4) samples.suspect.push({ id: b.id, lang: b.language, trans: d.translation, reason: d.reasoning?.slice(0, 180) });
    if (apply) {
      await db.collection('books').updateOne(
        { _id: b._id },
        { $set: {
          [`translation_verification.${FLAG}`]: true,
          'translation_verification.discovery_alt_suspect': true,
        }}
      );
    }
    continue;
  }

  // Completeness / confidence gate
  const conf = d.confidence;
  const comp = d.translation?.completeness;
  if (conf !== 'high' || comp !== 'complete') {
    counts.found_low_or_partial_kept_confirmed_first++;
    if (samples.partial.length < 4) samples.partial.push({ id: b.id, lang: b.language, conf, comp, trans: d.translation });
    if (apply) {
      await db.collection('books').updateOne(
        { _id: b._id },
        { $set: {
          [`translation_verification.${FLAG}`]: true,
          'translation_verification.discovery_partial_or_low_conf': true,
        }}
      );
    }
    continue;
  }

  // Resolvable-sighting gate — do NOT demote on a url-less or fabricated prior.
  if (!hasResolvableEvidence(d) || !realTranslator(d.translation?.translator)) {
    counts.found_unresolvable_kept_confirmed_first++;
    if (samples.unresolvable.length < 6) samples.unresolvable.push({ id: b.id, lang: b.language, trans: d.translation, has_url: hasResolvableEvidence(d) });
    if (apply) {
      await db.collection('books').updateOne(
        { _id: b._id },
        { $set: {
          [`translation_verification.${FLAG}`]: true,
          'translation_verification.discovery_unresolvable_prior': true,
        }}
      );
    }
    continue;
  }

  // High-confidence complete translation found WITH a resolvable, real prior → flip
  counts.found_high_complete_to_translation_found++;
  if (samples.tf.length < 5) samples.tf.push({ id: b.id, lang: b.language, trans: d.translation });

  if (!apply) continue;

  await db.collection('books').updateOne(
    { _id: b._id, 'translation_verification.disposition': 'confirmed_first' },
    { $set: {
      'translation_verification.previous_disposition_before_discovery': b.translation_verification.disposition,
      'translation_verification.previous_disposition_reasoning_before_discovery': b.translation_verification.disposition_reasoning || null,
      'translation_verification.disposition': 'translation_found',
      'translation_verification.disposition_reasoning': `Discovery pass (gemini grounded search, 2026-05-30) found "${d.translation.english_title}" by ${d.translation.translator} (${d.translation.pub_year}) [${d.translation.completeness}]. ${d.reasoning || ''}`.slice(0, 800),
      'translation_verification.disposition_at': now,
      'translation_verification.validated_translations': [{
        english_title: d.translation.english_title,
        translator: d.translation.translator,
        pub_year: d.translation.pub_year,
        publisher: d.translation.publisher,
        completeness: d.translation.completeness,
        evidence_source: 'gemini_grounding_discovery',
        validated: true,
        notes: d.reasoning?.slice(0, 200) || '',
      }],
      [`translation_verification.${FLAG}`]: true,
      is_first_translation: false,
      updated_at: now,
    }}
  );
}

console.log('\n=== Action counts ===');
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
console.log('\n=== Sample flips to translation_found ===');
for (const s of samples.tf) console.log(`  [${s.id}] (${s.lang}) → "${s.trans?.english_title?.slice(0, 50)}" by ${s.trans?.translator?.slice(0, 30)}`);
console.log('\n=== Sample suspect kept confirmed_first ===');
for (const s of samples.suspect) console.log(`  [${s.id}] (${s.lang}) suspect: ${s.reason}`);
console.log('\n=== Sample partial/low-conf kept confirmed_first ===');
for (const s of samples.partial) console.log(`  [${s.id}] (${s.lang}) conf=${s.conf} comp=${s.comp} alt="${s.trans?.english_title?.slice(0, 45)}"`);
console.log('\n=== Sample BLOCKED demotes (unresolvable/fabricated prior — kept confirmed_first) ===');
for (const s of samples.unresolvable) console.log(`  [${s.id}] (${s.lang}) url=${s.has_url ? 'Y' : '-'} translator="${(s.trans?.translator || '').slice(0, 40)}" alt="${(s.trans?.english_title || '').slice(0, 40)}"`);

if (apply) {
  const after = await db.collection('books').aggregate([
    { $match: { 'translation_verification.disposition': { $exists: true } } },
    { $group: { _id: '$translation_verification.disposition', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();
  console.log('\n=== Post-apply disposition counts ===');
  for (const r of after) console.log(`  ${r._id}: ${r.n}`);
} else {
  console.log('\nDry-run. Re-run with --apply to mutate.');
}

await c.close();
