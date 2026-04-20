#!/usr/bin/env node
/**
 * Clean up messy artwork titles using Gemini Flash Lite.
 *
 * Many artworks imported from Wikimedia Commons have garbled titles:
 * - File extensions: "Foo.jpg"
 * - Underscores: "Foo_Bar_Baz"
 * - Museum inventory numbers mixed in: "Foo RP-P-2004-48"
 * - Non-English with no display_title
 * - Concatenated metadata: "Herfst Autumnus (titel op object) De vier seizoenen..."
 *
 * This script sends title + commons_description + author to Gemini and gets back
 * a clean, concise English display title.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/cleanup-artwork-titles.mjs [--dry-run] [--limit=100]
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 0;
const BATCH_SIZE = 25;

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.0-flash';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function needsCleanup(title) {
  if (!title) return true;
  if (title.length > 120) return true;
  if (/\.(jpg|jpeg|png|tif|svg)/i.test(title)) return true;
  if (/_/.test(title) && title.length > 30) return true;
  if (/\b(RP-P-|NL-Hlm|WA\d{4}|SK-[A-Z]-|BK-|Butlin \d)\b/.test(title)) return true;
  if (/\(titel op object\)|\(serietitel\)/.test(title)) return true;
  if (/^(print|drawing|painting|sculpture|object)\b/i.test(title)) return true;
  if (/CollectieVoorhelm|Identificatie/.test(title)) return true;
  if (/\b[a-f0-9]{24}\b/.test(title)) return true; // MongoDB ObjectId in title
  return false;
}

async function cleanBatch(artworks) {
  const prompt = `You are a museum cataloger. For each artwork below, provide a clean, concise English title (max 80 chars). Use the description and author to understand the subject. If the original title is already clean, return it unchanged. If it's in a foreign language, translate it. Remove file extensions, inventory numbers, and metadata markup.

Return ONLY a JSON array of strings, one per input, in the same order. No explanation.

Artworks:
${artworks.map((a, i) => `${i + 1}. Title: "${a.title}"${a.commons_description ? `\n   Description: "${a.commons_description.substring(0, 200)}"` : ''}${a.author ? `\n   Author: "${a.author}"` : ''}`).join('\n\n')}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Parse JSON array from response
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array in response: ' + text.substring(0, 200));

  return JSON.parse(match[0]);
}

async function main() {
  if (!GEMINI_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find artworks with messy titles
  const all = await db.collection('books').find(
    { content_type: 'artwork', visible: true },
    { projection: { title: 1, display_title: 1, author: 1, commons_description: 1 } }
  ).toArray();

  const messy = all.filter(a => needsCleanup(a.display_title || a.title));
  const toProcess = LIMIT ? messy.slice(0, LIMIT) : messy;

  console.log(`Title cleanup${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`${messy.length} artworks need cleanup out of ${all.length} total`);
  console.log(`Processing ${toProcess.length}`);

  let cleaned = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);

    try {
      const titles = await cleanBatch(batch);

      for (let j = 0; j < batch.length && j < titles.length; j++) {
        const newTitle = titles[j]?.trim();
        if (!newTitle || newTitle.length < 2) continue;

        const old = batch[j].display_title || batch[j].title;
        if (newTitle === old) continue; // No change needed

        if (!DRY_RUN) {
          await db.collection('books').updateOne(
            { _id: batch[j]._id },
            { $set: { display_title: newTitle } }
          );
        }
        cleaned++;

        if (cleaned <= 10 || cleaned % 100 === 0) {
          console.log(`  "${old?.substring(0, 50)}" → "${newTitle}"`);
        }
      }
    } catch (e) {
      errors++;
      console.log(`  Batch error: ${e.message?.substring(0, 60)}`);
    }

    if ((i + BATCH_SIZE) % 250 === 0) {
      console.log(`  ${Math.min(i + BATCH_SIZE, toProcess.length)}/${toProcess.length} — ${cleaned} cleaned, ${errors} errors`);
    }

    await sleep(500); // Rate limit
  }

  console.log(`\nDone. ${cleaned} titles cleaned, ${errors} errors.`);
  await client.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
