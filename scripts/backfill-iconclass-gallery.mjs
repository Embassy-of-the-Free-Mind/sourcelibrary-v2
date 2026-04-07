#!/usr/bin/env node
/**
 * Backfill Iconclass codes for gallery images using Gemini 3.1 Flash Lite.
 * Lightweight: sends the extracted image crop + existing metadata, asks only for codes.
 * Updates both pages.detected_images[].metadata.iconclass AND gallery_images.metadata.iconclass.
 *
 * Cost: ~400 tokens/image * 70K images * $0.075/M tokens ≈ $2.10
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-iconclass-gallery.mjs [--dry-run] [--limit 100] [--min-quality 0.7]
 */
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '100000');
const MIN_QUALITY = parseFloat(process.argv.find((_, i, a) => a[i - 1] === '--min-quality') || '0.5');
const MODEL = 'gemini-3.1-flash-lite-preview';
const BATCH_SIZE = 20; // Process in batches, write updates together

const PROMPT = `Classify this illustration from a historical book using Iconclass codes (iconclass.org). Return 2-5 codes, most specific first.

Iconclass: 0=Abstract, 1=Religion/Magic, 2=Nature, 3=Human, 4=Society, 5=Ideas, 6=History, 7=Bible, 8=Literature, 9=Classical Myth.
Key: 11H=saints, 14=astrology, 25F=animals, 25FF=fabulous, 31A=human figure, 48C=emblems, 49E39=alchemy, 61B2=personifications, 71=OT, 73=NT, 83=classical lit, 92=gods, 97=Ovid.
Qualifiers: 25F23(LION), 92B1(+Bacchus), 61B2(MELANCHOLY).

IMAGE: "{description}" from "{bookTitle}" ({year}). Type: {type}.
Tags: subjects={subjects}, figures={figures}, symbols={symbols}.

Return ONLY a JSON array of codes. Example: ["49E39","25FF41"]`;

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Use batch pagination instead of cursor to avoid Atlas cursor timeout.
  // Each batch fetches PAGE_SIZE docs, processes them, then fetches the next batch.
  const PAGE_SIZE = 200;
  const query = {
    extracted_url: { $ne: null },
    gallery_quality: { $gte: MIN_QUALITY },
    $or: [
      { 'metadata.iconclass': { $exists: false } },
      { 'metadata.iconclass': { $size: 0 } },
    ],
  };
  const projection = {
    id: 1, page_id: 1, book_id: 1, detection_index: 1,
    extracted_url: 1, description: 1, type: 1,
    book_title: 1, book_year: 1,
    metadata: 1, gallery_quality: 1,
  };

  // Count total to process
  const totalToProcess = await db.collection('gallery_images').countDocuments(query, { maxTimeMS: 30000 });
  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}Backfilling ${totalToProcess} gallery images (min quality: ${MIN_QUALITY})\n`);

  let success = 0, errors = 0, totalTokens = 0, processed = 0;
  let pageOffset = 0;

  while (processed < LIMIT) {
    // Fetch a batch — re-query each time since processed docs no longer match the filter
    const pageDocs = await db.collection('gallery_images')
      .find(query, { projection })
      .sort({ gallery_quality: -1 })
      .limit(Math.min(PAGE_SIZE, LIMIT - processed))
      .toArray();

    if (pageDocs.length === 0) break;
    console.log(`\n  [Fetched batch of ${pageDocs.length} images]`);

    const batch = [];

  for (const img of pageDocs) {
    processed++;
    const label = `[${processed}] q=${img.gallery_quality} ${img.type} — ${(img.description || '').substring(0, 50)}`;

    try {
      if (!img.extracted_url) {
        errors++;
        continue;
      }

      const meta = img.metadata || {};
      const prompt = PROMPT
        .replace('{description}', (img.description || '').substring(0, 100))
        .replace('{bookTitle}', (img.book_title || '').substring(0, 60))
        .replace('{year}', img.book_year || '?')
        .replace('{type}', img.type || '?')
        .replace('{subjects}', (meta.subjects || []).join(', ') || 'none')
        .replace('{figures}', (meta.figures || []).join(', ') || 'none')
        .replace('{symbols}', (meta.symbols || []).join(', ') || 'none');

      // Fetch image
      const imgRes = await fetch(img.extracted_url, { signal: AbortSignal.timeout(15000) });
      if (!imgRes.ok) {
        errors++;
        continue;
      }
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

      const result = await genai.models.generateContent({
        model: MODEL,
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: imgBuffer.toString('base64') } },
          ],
        }],
        config: { temperature: 0.1, maxOutputTokens: 256 },
      });

      const text = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      totalTokens += (result.usageMetadata?.totalTokenCount || 400);

      const match = text.match(/\[[\s\S]*\]/);
      if (!match) {
        errors++;
        continue;
      }

      const codes = JSON.parse(match[0]).filter(c => typeof c === 'string' && c.length > 0);
      if (codes.length === 0) {
        errors++;
        continue;
      }

      console.log(`${label} → ${codes.join(', ')}`);
      success++;

      if (!DRY_RUN) {
        batch.push({
          pageId: img.page_id,
          galleryId: img.id,
          detectionIndex: img.detection_index,
          codes,
        });

        // Flush batch
        if (batch.length >= BATCH_SIZE) {
          await flushBatch(db, batch);
          batch.length = 0;
        }
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.log(`${label} — ERROR: ${err.message?.substring(0, 80)}`);
      errors++;
      if (err.message?.includes('429') || err.message?.includes('quota')) {
        console.log('  Rate limited — waiting 60s...');
        await new Promise(r => setTimeout(r, 60000));
      } else {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Progress every 100
    if (processed % 100 === 0) {
      const cost = totalTokens * 0.000000075;
      console.log(`\n  --- Progress: ${success}/${processed} success, ${errors} errors, $${cost.toFixed(4)} ---\n`);
    }
  }

  // Flush remaining in this batch
  if (batch.length > 0) {
    await flushBatch(db, batch);
    batch.length = 0;
  }

  } // end while

  console.log('\n=== SUMMARY ===');
  console.log(`Success: ${success}/${processed}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total tokens: ${totalTokens.toLocaleString()}`);
  const cost = totalTokens * 0.000000075;
  console.log(`Cost: $${cost.toFixed(4)}`);

  await client.close();
}

async function flushBatch(db, batch) {
  const ops = [];

  for (const item of batch) {
    // Update gallery_images (flat collection)
    ops.push(
      db.collection('gallery_images').updateOne(
        { id: item.galleryId },
        { $set: { 'metadata.iconclass': item.codes, updated_at: new Date() } }
      )
    );

    // Update the source page's detected_images array
    ops.push(
      db.collection('pages').updateOne(
        { id: item.pageId },
        { $set: { [`detected_images.${item.detectionIndex}.metadata.iconclass`]: item.codes } }
      )
    );
  }

  await Promise.all(ops);
  console.log(`  [flushed ${batch.length} updates]`);
}

main().catch(e => { console.error(e); process.exit(1); });
