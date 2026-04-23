/**
 * Insert translation prompt v12 into the prompts collection.
 *
 * v12 is identical to v11 but adds "Readability requirements" after the "Writing style" section.
 * Does NOT set is_default — this is opt-in only.
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/tmp-insert-translation-v12.mjs
 */

import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const client = new MongoClient(uri);

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const prompts = db.collection('prompts');

  // Find current v11 translation prompt
  const v11 = await prompts.findOne({
    type: 'translation',
    name: 'Standard Translation',
    version: 11,
  });

  if (!v11) {
    console.error('Could not find Standard Translation v11. Searching for latest...');
    const latest = await prompts.findOne(
      { type: 'translation', name: 'Standard Translation' },
      { sort: { version: -1 } }
    );
    if (latest) {
      console.log(`Found latest version: v${latest.version}`);
      console.log('Adjust this script to use the correct base version.');
    } else {
      console.error('No Standard Translation prompt found at all.');
    }
    process.exit(1);
  }

  // Check if v12 already exists
  const existing = await prompts.findOne({
    type: 'translation',
    name: 'Standard Translation',
    version: 12,
  });

  if (existing) {
    console.log('Standard Translation v12 already exists. Skipping.');
    process.exit(0);
  }

  const readabilityAddition = `

**Readability requirements (new in v12):**
- Write in clear, natural modern English. Avoid Latinate syntax inherited from the source language.
- Use short sentences (15-25 words). Split long Latin periods into multiple sentences.
- Use active voice: "The king ordered" not "It was ordered by the king."
- Add paragraph breaks every 3-5 sentences, even if the source has none.
- Avoid: "wherefore," "lest," "aforementioned," "it is not to be doubted that," "a certain," and similar archaic constructions.
- The text should sound natural when read aloud.
- Preserve all content, details, names, and meaning — only change how it's expressed, not what it says.`;

  // The v11 content field holds the prompt text.
  // Insert the readability section after the "Writing style" section.
  const v11Content = v11.content || v11.text || '';

  // Find the "Writing style" section — insert after it
  // Look for the next section header after "Writing style" or end of content
  const writingStyleIdx = v11Content.indexOf('**Writing style');
  let insertionPoint;

  if (writingStyleIdx !== -1) {
    // Find the next major section header (a line starting with **)
    const afterWritingStyle = v11Content.indexOf('\n**', writingStyleIdx + 20);
    if (afterWritingStyle !== -1) {
      insertionPoint = afterWritingStyle;
    } else {
      // No subsequent section — append at end
      insertionPoint = v11Content.length;
    }
  } else {
    // Fallback: append at end
    console.warn('Could not find "Writing style" section — appending at end of prompt.');
    insertionPoint = v11Content.length;
  }

  const v12Content = v11Content.slice(0, insertionPoint) + readabilityAddition + v11Content.slice(insertionPoint);

  const v12Doc = {
    name: 'Standard Translation',
    type: 'translation',
    version: 12,
    content: v12Content,
    text: v12Content,
    variables: v11.variables || ['language'],
    description: 'v12: Adds readability requirements (short sentences, active voice, paragraph breaks, no archaic constructions). Based on v11.',
    is_default: false,
    created_at: new Date(),
    created_by: 'claude-code',
  };

  const result = await prompts.insertOne(v12Doc);
  console.log(`Inserted Standard Translation v12: ${result.insertedId}`);
  console.log('is_default: false (not active by default)');

  // Print a preview of the added section
  console.log('\n--- Added readability section ---');
  console.log(readabilityAddition.trim());
}

main()
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  })
  .finally(() => client.close());
