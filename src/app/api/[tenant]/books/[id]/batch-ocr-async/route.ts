import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getDb } from '@/lib/mongodb';
import { getOcrPrompt } from '@/lib/prompts';
import { logGeminiCall } from '@/lib/gemini-logger';
import { getTriggerSource } from '@/lib/cron-auth';
import { images } from '@/lib/api-client';
import { PROMPT_VERSION, extractPageType, extractColumns, parseDetectedImages, parseMultiPageOcr } from '@/lib/types/prompts/defaults';
import { withAuth } from '@/lib/auth-helpers';
import { createRevision } from '@/lib/page-revisions';
import { findPendingBatchJob } from '@/lib/translate-write';
import { contentHash } from '@/lib/steganographia';
import { nanoid } from 'nanoid';
import { resolveTenantId } from '@/lib/tenant-context';

export const maxDuration = 300;

/**
 * Async Batch OCR using Gemini Batch API
 *
 * Benefits:
 * - 50% cheaper than real-time API
 * - Auto-retries built in
 * - No rate limit issues
 * - 24h turnaround (usually faster)
 *
 * POST /api/books/[id]/batch-ocr-async - Submit batch job
 * GET /api/books/[id]/batch-ocr-async?jobName=xxx - Check job status
 */

const DEFAULT_API_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY || '';

// All available batch API keys for rotation
const BATCH_API_KEYS = [
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY,
].filter((k): k is string => !!k);
// Deduplicate
const UNIQUE_BATCH_KEYS = [...new Set(BATCH_API_KEYS)];

/** Normalize raw Gemini batch job state to our DB status values */
function normalizeGeminiState(state: string | undefined | null): string {
  switch (state) {
    case 'JOB_STATE_PENDING': return 'pending';
    case 'JOB_STATE_RUNNING': return 'processing';
    case 'JOB_STATE_SUCCEEDED': return 'completed';
    case 'JOB_STATE_FAILED': return 'failed';
    case 'JOB_STATE_CANCELLED':
    case 'BATCH_STATE_CANCELLED': return 'cancelled';
    case 'JOB_STATE_EXPIRED':
    case 'BATCH_STATE_EXPIRED': return 'failed';
    default: return 'pending';
  }
}

function getAiClient(keyIndex?: number): GoogleGenAI {
  if (keyIndex !== undefined && keyIndex >= 0 && keyIndex < UNIQUE_BATCH_KEYS.length) {
    return new GoogleGenAI({ apiKey: UNIQUE_BATCH_KEYS[keyIndex] });
  }
  return new GoogleGenAI({ apiKey: DEFAULT_API_KEY });
}

const ai = new GoogleGenAI({ apiKey: DEFAULT_API_KEY });

/** Submit a batch job with key rotation — tries each key on quota exhaustion */
async function createBatchWithRotation(
  preferredClient: GoogleGenAI,
  params: Parameters<GoogleGenAI['batches']['create']>[0]
): Promise<Awaited<ReturnType<GoogleGenAI['batches']['create']>>> {
  // Try preferred client first
  try {
    return await preferredClient.batches.create(params);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!(msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota'))) {
      throw err; // Non-quota error — don't retry
    }
    console.warn('[batch-ocr] Preferred key quota exhausted, rotating...');
  }
  // Try all other keys
  let lastError: Error | null = null;
  for (let ki = 0; ki < UNIQUE_BATCH_KEYS.length; ki++) {
    try {
      const client = getAiClient(ki);
      return await client.batches.create(params);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message || '';
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        console.warn(`[batch-ocr] Key ${ki} quota exhausted, trying next...`);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError || new Error('All API keys exhausted');
}

// Max pages per Gemini batch job (inline payload size limit ~20MB)
const MAX_PAGES_PER_BATCH = 20;
// Concurrent image downloads
const IMAGE_DOWNLOAD_CONCURRENCY = 20;

// Build image URL for a page
function getPageImageUrl(page: {
  cropped_photo?: string;
  archived_photo?: string;
  photo_original?: string;
  photo: string;
  crop?: { xStart: number; xEnd: number };
}): string {
  // Prefer archived/cropped over live IA
  if (page.crop && page.cropped_photo) {
    return page.cropped_photo;
  }
  if (page.archived_photo && !page.archived_photo.startsWith('failed:')) {
    return page.archived_photo;
  }

  const baseUrl = page.photo_original || page.photo;

  // If has crop, use image proxy
  if (page.crop) {
    const apiBase = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXTAUTH_URL || 'http://localhost:3000';
    return `${apiBase}/api/image?url=${encodeURIComponent(baseUrl)}&w=2000&q=95&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`;
  }

  return baseUrl;
}

// Fetch image as base64
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const result = await images.fetchBase64(url, { includeMimeType: true });
    if (typeof result === 'string') {
      return { data: result, mimeType: 'image/jpeg' };
    }
    return { data: result.base64, mimeType: result.mimeType };
  } catch (error) {
    console.error('Failed to fetch image:', url, error);
    return null;
  }
}

/**
 * POST - Submit a batch OCR job
 */
export const POST = withAuth(async (request, session, context) => {
  try {
    const { tenant, id: bookId } = await context.params;
    const triggeredBy = getTriggerSource(request);
    const body = await request.json().catch(() => ({}));
    const {
      limit = 500,
      model = process.env.GEMINI_BATCH_MODEL || 'gemini-3-flash-preview',
      force = false, // When true, include pages that already have OCR (for re-processing)
      pagesPerRequest = 1, // >1 enables multi-page mode: N images per Gemini request (saves quota)
      apiKeyIndex, // Optional: rotate between available API keys (0, 1, 2)
      resubmit = false, // When true, bypass the pending-job double-submit guard
    } = body;

    // Use key-specific client if requested (for quota rotation)
    const batchAi = apiKeyIndex !== undefined ? getAiClient(apiKeyIndex) : ai;

    const db = await getDb();
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get book
    const book = await db.collection('books').findOne({ id: bookId, tenantId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Double-submit guard (#3749, archaeology I68): a pending OCR batch for
    // this book means submitting again pays Gemini twice for the same pages.
    // 409 with the existing job; pass resubmit: true to bypass.
    if (!resubmit) {
      const pending = await findPendingBatchJob(db, { bookId, type: 'ocr', tenantId });
      if (pending) {
        return NextResponse.json({
          error: 'batch_job_already_pending',
          message: `An OCR batch job for this book is already pending (submitted ${pending.createdAt?.toISOString?.() || pending.createdAt}). Collect it or pass resubmit: true to force a new submission.`,
          existingJob: pending,
        }, { status: 409 });
      }
    }

    // Find pages to OCR
    // When force=true, include pages that already have OCR (for re-processing with new prompts)
    const hasImageFilter = {
      $or: [
        { photo: { $exists: true, $ne: null } },
        { photo_original: { $exists: true, $ne: null } }
      ]
    };
    const ocrFilter = force
      ? hasImageFilter
      : {
          $and: [
            hasImageFilter,
            {
              $or: [
                { 'ocr.data': { $exists: false } },
                { 'ocr.data': null },
                { 'ocr.data': '' }
              ]
            }
          ]
        };

    const pagesToProcess = await db.collection('pages')
      .find({ book_id: bookId, tenantId, ...ocrFilter })
      .sort({ page_number: 1 })
      .limit(limit)
      .toArray();

    if (pagesToProcess.length === 0) {
      return NextResponse.json({
        message: 'No pages need OCR',
        processed: 0
      });
    }

    // Build batch requests
    const batchRequests: Array<{ key: string; pageIds: string[]; request: Record<string, unknown> }> = [];

    // Use book's original_language if set, otherwise auto-detect
    const language = book.original_language || '';

    // Get the main OCR prompt with language substituted
    const ocrPromptResult = await getOcrPrompt();

    // Spread guard (#2449): flagged spread books must be OCR'd with the spread
    // prefix so <split-position>/<page-break/> markers survive for Phase 3.1's
    // split. The bare prompt silently produces marker-less text that wedges the
    // book as an unsplit spread. Mirrors pipeline-orchestrator submitOcrDirectly.
    const needsSpreadPrompt = book.needs_splitting === true && book.split_completed !== true;
    // Generation guard (#2449): stamp the book's current OCR generation on every
    // job so batch-collector refuses results submitted before a deliberate reset.
    const ocrGeneration = book.pipeline_auto?.ocr_generation || 0;
    const spreadPrefix = `**TWO-PAGE SPREAD HANDLING:**
This image is a two-page spread (open book scan). Process BOTH pages separately.

CRITICAL: Each page may have its own multi-column layout. Handle columns WITHIN each page:
- If a page has 2+ columns, use <column-break/> between columns ON THAT PAGE
- Each page MUST include its own <vocab> tag with key terms from THAT page only.
- Use ISO 639-1 language codes (de, fr, la, en, nl, he, grc — NOT "German", "Latin", etc.)

If this is NOT a two-page spread (single page), set split_position to null and process normally.

Output structure:
1. <split-position>N</split-position> (0-1000, or null if single page) at the very top
2. All metadata and content for LEFT page
3. <page-break/> on its own line
4. All metadata and content for RIGHT page

`;
    const prompt = needsSpreadPrompt ? spreadPrefix + ocrPromptResult.text : ocrPromptResult.text;
    const promptRef = ocrPromptResult.reference;
    const promptProvenance = {
      prompt_id: promptRef.id,
      prompt_name: promptRef.name,
      prompt_version: String(promptRef.version),
      prompt_hash: promptRef.content_hash,
    };

    // Step 1: Validate image URLs and fetch images (parallel with concurrency limit)
    const preparedPages: Array<{ id: string; pageNumber: number; image: { data: string; mimeType: string } }> = [];
    let skippedBadUrl = 0;

    // First pass: collect valid URLs
    const downloadTasks: Array<{ page: typeof pagesToProcess[0]; url: string }> = [];
    for (const page of pagesToProcess) {
      const typedPage = page as unknown as {
        cropped_photo?: string;
        archived_photo?: string;
        photo_original?: string;
        photo: string;
        crop?: { xStart: number; xEnd: number };
      };
      const imageUrl = getPageImageUrl(typedPage);

      if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
        console.warn(`[batch-ocr] Skipping page ${page.page_number}: non-HTTP image URL: ${imageUrl.substring(0, 100)}`);
        skippedBadUrl++;
        continue;
      }
      downloadTasks.push({ page, url: imageUrl });
    }

    // Parallel download with concurrency limit
    for (let i = 0; i < downloadTasks.length; i += IMAGE_DOWNLOAD_CONCURRENCY) {
      const chunk = downloadTasks.slice(i, i + IMAGE_DOWNLOAD_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async ({ page, url }) => {
          const image = await fetchImageAsBase64(url);
          if (!image) return null;
          return { id: page.id, pageNumber: page.page_number, image };
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          preparedPages.push(r.value);
        }
      }
    }
    // Sort by page number to maintain order after parallel download
    preparedPages.sort((a, b) => a.pageNumber - b.pageNumber);

    // If all pages were skipped due to bad URLs, return a distinct error
    if (preparedPages.length === 0 && skippedBadUrl > 0) {
      return NextResponse.json({
        error: 'no_valid_image_urls',
        message: `All ${skippedBadUrl} pages have non-HTTP image URLs (local filesystem paths?). Archive images first.`,
        skippedBadUrl,
        attempted: pagesToProcess.length,
      }, { status: 422 });
    }

    // Step 2: Build batch requests
    const effectivePPR = Math.max(1, Math.min(pagesPerRequest, 10)); // Clamp 1-10

    if (effectivePPR > 1) {
      // Multi-page mode: group images into single requests
      for (let i = 0; i < preparedPages.length; i += effectivePPR) {
        const chunk = preparedPages.slice(i, i + effectivePPR);
        const parts: Array<Record<string, unknown>> = [];
        const chunkPageIds: string[] = [];

        parts.push({ text: `You will OCR ${chunk.length} page images. For each page, produce your complete OCR transcription wrapped in a <page id="PAGE_ID"> tag, where PAGE_ID matches the ID shown before each image.\n\nWithin each <page> block, follow these OCR instructions:\n\n${prompt}\n\nProduce one <page> block per image, in order:\n` });

        for (const p of chunk) {
          chunkPageIds.push(p.id);
          parts.push({ text: `\nPage ID: ${p.id}` });
          parts.push({ inlineData: { mimeType: p.image.mimeType, data: p.image.data } });
        }

        batchRequests.push({
          key: chunkPageIds[0], // First page ID as batch key
          pageIds: chunkPageIds,
          request: {
            contents: [{ parts, role: 'user' }],
            config: {
              temperature: 0.1,
              maxOutputTokens: Math.min(65536, 4096 * chunk.length),
              thinkingConfig: { thinkingBudget: 0 },
            },
          },
        });
      }
    } else {
      // Single-page mode (original behavior)
      for (const p of preparedPages) {
        batchRequests.push({
          key: p.id,
          pageIds: [p.id],
          request: {
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType: p.image.mimeType, data: p.image.data } },
              ],
              role: 'user',
            }],
            config: {
              temperature: 0.1,
              maxOutputTokens: 16384,
              thinkingConfig: { thinkingBudget: 0 },
            },
          },
        });
      }
    }

    if (batchRequests.length === 0) {
      return NextResponse.json({
        error: 'Failed to prepare any images for batch',
        attempted: pagesToProcess.length
      }, { status: 400 });
    }

    // Split into child batches if > MAX_PAGES_PER_BATCH requests
    // Each Gemini inline batch job has a ~20MB payload limit (~20 pages with images)
    const batches: Array<typeof batchRequests> = [];
    for (let i = 0; i < batchRequests.length; i += MAX_PAGES_PER_BATCH) {
      batches.push(batchRequests.slice(i, i + MAX_PAGES_PER_BATCH));
    }

    const allPageIds = batchRequests.flatMap(r => r.pageIds);
    const now = new Date();
    const childJobNames: string[] = [];
    const childJobIds: string[] = [];

    // For single batch, submit directly (backwards compatible — no parent needed)
    if (batches.length === 1) {
      const batchJob = await createBatchWithRotation(batchAi, {
        model,
        src: batches[0].map(r => ({
          ...r.request,
          metadata: { key: r.key },
        })),
        config: {
          displayName: `ocr-${bookId}-${Date.now()}`,
        }
      });

      await db.collection('batch_jobs').insertOne({
        job_name: batchJob.name,
        book_id: bookId,
        tenantId,
        type: 'ocr',
        model,
        language,
        force,
        ...promptProvenance,
        ocr_generation: ocrGeneration, // #2449 generation guard
        page_ids: allPageIds,
        page_count: allPageIds.length,
        pages_per_request: effectivePPR,
        request_count: batchRequests.length,
        status: normalizeGeminiState(batchJob.state),
        gemini_state: batchJob.state,
        created_at: now,
        updated_at: now,
      });

      await logGeminiCall({
        type: 'ocr',
        mode: 'batch',
        model,
        book_id: bookId,
        book_title: book?.title,
        page_ids: allPageIds,
        page_count: allPageIds.length,
        batch_job_id: batchJob.name,
        gemini_job_name: batchJob.name,
        input_tokens: 0,
        output_tokens: 0,
        status: 'submitted',
        prompt_version: PROMPT_VERSION,
        endpoint: '/api/[tenant]/books/[id]/batch-ocr-async',
        triggered_by: triggeredBy,
        pages_per_request: effectivePPR,
      });

      return NextResponse.json({
        success: true,
        jobName: batchJob.name,
        state: batchJob.state,
        pagesSubmitted: allPageIds.length,
        batchCount: 1,
        requestCount: batchRequests.length,
        pagesPerRequest: effectivePPR,
        message: `Batch OCR submitted: ${allPageIds.length} pages in ${batchRequests.length} requests`
      });
    }

    // Multiple batches: submit ALL children to Gemini first, then create DB records.
    // This prevents orphan parent records if Gemini submission fails (e.g. quota exhaustion).
    const parentJobId = nanoid();

    // Phase 1: Submit all child batches to Gemini (no DB writes yet)
    const submittedChildren: Array<{
      childJobId: string;
      batchJobName: string;
      batchJobState: string;
      geminiRawState: string;
      batchPageIds: string[];
      requestCount: number;
    }> = [];

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const batchPageIds = batch.flatMap(r => r.pageIds);
      const childJobId = nanoid();

      const batchJob = await createBatchWithRotation(batchAi, {
        model,
        src: batch.map(r => ({
          ...r.request,
          metadata: { key: r.key },
        })),
        config: {
          displayName: `ocr-${bookId}-${childJobId}-${Date.now()}`,
        }
      });

      submittedChildren.push({
        childJobId,
        batchJobName: batchJob.name!,
        batchJobState: normalizeGeminiState(batchJob.state),
        geminiRawState: batchJob.state || 'JOB_STATE_PENDING',
        batchPageIds,
        requestCount: batch.length,
      });
    }

    // Phase 2: All children submitted successfully — now create DB records
    for (const child of submittedChildren) {
      childJobNames.push(child.batchJobName);
      childJobIds.push(child.childJobId);

      await db.collection('batch_jobs').insertOne({
        id: child.childJobId,
        parent_job_id: parentJobId,
        job_name: child.batchJobName,
        book_id: bookId,
        tenantId,
        type: 'ocr',
        model,
        language,
        force,
        ...promptProvenance,
        ocr_generation: ocrGeneration, // #2449 generation guard
        page_ids: child.batchPageIds,
        page_count: child.batchPageIds.length,
        pages_per_request: effectivePPR,
        request_count: child.requestCount,
        status: child.batchJobState,
        gemini_state: child.geminiRawState,
        created_at: now,
        updated_at: now,
      });
    }

    // Create parent record last (all children already exist)
    await db.collection('batch_jobs').insertOne({
      id: parentJobId,
      book_id: bookId,
      tenantId,
      type: 'ocr',
      model,
      language,
      force,
      ...promptProvenance,
      ocr_generation: ocrGeneration, // #2449 generation guard
      page_ids: allPageIds,
      page_count: allPageIds.length,
      total_pages: allPageIds.length,
      pages_per_request: effectivePPR,
      child_job_ids: childJobIds,
      child_job_names: childJobNames,
      status: 'processing',
      progress: { total: allPageIds.length, completed: 0, failed: 0, pending: allPageIds.length },
      created_at: now,
      updated_at: now,
    });

    await logGeminiCall({
      type: 'ocr',
      mode: 'batch',
      model,
      book_id: bookId,
      book_title: book?.title,
      page_ids: allPageIds,
      page_count: allPageIds.length,
      batch_job_id: childJobNames[0],
      gemini_job_name: childJobNames[0],
      input_tokens: 0,
      output_tokens: 0,
      status: 'submitted',
      prompt_version: PROMPT_VERSION,
      endpoint: '/api/[tenant]/books/[id]/batch-ocr-async',
      triggered_by: triggeredBy,
      pages_per_request: effectivePPR,
    });

    return NextResponse.json({
      success: true,
      jobName: childJobNames[0],
      jobNames: childJobNames,
      parentJobId,
      state: 'JOB_STATE_PENDING',
      pagesSubmitted: allPageIds.length,
      batchCount: batches.length,
      requestCount: batchRequests.length,
      pagesPerRequest: effectivePPR,
      message: `Batch OCR submitted: ${allPageIds.length} pages in ${batches.length} batches (${batchRequests.length} requests)`
    });

  } catch (error) {
    console.error('Batch OCR submit error:', error);
    const errMsg = error instanceof Error ? error.message : String(error);
    // Pass through quota/rate-limit errors as 429 so callers can circuit-break
    const isQuotaError = errMsg.includes('429') || errMsg.includes('quota') ||
      errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('exhausted');
    return NextResponse.json(
      { error: errMsg },
      { status: isQuotaError ? 429 : 500 }
    );
  }
});

/**
 * GET - Check batch job status and collect results
 */
export const GET = withAuth(async (request, session, context) => {
  try {
    const { tenant, id: bookId } = await context.params;
    const triggeredBy = getTriggerSource(request);
    const { searchParams } = new URL(request.url);
    const jobName = searchParams.get('jobName');

    const db = await getDb();
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // If no jobName, list recent jobs for this book
    if (!jobName) {
      const jobs = await db.collection('batch_jobs')
        .find({ book_id: bookId, tenantId })
        .sort({ created_at: -1 })
        .limit(10)
        .toArray();

      return NextResponse.json({
        bookId,
        jobs: jobs.map(j => ({
          jobName: j.job_name,
          type: j.type,
          pageCount: j.page_count,
          status: j.status,
          resultsCollected: j.results_collected || false,
          createdAt: j.created_at
        }))
      });
    }

    // Get job status from Gemini
    const batchJob = await ai.batches.get({ name: jobName });

    // Update status in database (normalize Gemini state to our status values)
    await db.collection('batch_jobs').updateOne(
      { job_name: jobName, tenantId },
      { $set: { status: normalizeGeminiState(batchJob.state), gemini_state: batchJob.state, updated_at: new Date() } }
    );

    // If job succeeded, collect results
    if (batchJob.state === 'JOB_STATE_SUCCEEDED') {
      const jobDoc = await db.collection('batch_jobs').findOne({ job_name: jobName, tenantId });

      if (jobDoc && !jobDoc.results_collected && batchJob.dest?.inlinedResponses) {
        const pageIds = jobDoc.page_ids || [];
        const responses = batchJob.dest.inlinedResponses;
        const isMultiPage = (jobDoc.pages_per_request || 1) > 1;

        // Safety check for single-page mode: response count must match page count
        if (!isMultiPage && responses.length !== pageIds.length) {
          console.warn(`[batch-ocr] Response count (${responses.length}) != page count (${pageIds.length}) for job ${jobName}. Skipping to avoid mismatched data.`);
          return NextResponse.json({
            jobName,
            state: batchJob.state,
            error: `Response count mismatch: ${responses.length} responses for ${pageIds.length} pages. Results NOT saved to prevent data corruption.`,
            resultsCollected: false,
          }, { status: 409 });
        }

        let successCount = 0;
        let failCount = 0;
        const now = new Date().toISOString();

        // Build flat list of { pageId, ocrText } from responses
        const pageResults: Array<{ pageId: string; text: string }> = [];

        if (isMultiPage) {
          // Multi-page mode: parse <page id="...">...</page> blocks
          console.log(`[batch-ocr] Collecting multi-page results: ${responses.length} responses for ${pageIds.length} pages (${jobDoc.pages_per_request} pages/request)`);
          for (let ri = 0; ri < responses.length; ri++) {
            const response = responses[ri];
            const responseText = response.response?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!responseText) {
              console.warn(`[batch-ocr] Response ${ri}: empty (no text in candidate)`);
              failCount++;
              continue;
            }
            const parsed = parseMultiPageOcr(responseText);
            console.log(`[batch-ocr] Response ${ri}: parsed ${parsed.size} pages from ${responseText.length} chars`);
            if (parsed.size === 0) {
              console.warn(`[batch-ocr] Response ${ri}: no <page> tags found. First 500 chars: ${responseText.slice(0, 500)}`);
              failCount++;
            }
            for (const [pageId, ocrText] of parsed) {
              pageResults.push({ pageId, text: ocrText });
            }
          }
        } else {
          // Single-page mode: match by metadata key (NEVER positional —
          // Gemini Batch API returns results in arbitrary order.
          // See Feb 18 2026 scrambling incident.)
          const validPageIdSet = new Set(pageIds as string[]);
          for (let i = 0; i < responses.length; i++) {
            const response = responses[i];
            const pageId = (response as unknown as { metadata?: { key?: string } }).metadata?.key;

            if (!pageId) {
              console.warn(`[batch-ocr] Result idx ${i} missing metadata.key — skipping to prevent scrambling (job ${jobName})`);
              failCount++;
              continue;
            }

            if (!validPageIdSet.has(pageId)) {
              console.warn(`[batch-ocr] Result metadata.key ${pageId} not in job's page_ids — skipping (job ${jobName})`);
              failCount++;
              continue;
            }

            const text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              pageResults.push({ pageId, text });
            } else {
              failCount++;
            }
          }
        }

        // Log collection summary
        if (isMultiPage) {
          const foundIds = new Set(pageResults.map(r => r.pageId));
          const missingIds = pageIds.filter((id: string) => !foundIds.has(id));
          console.log(`[batch-ocr] Collection summary: ${pageResults.length}/${pageIds.length} pages parsed, ${missingIds.length} missing${missingIds.length > 0 ? ': ' + missingIds.join(', ') : ''}`);
        }

        // Save each page result
        for (const { pageId, text } of pageResults) {
            const pageType = extractPageType(text);
            const columns = extractColumns(text);
            const detectedImages = parseDetectedImages(text);

            // Snapshot manual edits before overwriting
            await createRevision(pageId, 'ocr', jobName || undefined);

            const updateResult = await db.collection('pages').updateOne(
              { id: pageId, tenantId },
              {
                $set: {
                  'ocr.data': text,
                  'ocr.content_hash': contentHash(text),
                  'ocr.updated_at': now,
                  'ocr.model': jobDoc.model,
                  'ocr.language': jobDoc.language,
                  'ocr.source': 'batch_api',
                  'ocr.prompt_version': jobDoc.prompt_version || PROMPT_VERSION,
                  'ocr.prompt_id': jobDoc.prompt_id,
                  'ocr.prompt_hash': jobDoc.prompt_hash,
                  'ocr.prompt_name': jobDoc.prompt_name || 'Standard OCR',
                  'ocr.batch_job_id': jobDoc.job_name,
                  ...(jobDoc.pages_per_request > 1 && { 'ocr.pages_per_request': jobDoc.pages_per_request }),
                  ...(pageType && { page_type: pageType }),
                  ...(columns && { columns }),
                  ...(detectedImages.length > 0 && { detected_images: detectedImages }),
                  updated_at: new Date()
                }
              }
            );
            if (updateResult.matchedCount === 0) {
              console.warn(`[batch-ocr] Page ${pageId} not found in database`);
              failCount++;
              continue;
            }
            successCount++;
        }

        // Mark results as collected
        await db.collection('batch_jobs').updateOne(
          { job_name: jobName, tenantId },
          {
            $set: {
              results_collected: true,
              success_count: successCount,
              fail_count: failCount,
              completed_at: new Date()
            }
          }
        );

        // Calculate total tokens from responses
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        for (const response of responses) {
          const usage = response.response?.usageMetadata;
          if (usage) {
            totalInputTokens += usage.promptTokenCount || 0;
            totalOutputTokens += usage.candidatesTokenCount || 0;
          }
        }

        // Log batch job completion
        await logGeminiCall({
          type: 'ocr',
          mode: 'batch',
          model: jobDoc.model,
          book_id: bookId,
          book_title: undefined, // Could fetch from book if needed
          page_ids: pageIds.slice(0, successCount),
          page_count: successCount,
          batch_job_id: jobName,
          gemini_job_name: jobName,
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          status: successCount > 0 ? 'success' : 'failed',
          prompt_version: jobDoc.prompt_version || PROMPT_VERSION,
          endpoint: '/api/[tenant]/books/[id]/batch-ocr-async',
          triggered_by: triggeredBy,
          pages_per_request: jobDoc.pages_per_request,
        });

        return NextResponse.json({
          jobName,
          state: batchJob.state,
          resultsCollected: true,
          successCount,
          failCount,
          message: `Collected ${successCount} OCR results`
        });
      }
    }

    const state = batchJob.state || 'JOB_STATE_PENDING';
    return NextResponse.json({
      jobName,
      state,
      resultsCollected: false,
      message: state === 'JOB_STATE_SUCCEEDED'
        ? 'Results already collected'
        : `Job is ${state.replace('JOB_STATE_', '').toLowerCase()}`
    });

  } catch (error) {
    console.error('Batch OCR status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Status check failed' },
      { status: 500 }
    );
  }
});
