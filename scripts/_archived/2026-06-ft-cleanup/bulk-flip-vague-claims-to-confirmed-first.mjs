#!/usr/bin/env node
/**
 * Bulk-flip needs_review books to confirmed_first when the LLM's translation
 * claim is a "Various / Anonymous / placeholder" non-specific form AND no
 * catalog source returned a specific translator.
 *
 * Background (2026-05-30 audit, project_verify_translation_agent_findings.md):
 * 629 of 2,633 needs_review books have llm_knowledge_translations entries
 * tagged with translator='Various', 'Anonymous', 'Various scholars', etc.
 * These encode "I don't know of a specific translation" rather than a
 * verifiable claim. With no specific catalog hit either, holding these in
 * needs_review buries genuine first-translation candidates.
 *
 * Idempotent and reversible:
 *   - Skip books whose current disposition is no longer 'needs_review'
 *   - Backup pre-flip state into translation_verification.previous_disposition
 *     and .previous_disposition_reasoning so an undo script can restore
 *
 * Usage:
 *   node scripts/maintenance/bulk-flip-vague-claims-to-confirmed-first.mjs            # dry-run
 *   node scripts/maintenance/bulk-flip-vague-claims-to-confirmed-first.mjs --apply
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

const VAGUE_RE = /^(various|anonymous|unknown|n\/a|not specified|tbd|none|original|original author).*$|^.*(academic excerpts|various scholars|various academic|various \().*$/i;
function isVague(translator) {
  if (!translator || translator.trim() === '') return true;
  return VAGUE_RE.test(translator.trim());
}

const c = new MongoClient(env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');

const candidates = await db.collection('books').find({
  'translation_verification.disposition': 'needs_review',
}).project({
  id: 1, title: 1, display_title: 1, author: 1, language: 1,
  'translation_verification.llm_knowledge_translations': 1,
  'translation_verification.translations': 1,
  'translation_verification.validated_translations': 1,
  'translation_verification.disposition_reasoning': 1,
}).toArray();

const flippable = [];
const stats = { total: candidates.length, noLlm: 0, allVague: 0, catalogConflict: 0, eligible: 0 };

for (const b of candidates) {
  const llm = b.translation_verification?.llm_knowledge_translations || [];
  const cat = b.translation_verification?.translations || [];
  const val = b.translation_verification?.validated_translations || [];

  if (llm.length === 0) { stats.noLlm++; continue; }
  if (!llm.every(t => isVague(t.translator))) continue;
  stats.allVague++;
  if ([...cat, ...val].some(t => !isVague(t.translator))) { stats.catalogConflict++; continue; }

  stats.eligible++;
  flippable.push(b);
}

console.log('=== Bulk-flip vague-claim needs_review → confirmed_first ===');
console.log('Mode:', apply ? 'APPLYING' : 'DRY RUN');
console.log();
console.log(`Total needs_review books examined:               ${stats.total}`);
console.log(`  Skipped — no llm_knowledge_translations:       ${stats.noLlm}`);
console.log(`  All-LLM-vague (placeholder-only claim):        ${stats.allVague}`);
console.log(`  ...but also has catalog-specific hit (skip):   ${stats.catalogConflict}`);
console.log(`  ✓ Eligible for flip → confirmed_first:         ${stats.eligible}`);
console.log();
console.log('Samples:');
for (const b of flippable.slice(0, 8)) {
  const first = b.translation_verification?.llm_knowledge_translations?.[0];
  console.log(`  [${b.id}] "${(b.display_title || b.title || '').slice(0, 50)}" / ${(b.author || '').slice(0, 28)} (${b.language})`);
  console.log(`    LLM[0]: "${first?.english_title?.slice(0, 45)}" by ${first?.translator?.slice(0, 35)}`);
}

if (!apply) {
  console.log('\nDry-run. Re-run with --apply to mutate.');
  await c.close();
  process.exit(0);
}

console.log(`\n→ Applying flip to ${flippable.length} books...`);
const now = new Date();
const note = `Auto-flipped ${now.toISOString().slice(0, 10)}: LLM claim translator='Various/Anonymous/placeholder' with no catalog-specific hit — no concrete English translation identified. Original disposition + reasoning preserved in translation_verification.previous_*. Reversible via scripts/maintenance/undo-bulk-flip-vague-claims.mjs.`;

let updated = 0, errors = 0;
const errSamples = [];
for (const b of flippable) {
  try {
    const r = await db.collection('books').updateOne(
      { _id: b._id, 'translation_verification.disposition': 'needs_review' },
      {
        $set: {
          'translation_verification.previous_disposition': 'needs_review',
          'translation_verification.previous_disposition_reasoning': b.translation_verification?.disposition_reasoning || null,
          'translation_verification.disposition': 'confirmed_first',
          'translation_verification.confidence': 'medium',
          'translation_verification.disposition_reasoning': note,
          'translation_verification.disposition_at': now,
          'translation_verification.bulk_flip_2026_05_30': true,
        },
      }
    );
    if (r.modifiedCount === 1) updated++;
    if ((updated + errors) % 100 === 0) console.log(`  ${updated + errors}/${flippable.length}…`);
  } catch (e) {
    errors++;
    if (errSamples.length < 5) errSamples.push(`${b.id}: ${e.message}`);
  }
}
console.log(`\nDone. Updated ${updated}/${flippable.length} books. Errors: ${errors}`);
if (errSamples.length) for (const e of errSamples) console.log(`  ${e}`);

// Re-verify final disposition counts
const after = await db.collection('books').aggregate([
  { $match: { 'translation_verification.disposition': { $exists: true } } },
  { $group: { _id: '$translation_verification.disposition', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).toArray();
console.log('\nPost-flip disposition counts:');
for (const r of after) console.log(`  ${r._id}: ${r.n}`);

await c.close();
