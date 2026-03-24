#!/usr/bin/env node
/**
 * Rich image extraction for high-scoring gallery images.
 * Runs Gemini vision on pages with gallery_quality >= threshold
 * that don't already have rich metadata (subjects, figures, symbols).
 *
 * Run on Hetzner:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-rich-image-extraction.mjs [--threshold 0.8] [--limit 500] [--dry-run]
 */
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const THRESHOLD = parseFloat(process.argv.find(a => a.startsWith('--threshold'))?.split('=')?.[1]
  || process.argv[process.argv.indexOf('--threshold') + 1] || '0.8');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit'))?.split('=')?.[1]
  || process.argv[process.argv.indexOf('--limit') + 1] || '50000');
const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = 5;

const PROMPT = `Analyze this historical illustration from a rare book or manuscript. Provide structured metadata.

Return JSON only:
{
  "subjects": ["alchemy", "astronomy", ...],
  "figures": ["Hermes Trismegistus", "dragon", ...],
  "symbols": ["ouroboros", "caduceus", ...],
  "style": "Northern Renaissance woodcut",
  "technique": "woodcut|engraving|etching|drawing|painting|diagram|map|illumination",
  "period": "16th century",
  "museum_description": "A detailed 2-3 sentence museum-style description of this image, suitable for a gallery caption."
}

Be specific about iconographic content. Name recognizable figures, symbols, and allegorical elements. For scientific diagrams, describe what is being illustrated.`;

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genai.getGenerativeModel({ model: 'gemini-3-flash-preview' });

  console.log(`Rich image extraction: threshold=${THRESHOLD}, limit=${LIMIT}, dry_run=${DRY_RUN}`);

  // Find pages with high gallery_quality but no rich metadata
  const cursor = db.collection('pages').find({
    'detected_images.gallery_quality': { $gte: THRESHOLD },
    'detected_images.metadata': { $exists: false },
  }, {
    projection: { id: 1, book_id: 1, page_number: 1, photo: 1, archived_photo: 1, detected_images: 1 },
    limit: LIMIT,
  });

  const pages = await cursor.toArray();
  console.log(`Found ${pages.length} pages needing rich extraction\n`);

  if (DRY_RUN) {
    console.log('DRY RUN — would process ' + pages.length + ' pages');
    await client.close();
    return;
  }

  let processed = 0, errors = 0;

  // Process in batches for concurrency
  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const batch = pages.slice(i, i + CONCURRENCY);

    await Promise.allSettled(batch.map(async (page) => {
      try {
        const imageUrl = page.archived_photo || page.photo;
        if (!imageUrl) { errors++; return; }

        // Fetch image
        const resp = await fetch(imageUrl, {
          headers: { 'User-Agent': 'SourceLibrary/1.0' },
          signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) { errors++; return; }

        const buffer = await resp.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const mimeType = resp.headers.get('content-type') || 'image/jpeg';

        // Run Gemini vision
        const result = await model.generateContent([
          PROMPT,
          { inlineData: { mimeType, data: base64 } }
        ]);

        const text = result.response.text();
        // Parse JSON from response (strip markdown fences if present)
        const jsonStr = text.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        const metadata = JSON.parse(jsonStr);

        // Update each detected_image that meets threshold
        const updates = {};
        for (let j = 0; j < (page.detected_images || []).length; j++) {
          const img = page.detected_images[j];
          if (img.gallery_quality >= THRESHOLD && !img.metadata) {
            updates[`detected_images.${j}.metadata`] = {
              subjects: metadata.subjects || [],
              figures: metadata.figures || [],
              symbols: metadata.symbols || [],
              style: metadata.style || '',
              technique: metadata.technique || '',
            };
            updates[`detected_images.${j}.museum_description`] = metadata.museum_description || '';
            updates[`detected_images.${j}.significance`] = 'high';
          }
        }

        if (Object.keys(updates).length > 0) {
          await db.collection('pages').updateOne({ id: page.id }, { $set: updates });
        }

        processed++;
      } catch (err) {
        errors++;
        if (errors <= 5) console.log(`  Error page ${page.id}: ${err.message?.substring(0, 80)}`);
      }
    }));

    if ((i + CONCURRENCY) % 50 === 0 || i + CONCURRENCY >= pages.length) {
      console.log(`  ${Math.min(i + CONCURRENCY, pages.length)}/${pages.length} done (${processed} ok, ${errors} errors)`);
    }

    // Rate limit: ~5 req/s
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone: ${processed} enriched, ${errors} errors`);
  console.log(`Cost: ~$${(processed * 0.00024).toFixed(2)}`);

  await client.close();
}

main().catch(console.error);
