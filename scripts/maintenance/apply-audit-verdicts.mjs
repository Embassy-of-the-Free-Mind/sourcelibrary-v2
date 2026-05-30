#!/usr/bin/env node
/**
 * Translate verification_audit records (written by audit-translation-claims.mjs)
 * into actual disposition mutations.
 *
 * Decision table:
 *   confirmed + high           → translation_found, attach audited_claim as
 *                                 validated_translations[0]
 *   contradicted + high + alt + clean reasoning  → translation_found, attach alt
 *   contradicted + high + alt + suspect reasoning → needs_review, record alt as
 *                                 suggested but unverified
 *   contradicted + high + none → confirmed_first, is_first_translation=true
 *   inconclusive               → no change (stays needs_review for human)
 *
 * The "suspect reasoning" filter (NEGATIVE_PATTERNS below) catches alt-replaces
 * where the agent's reasoning text reveals the alt is one of: a different work
 * by the same translator, a scholarly study not a translation, a partial only,
 * a critical edition, etc. 2026-05-30 hand-check of 5 random alt-replaces
 * found 2/5 (40%) had the agent's alt referring to a different work or partial.
 * Filter reduces this to ~10% by deferring suspect cases to needs_review.
 *
 * Idempotent (skips books with audit_applied_2026_05_30:true) and reversible
 * (previous_disposition_before_audit + previous_disposition_reasoning_before_audit
 * preserved, plus the audit_applied flag for targeted undo).
 *
 * Doesn't touch books whose current disposition isn't 'needs_review' anymore
 * (some other script may have moved them since the audit was written).
 *
 * Background: 2026-05-30 audit established the verification_audit pipeline.
 * Spot-check verified 14/14 random verdicts correct. All 1,679 verdicts are
 * 'high' confidence. See memory/project_verify_translation_agent_findings.md.
 *
 * Usage:
 *   node scripts/maintenance/apply-audit-verdicts.mjs            # dry-run
 *   node scripts/maintenance/apply-audit-verdicts.mjs --apply
 *   node scripts/maintenance/apply-audit-verdicts.mjs --apply --limit 50
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
const getArg = name => { const i = process.argv.indexOf(name); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null; };
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : null;
const FLAG = 'audit_applied_2026_05_30';

// Negative reasoning patterns: when the audit's reasoning text contains any of
// these, the alternative_translation_found is suspect — usually a different
// work by the same translator, or a study/edition not a complete translation.
// Defer to needs_review rather than mark translation_found.
const NEGATIVE_PATTERNS = [
  // alt isn't a translation at all
  /\bnot a (full |complete |true )?translation\b/i,
  /\bnot a translation\b/i,
  /\b(does|do) not (include|contain|constitute) a (full|complete)\b/i,
  /\bnot a complete\b/i,
  // alt is a study/edition not a translation
  /\bscholarly (study|article|edition|monograph|work|survey)\b/i,
  /\b(is|was) a (study|analysis|commentary|monograph|edition|introduction|reference)\b/i,
  /\bcritical edition\b/i,
  /\b(greek|latin|chinese|arabic|hebrew|sanskrit|syriac|tibetan|armenian) (text|critical edition)\b/i,
  /\bmonograph\b/i,
  /\bpopular-press adaptation\b/i,
  // alt is partial/excerpts
  /\b(partial|partially|excerpt|excerpts|abridged|selection of|selections only) (translation|version)?\b/i,
  /\bscholarly survey and partial\b/i,
  // agent corrects to a different work — "but the title is/was X" / "different work"
  /\bdifferent (work|book|treatise|text|publication|paracelsian|aquinas|ficino|maier|kepler)\b/i,
  /\bbut the title (is|was|of the work)\b/i,
  /\bbut it (was|is) titled\b/i,
  /\bactual title (is|was)\b/i,
  /\bthe (actual|correct) work\b/i,
  /\bdifferent (title|publication|context)\b/i,
  // alt is an edition by an editor, not a translation
  /\b(was|is) the editor, not the translator\b/i,
  /\bbut .{0,40} was the editor\b/i,
  // direct "did not translate" / "famously associated with other"
  /\bdid not translate\b/i,
  /\bfamously associated with (other|another|different) translator/i,
  /\bincorrectly (groups|conflates|combines|attributes)\b/i,
  /\bas if (they|it) were (a single|one)\b/i,
  /\bnot part of .{0,30} publication\b/i,
  // claim conflated multiple distinct works
  /\bconflates .{0,40} (distinct|different|separate) (works|texts|volumes|publications)\b/i,
  /\bthe (actual|correct) translator\b/i,
  // "the work itself was originally written in" (English originals)
  /\boriginally written in english\b/i,
  /\bwas not (translated|originally) (into english|from)\b/i,
  // middle english / old english (not modern English translation)
  /\bmiddle english\b/i,
  /\bold english (text|translation|version)\b/i,
];
function altIsSuspect(reasoning) {
  if (!reasoning) return false;
  return NEGATIVE_PATTERNS.some(p => p.test(reasoning));
}

const c = new MongoClient(env.MONGODB_URI); await c.connect();
const db = c.db(env.MONGODB_DB || 'bookstore');

const eligible = await db.collection('books').find({
  'translation_verification.disposition': 'needs_review',
  'translation_verification.verification_audit.audited_at': { $exists: true },
  [`translation_verification.${FLAG}`]: { $ne: true },
}).project({
  id: 1,
  'translation_verification.disposition': 1,
  'translation_verification.disposition_reasoning': 1,
  'translation_verification.verification_audit': 1,
}).toArray();

console.log(`Eligible books: ${eligible.length}`);

const queue = LIMIT ? eligible.slice(0, LIMIT) : eligible;
const counts = {
  confirmed_to_translation_found: 0,
  contradicted_with_alt_to_translation_found: 0,
  contradicted_with_alt_suspect_kept_needs_review: 0,
  contradicted_no_alt_to_confirmed_first: 0,
  inconclusive_skipped: 0,
  unexpected_skipped: 0,
};

const samples = { c2tf: [], x2tf: [], x2nr: [], x2cf: [] };
const now = new Date();

for (const b of queue) {
  const audit = b.translation_verification.verification_audit;
  const verdict = audit?.verdict;
  const alt = audit?.alternative_translation_found;
  const claim = audit?.audited_claim;
  let category, action;

  if (verdict === 'confirmed') {
    category = 'confirmed_to_translation_found';
    action = {
      disposition: 'translation_found',
      reasoning: `Audit-verified (gemini grounded search, 2026-05-30): "${claim?.english_title}" by ${claim?.translator} (${claim?.pub_year}). ${audit.reasoning || ''}`,
      validated: claim ? [{
        english_title: claim.english_title,
        translator: claim.translator,
        pub_year: claim.pub_year,
        publisher: claim.publisher,
        completeness: 'unknown',
        evidence_source: 'gemini_grounding_audit',
        validated: true,
        notes: audit.reasoning?.slice(0, 200) || '',
      }] : undefined,
      is_first_translation: false,
    };
  } else if (verdict === 'contradicted' && alt) {
    if (altIsSuspect(audit.reasoning)) {
      // Defer to human — alt may be a different work / study / partial
      category = 'contradicted_with_alt_suspect_kept_needs_review';
      action = {
        disposition: 'needs_review',
        reasoning: `Audit contradicted original claim "${claim?.english_title}" by ${claim?.translator} but the agent's alternative ("${alt.english_title}" by ${alt.translator}, ${alt.pub_year}) was flagged as suspect (may be a different work, scholarly study, partial, or critical edition rather than a complete English translation of this Mongo book). Reasoning: ${audit.reasoning?.slice(0, 200) || ''}`,
        validated: undefined,  // don't promote suspect alt to validated_translations
        is_first_translation: null,  // no change
      };
    } else {
      category = 'contradicted_with_alt_to_translation_found';
      action = {
        disposition: 'translation_found',
        reasoning: `Audit corrected (gemini grounded search, 2026-05-30): original LLM claim "${claim?.english_title}" by ${claim?.translator} was contradicted (${audit.suspected_hallucination?.type || 'wrong'}); actual translation is "${alt.english_title}" by ${alt.translator} (${alt.pub_year}). ${audit.reasoning || ''}`,
        validated: [{
          english_title: alt.english_title,
          translator: alt.translator,
          pub_year: alt.pub_year,
          publisher: alt.publisher,
          completeness: alt.completeness || 'unknown',
          evidence_source: 'gemini_grounding_audit_alternative',
          validated: true,
          notes: `Replaced contradicted claim "${claim?.english_title}" by ${claim?.translator}. ${audit.reasoning?.slice(0, 150) || ''}`,
        }],
        is_first_translation: false,
      };
    }
  } else if (verdict === 'contradicted' && !alt) {
    category = 'contradicted_no_alt_to_confirmed_first';
    action = {
      disposition: 'confirmed_first',
      reasoning: `Audit confirmed first-translation candidate (gemini grounded search, 2026-05-30): LLM claim "${claim?.english_title}" by ${claim?.translator} was contradicted (${audit.suspected_hallucination?.type || 'fabricated'}); no genuine English translation found. ${audit.reasoning || ''}`,
      validated: undefined,
      is_first_translation: true,
    };
  } else if (verdict === 'inconclusive') {
    counts.inconclusive_skipped++;
    continue;
  } else {
    counts.unexpected_skipped++;
    continue;
  }
  counts[category]++;

  // collect a few samples per category
  const bucket = category === 'confirmed_to_translation_found' ? 'c2tf'
    : category === 'contradicted_with_alt_to_translation_found' ? 'x2tf'
    : category === 'contradicted_with_alt_suspect_kept_needs_review' ? 'x2nr'
    : 'x2cf';
  if (samples[bucket].length < 4) {
    samples[bucket].push({
      id: b.id,
      claim,
      alt,
      verdict,
      newDispo: action.disposition,
      reasoning: action.reasoning.slice(0, 220),
    });
  }

  if (!apply) continue;

  const update = {
    [`translation_verification.${FLAG}`]: true,
    updated_at: now,
  };
  // Disposition mutation paths (skip if keeping at needs_review)
  if (action.disposition !== 'needs_review') {
    update['translation_verification.previous_disposition_before_audit'] = b.translation_verification.disposition;
    update['translation_verification.previous_disposition_reasoning_before_audit'] = b.translation_verification.disposition_reasoning || null;
    update['translation_verification.disposition'] = action.disposition;
    update['translation_verification.disposition_reasoning'] = action.reasoning;
    update['translation_verification.disposition_at'] = now;
    if (action.is_first_translation != null) update.is_first_translation = action.is_first_translation;
  } else {
    // Just record the breadcrumb + suspect alt for human reviewer
    update['translation_verification.audit_alt_suspect'] = true;
    update['translation_verification.audit_alt_suspect_reasoning'] = action.reasoning;
  }
  if (action.validated) {
    update['translation_verification.validated_translations'] = action.validated;
  }
  await db.collection('books').updateOne(
    { _id: b._id, 'translation_verification.disposition': 'needs_review' },
    { $set: update }
  );
}

console.log('\n=== Action counts ===');
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
console.log('\n=== Sample: confirmed → translation_found ===');
for (const s of samples.c2tf) {
  console.log(`  [${s.id}] "${s.claim?.english_title?.slice(0, 50)}" by ${s.claim?.translator?.slice(0, 30)}`);
}
console.log('\n=== Sample: contradicted + alt → translation_found (passed filter) ===');
for (const s of samples.x2tf) {
  console.log(`  [${s.id}] CLAIM: "${s.claim?.english_title?.slice(0, 45)}" by ${s.claim?.translator?.slice(0, 25)}`);
  console.log(`         ALT:   "${s.alt?.english_title?.slice(0, 45)}" by ${s.alt?.translator?.slice(0, 25)}`);
}
console.log('\n=== Sample: contradicted + alt → SUSPECT, kept at needs_review ===');
for (const s of samples.x2nr) {
  console.log(`  [${s.id}] CLAIM: "${s.claim?.english_title?.slice(0, 45)}" by ${s.claim?.translator?.slice(0, 25)}`);
  console.log(`         ALT:   "${s.alt?.english_title?.slice(0, 45)}" by ${s.alt?.translator?.slice(0, 25)}`);
}
console.log('\n=== Sample: contradicted no alt → confirmed_first ===');
for (const s of samples.x2cf) {
  console.log(`  [${s.id}] "${s.claim?.english_title?.slice(0, 50)}" by ${s.claim?.translator?.slice(0, 25)} → confirmed_first`);
}

if (apply) {
  // Final disposition counts after mutation
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
