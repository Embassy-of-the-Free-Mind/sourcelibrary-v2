#!/usr/bin/env node
/**
 * Backfill Iconclass codes for gallery images using Gemini 3.1 Flash Lite.
 * Concurrent: runs CONCURRENCY parallel Gemini calls for speed.
 * Batch pagination to avoid Atlas cursor timeouts.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-iconclass-gallery.mjs [--dry-run] [--limit 100] [--concurrency 10]
 */
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '100000');
const CONCURRENCY = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--concurrency') || '10');
const MIN_QUALITY = parseFloat(process.argv.find((_, i, a) => a[i - 1] === '--min-quality') || '0.5');
const MODEL = 'gemini-3.1-flash-lite-preview';
const PAGE_SIZE = 200;

const PROMPT = `Classify this illustration from a historical book using Iconclass codes (iconclass.org). Return 2-5 codes, most specific first.

Iconclass: 0=Abstract, 1=Religion/Magic, 2=Nature, 3=Human, 4=Society, 5=Ideas, 6=History, 7=Bible, 8=Literature, 9=Classical Myth.
Key: 11H=saints, 14=astrology, 25F=animals, 25FF=fabulous, 31A=human figure, 48C=emblems, 49E39=alchemy, 61B2=personifications, 71=OT, 73=NT, 83=classical lit, 92=gods, 97=Ovid.
Qualifiers: 25F23(LION), 92B1(+Bacchus), 61B2(MELANCHOLY).

IMAGE: "{description}" from "{bookTitle}" ({year}). Type: {type}.
Tags: subjects={subjects}, figures={figures}, symbols={symbols}.

Return ONLY a JSON array of codes. Example: ["49E39","25FF41"]`;

function buildPrompt(img) {
  const meta = img.metadata || {};
  return PROMPT
    .replace('{description}', (img.description || '').substring(0, 100))
    .replace('{bookTitle}', (img.book_title || '').substring(0, 60))
    .replace('{year}', img.book_year || '?')
    .replace('{type}', img.type || '?')
    .replace('{subjects}', (meta.subjects || []).join(', ') || 'none')
    .replace('{figures}', (meta.figures || []).join(', ') || 'none')
    .replace('{symbols}', (meta.symbols || []).join(', ') || 'none');
}

async function classifyImage(genai, img) {
  if (!img.extracted_url) return null;

  const prompt = buildPrompt(img);

  const imgRes = await fetch(img.extracted_url, { signal: AbortSignal.timeout(10000) });
  if (!imgRes.ok) return null;
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
  const tokens = result.usageMetadata?.totalTokenCount || 400;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return { tokens };

  const codes = JSON.parse(match[0]).filter(c => typeof c === 'string' && c.length > 0);
  return codes.length > 0 ? { codes, tokens } : { tokens };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const query = {
    extracted_url: { $ne: null },
    gallery_quality: { $gte: MIN_QUALITY },
    'metadata.iconclass': { $exists: false },
  };

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}Concurrency: ${CONCURRENCY} | Model: ${MODEL}\n`);

  let success = 0, errors = 0, totalTokens = 0, processed = 0;

  while (processed < LIMIT) {
    // Re-query each batch (processed docs no longer match since iconclass is now set)
    const batch = await db.collection('gallery_images')
      .find(query, {
        projection: {
          id: 1, page_id: 1, book_id: 1, detection_index: 1,
          extracted_url: 1, description: 1, type: 1,
          book_title: 1, book_year: 1, metadata: 1, gallery_quality: 1,
        },
      })
      .sort({ gallery_quality: -1 })
      .limit(PAGE_SIZE)
      .maxTimeMS(60000)
      .toArray();

    if (batch.length === 0) {
      console.log('\nNo more images to process.');
      break;
    }
    console.log(`\n  [Batch: ${batch.length} images, processed so far: ${processed}]`);

    // Process batch with concurrency pool
    const writeOps = [];

    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const chunk = batch.slice(i, i + CONCURRENCY);

      const results = await Promise.allSettled(
        chunk.map(async (img) => {
          try {
            return { img, result: await classifyImage(genai, img) };
          } catch (err) {
            return { img, error: err.message };
          }
        })
      );

      for (const r of results) {
        processed++;
        if (r.status === 'rejected' || r.value.error) {
          errors++;
          continue;
        }

        const { img, result } = r.value;
        if (!result) { errors++; continue; }

        totalTokens += result.tokens || 0;

        if (result.codes) {
          success++;
          const label = `[${processed}] ${img.type} — ${(img.description || '').substring(0, 45)}`;
          console.log(`${label} → ${result.codes.join(', ')}`);

          if (!DRY_RUN) {
            writeOps.push({
              galleryId: img.id,
              pageId: img.page_id,
              detectionIndex: img.detection_index,
              codes: result.codes,
            });
          }
        } else {
          errors++;
        }
      }
    }

    // Batch write all results for this page
    if (writeOps.length > 0) {
      const ops = [];
      for (const item of writeOps) {
        ops.push(
          db.collection('gallery_images').updateOne(
            { id: item.galleryId },
            { $set: { 'metadata.iconclass': item.codes, updated_at: new Date() } }
          )
        );
        ops.push(
          db.collection('pages').updateOne(
            { id: item.pageId, [`detected_images.${item.detectionIndex}`]: { $ne: null } },
            { $set: { [`detected_images.${item.detectionIndex}.metadata.iconclass`]: item.codes } }
          ).catch(() => {})
        );
      }
      await Promise.all(ops);
      console.log(`  [wrote ${writeOps.length} updates]`);
      writeOps.length = 0;
    }

    // Progress
    const cost = totalTokens * 0.000000075;
    const rate = processed > 0 ? (success / (processed / CONCURRENCY) * CONCURRENCY).toFixed(0) : 0;
    console.log(`  --- ${success} success, ${errors} errors, $${cost.toFixed(4)} ---`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Success: ${success}/${processed}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total tokens: ${totalTokens.toLocaleString()}`);
  const cost = totalTokens * 0.000000075;
  console.log(`Cost: $${cost.toFixed(4)}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
