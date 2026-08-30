#!/usr/bin/env node
/**
 * Collect completed multi-page OCR batch results.
 * Runs locally to bypass Vercel timeout limits.
 *
 * Usage: secret-lover run -- node scripts/collect-multipage-ocr.mjs [--dry-run]
 */

import { MongoClient } from 'mongodb';
import { saveRevisionBeforeOverwrite } from '../lib/page-revisions.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';
import { extractPageType, extractColumns, parseMultiPageOcr } from '../lib/ocr-result-parse.mjs';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Provenance fallback for legacy jobs only — NOT the current prompt version.
 *
 * Jobs submitted since early 2026 record their own `prompt_version` (see
 * `pipeline-orchestrator.mjs`, `bulk-reocr-*.mjs`), and that is what gets
 * stamped. This value is what a job predating that field was actually run with,
 * so it must NOT be bumped to `PROMPT_VERSION` from ocr-result-parse.mjs:
 * restamping an old job with today's prompt version fabricates provenance.
 * Previously named PROMPT_VERSION, which read as "the current prompt" (#4443).
 */
const LEGACY_JOB_PROMPT_VERSION = 'v4.2026-02';

// NOTE: parses `<image>` sub-tags, which the current OCR prompt does not emit —
// a different parser from the canonical `parseDetectedImages`, not a fork of it.
// Deliberately out of scope for #4443; see #4456.
function parseDetectedImages(text) {
  const match = text.match(/<detected-images>([\s\S]*?)<\/detected-images>/);
  if (!match) return [];
  const imagesText = match[1].trim();
  const images = [];
  const imgRegex = /<image>([\s\S]*?)<\/image>/g;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(imagesText)) !== null) {
    const imgContent = imgMatch[1];
    const getTag = (tag) => {
      const m = imgContent.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? m[1].trim() : null;
    };
    const bbox = getTag('bbox');
    const image = {
      type: getTag('type') || 'illustration',
      description: getTag('description') || '',
      subject: getTag('subject')?.split(',').map(s => s.trim()).filter(Boolean) || [],
    };
    if (bbox) {
      const coords = bbox.split(',').map(Number);
      if (coords.length === 4) {
        image.bbox = { x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] };
      }
    }
    images.push(image);
  }
  return images;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  const client = new MongoClient(uri, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Get all API keys
  const keys = [];
  if (process.env.GEMINI_API_KEY_TIER3) keys.push(process.env.GEMINI_API_KEY_TIER3);
  if (process.env.GEMINI_API_KEY_2) keys.push(process.env.GEMINI_API_KEY_2);
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  const uniqueKeys = [...new Set(keys)];
  console.log(`Using ${uniqueKeys.length} API keys`);

  // Find all multi-page OCR jobs stuck as pending
  const jobs = await db.collection('batch_jobs').find({
    pages_per_request: { $gt: 1 },
    status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    job_name: { $exists: true, $nin: [null, ''] },
  }).toArray();

  console.log(`Found ${jobs.length} pending multi-page OCR jobs`);

  let totalCollected = 0;
  let totalFailed = 0;

  for (let ji = 0; ji < jobs.length; ji++) {
    const job = jobs[ji];
    const jobName = job.job_name;
    console.log(`\n[${ji + 1}/${jobs.length}] Job ${jobName} — book ${job.book_id} (${job.page_count} pages)`);

    // Fetch job from Gemini (try all keys)
    let jobData = null;
    for (const key of uniqueKeys) {
      try {
        const res = await fetch(`${GEMINI_API_BASE}/${jobName}?key=${key}`);
        if (res.ok) {
          jobData = await res.json();
          break;
        }
        const err = await res.text();
        if (res.status === 404 || err.includes('not found')) continue;
        console.warn(`  Key error: ${res.status} ${err.slice(0, 100)}`);
      } catch (e) {
        console.warn(`  Fetch error: ${e.message}`);
      }
    }

    if (!jobData) {
      console.warn('  NOT FOUND with any key');
      totalFailed++;
      continue;
    }

    // Check if results exist
    const metadata = jobData.metadata || {};
    const hasInlineResults = !!metadata.output?.inlinedResponses?.inlinedResponses;
    const hasFileResults = !!metadata.output?.responsesFile;
    const state = metadata.state || (hasInlineResults || hasFileResults ? 'SUCCEEDED' : 'UNKNOWN');

    console.log(`  State: ${state}, inline: ${hasInlineResults}, file: ${hasFileResults}`);

    if (!hasInlineResults && !hasFileResults) {
      console.log('  No results yet — still processing');
      continue;
    }

    // Get results
    let responses;
    if (hasInlineResults) {
      responses = metadata.output.inlinedResponses.inlinedResponses;
    } else if (hasFileResults) {
      // Would need to download file — skip for now
      console.log('  File-based results — skipping (not implemented in this script)');
      continue;
    }

    console.log(`  ${responses.length} responses`);

    if (DRY_RUN) {
      // Just show what we'd do
      let pageCount = 0;
      for (const r of responses) {
        if (r.error) { console.log(`  Response error: ${JSON.stringify(r.error).slice(0, 100)}`); continue; }
        const text = r.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) { console.log('  Empty response'); continue; }
        const parsed = parseMultiPageOcr(text, { lenient: true });
        pageCount += parsed.size;
        console.log(`  Response: ${parsed.size} pages parsed from ${text.length} chars`);
      }
      console.log(`  Total: ${pageCount} pages would be saved`);
      totalCollected += pageCount;
      continue;
    }

    // Save results
    const now = new Date();
    const pageIds = job.page_ids || [];
    let successCount = 0;
    let failCount = 0;

    for (let ri = 0; ri < responses.length; ri++) {
      const result = responses[ri];
      if (result.error) {
        console.warn(`  Response ${ri}: error — ${JSON.stringify(result.error).slice(0, 200)}`);
        failCount++;
        continue;
      }
      const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.warn(`  Response ${ri}: empty`);
        failCount++;
        continue;
      }
      const usage = result.response?.usageMetadata;
      const parsed = parseMultiPageOcr(text, { lenient: true });
      console.log(`  Response ${ri}: ${parsed.size} pages`);

      for (const [pageId, ocrText] of parsed) {
        if (ocrText.length > 25000) {
          console.warn(`  Page ${pageId}: ${ocrText.length} chars — likely hallucination, skipping`);
          failCount++;
          continue;
        }

        const pageType = extractPageType(ocrText, { validate: false });
        const columns = extractColumns(ocrText);
        const detectedImages = parseDetectedImages(ocrText);

        // First ensure the page has an ocr object (some pages have ocr: null)
        await db.collection('pages').updateOne(
          { id: pageId, ocr: null },
          { $set: { ocr: {} } }
        );

        // Retain existing OCR as a revision before overwriting (#3240); no-op on first write
        await saveRevisionBeforeOverwrite(db, pageId, 'ocr', { jobId: String(job._id), reason: 'reocr_batch' });

        const updateResult = await db.collection('pages').updateOne(
          { id: pageId },
          {
            $set: {
              'ocr.data': ocrText,
              'ocr.updated_at': now,
              'ocr.model': job.model,
              'ocr.language': job.language,
              'ocr.source': 'batch_api',
              'ocr.prompt_version': job.prompt_version || LEGACY_JOB_PROMPT_VERSION,
              'ocr.prompt_name': job.prompt_name || 'Standard OCR',
              'ocr.batch_job_id': String(job._id),
              'ocr.pages_per_request': job.pages_per_request,
              'ocr.input_tokens': usage?.promptTokenCount || 0,
              'ocr.output_tokens': usage?.candidatesTokenCount || 0,
              ...(pageType && { page_type: pageType }),
              ...(columns && { columns }),
              ...(detectedImages.length > 0 && { detected_images: detectedImages }),
              updated_at: now,
            },
          }
        );

        if (updateResult.matchedCount === 0) {
          console.warn(`  Page ${pageId} not found in DB!`);
          failCount++;
        } else {
          successCount++;
        }
      }
    }

    // Update job status
    const foundIds = new Set();
    // Re-count from what we saved
    console.log(`  Saved: ${successCount} pages, failed: ${failCount}`);

    await db.collection('batch_jobs').updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'saved',
          gemini_state: 'JOB_STATE_SUCCEEDED',
          completed_pages: successCount,
          failed_pages: failCount,
          results_collected: true,
          completed_at: now,
          updated_at: now,
        },
      }
    );

    // Update book page counts — VISIBLE pages only (page_number > 0). See
    // scripts/lib/page-counts.mjs and issue #3293. Soft-hidden pages never
    // render and must not inflate counts.
    const [counts] = await db.collection('pages')
      .aggregate(buildVisiblePageCountPipeline(job.book_id)).toArray();

    if (counts) {
      await db.collection('books').updateOne(
        { id: job.book_id },
        { $set: { pages_count: counts.total, pages_ocr: counts.with_ocr, pages_translated: counts.with_translation, updated_at: now } }
      );
    }

    totalCollected += successCount;
    totalFailed += failCount;
  }

  console.log(`\n=== Done ===`);
  console.log(`Collected: ${totalCollected} pages`);
  console.log(`Failed: ${totalFailed} pages`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
