/**
 * Seed language-specific OCR and translation prompts into the DB.
 *
 * Imports Arabic, Hebrew, Latin, and German prompts from the TypeScript
 * source files into the `prompts` collection with proper versioning.
 * Creates new versions if content has changed; skips if identical.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/migration/seed-language-prompts.mjs
 *   --dry-run    Preview without writing
 */

import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';

const DRY_RUN = process.argv.includes('--dry-run');

function contentHash(text) {
  return createHash('md5').update(text).digest('hex');
}

// Import prompts dynamically (TS files compiled to JS by node --loader)
// We inline the prompt names and import from the compiled source
const { ARABIC_PROMPTS } = await import('../../src/lib/types/prompts/arabic.ts');
const { HEBREW_PROMPTS } = await import('../../src/lib/types/prompts/hebrew.ts');
const { LATIN_PROMPTS } = await import('../../src/lib/types/prompts/latin.ts');
const { GERMAN_PROMPTS } = await import('../../src/lib/types/prompts/german.ts');

const PROMPTS_TO_SEED = [
  { name: 'Arabic OCR', type: 'ocr', content: ARABIC_PROMPTS.ocr, description: 'Arabic manuscript/printed book OCR with script identification' },
  { name: 'Arabic Translation', type: 'translation', content: ARABIC_PROMPTS.translation, description: 'Arabic to English translation for Islamic/esoteric texts' },
  { name: 'Hebrew OCR', type: 'ocr', content: HEBREW_PROMPTS.ocr, description: 'Hebrew manuscript/printed book OCR with nikud and Rashi script' },
  { name: 'Hebrew Translation', type: 'translation', content: HEBREW_PROMPTS.translation, description: 'Hebrew/Aramaic to English translation for Kabbalistic/mystical texts' },
  { name: 'Latin OCR (Neo-Latin)', type: 'ocr', content: LATIN_PROMPTS.ocr, description: 'Neo-Latin OCR (1450-1700) with abbreviation expansion' },
  { name: 'Latin Translation (Neo-Latin)', type: 'translation', content: LATIN_PROMPTS.translation, description: 'Neo-Latin to English scholarly accessible translation' },
  { name: 'German OCR (Fraktur)', type: 'ocr', content: GERMAN_PROMPTS.ocr, description: 'German/Fraktur OCR (1450-1800) with historical spelling' },
  { name: 'German Translation (Early Modern)', type: 'translation', content: GERMAN_PROMPTS.translation, description: 'Early modern German to English translation' },
];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const collection = db.collection('prompts');

console.log(`\n=== Seed Language-Specific Prompts ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

let created = 0, skipped = 0, updated = 0;

for (const prompt of PROMPTS_TO_SEED) {
  const latest = await collection.findOne(
    { name: prompt.name },
    { sort: { version: -1 } }
  );

  const hash = contentHash(prompt.content);

  if (latest && latest.content_hash === hash) {
    console.log(`  SKIP  ${prompt.name} v${latest.version} (content unchanged)`);
    skipped++;
    continue;
  }

  const newVersion = (latest?.version || 0) + 1;
  const action = latest ? 'UPDATE' : 'CREATE';

  console.log(`  ${action} ${prompt.name} v${newVersion} (${prompt.type})`);

  if (!DRY_RUN) {
    // If updating, remove is_default from old versions
    if (latest?.is_default) {
      await collection.updateMany(
        { name: prompt.name },
        { $set: { is_default: false } }
      );
    }

    await collection.insertOne({
      name: prompt.name,
      type: prompt.type,
      version: newVersion,
      content: prompt.content,
      content_hash: hash,
      variables: [],
      description: prompt.description,
      is_default: false, // Language prompts are NOT default — they're selected by language
      created_at: new Date(),
      migration_note: 'Seeded from TypeScript source (#384)',
    });

    if (action === 'CREATE') created++;
    else updated++;
  } else {
    if (action === 'CREATE') created++;
    else updated++;
  }
}

console.log(`\n=== Results ===`);
console.log(`Created: ${created}`);
console.log(`Updated: ${updated}`);
console.log(`Skipped (unchanged): ${skipped}`);

if (DRY_RUN && (created + updated) > 0) {
  console.log(`\nRun without --dry-run to apply.`);
}

await client.close();
