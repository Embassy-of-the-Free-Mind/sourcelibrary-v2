#!/usr/bin/env node
/**
 * Create OCR prompt v12 — adds abbreviation standardization rules.
 * Creates a NEW version (never edits old ones) and sets it as default.
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const ABBREVIATION_RULES = `
**Medieval abbreviation handling:**
When transcribing manuscripts with scribal abbreviations (tildes, macrons, special glyphs), follow these rules consistently:
1. **ALWAYS expand abbreviations into their full Latin form.** Do NOT preserve abbreviated glyphs.
   - q̃, q̄ → "que" (e.g., "itaq̃" → "itaque")
   - ꝑ, ꝓ → "per" or "pro" (by context)
   - ꝯ, ɔ → "con" or "com" (by context)
   - ā, ã → expand the nasal (e.g., "tā" → "tam", "ãte" → "ante")
   - ē, ẽ → expand (e.g., "ē" → "est" or "em" by context)
   - ō → expand (e.g., "ōnis" → "omnis")
   - ū → expand (e.g., "currūt" → "currunt")
   - ñ → expand (e.g., "dñs" → "dominus")
   - ⁊ → "et"
   - ꝫ → "us" (e.g., "oībꝫ" → "oibus" → "omnibus")
   - Superscript letters → expand (e.g., "qᵈ" → "quod")
2. **Normalize v/u:** Preserve the original form as printed. Do NOT modernize (keep "uirtus" if printed, keep "virtus" if printed).
3. **Preserve original punctuation marks** but normalize to standard Unicode: use · for middle dots, . for periods, : for colons.
`;

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Get current default OCR prompt
  const current = await db.collection('prompts').findOne(
    { type: 'ocr', is_default: true },
    { sort: { version: -1 } }
  );

  if (!current) {
    console.error('No default OCR prompt found!');
    await client.close();
    return;
  }

  console.log(`Current default: v${current.version} "${current.name}"`);

  // Insert abbreviation rules before "Critical rules:" section
  const insertPoint = '**Critical rules:**';
  if (!current.content.includes(insertPoint)) {
    console.error(`Cannot find "${insertPoint}" in current prompt`);
    await client.close();
    return;
  }

  const newContent = current.content.replace(
    insertPoint,
    ABBREVIATION_RULES + '\n' + insertPoint
  );

  // Also update Critical Rule #1 to mention abbreviation expansion
  const updatedContent = newContent.replace(
    '1. Preserve original spelling, capitalization, punctuation',
    '1. Preserve original spelling, capitalization, punctuation. ALWAYS expand abbreviations (see rules above).'
  );

  // Unset is_default on old prompt
  await db.collection('prompts').updateMany(
    { type: 'ocr', is_default: true },
    { $set: { is_default: false } }
  );

  // Create new version
  const newVersion = (current.version || 11) + 1;
  const result = await db.collection('prompts').insertOne({
    type: 'ocr',
    name: current.name || 'Standard OCR',
    version: newVersion,
    content: updatedContent,
    is_default: true,
    created_at: new Date(),
    updated_at: new Date(),
    notes: 'Added abbreviation expansion rules for cross-edition OCR consistency. Issue #1323.',
  });

  console.log(`Created OCR prompt v${newVersion} (id: ${result.insertedId})`);
  console.log(`Changes:`);
  console.log(`  - Added medieval abbreviation expansion rules (q̃→que, ꝑ→per, etc.)`);
  console.log(`  - Updated Critical Rule #1 to reference abbreviation expansion`);
  console.log(`  - Set as new default`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
