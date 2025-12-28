import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { PipelineStep, PipelineState, PipelineConfig, Job } from '@/lib/types';
import { nanoid } from 'nanoid';

// Increase timeout for long-running steps
export const maxDuration = 60;

// Helper to update pipeline state
async function updatePipeline(
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never,
  bookId: string,
  updates: Record<string, unknown>
) {
  await db.collection('books').updateOne(
    { id: bookId },
    { $set: { ...updates, updated_at: new Date() } }
  );
}

// Step: Generate Cropped Images - creates job for pages with crop data but no cropped_photo
async function createCropJob(
  bookId: string,
  db: Awaited<ReturnType<typeof getDb>>
): Promise<{ status: 'completed' | 'skipped' | 'job_created'; jobId?: string; result?: Record<string, unknown> }> {
  // Find pages with crop data but no cropped_photo
  const pages = await db.collection('pages')
    .find({
      book_id: bookId,
      'crop.xStart': { $exists: true },
      $or: [
        { cropped_photo: { $exists: false } },
        { cropped_photo: null },
        { cropped_photo: '' }
      ]
    })
    .project({ id: 1, page_number: 1 })
    .toArray();

  if (pages.length === 0) {
    return { status: 'skipped', result: { message: 'No pages need cropped images' } };
  }

  // Create a job to generate cropped images
  const book = await db.collection('books').findOne({ id: bookId });
  const jobId = nanoid(12);

  const job: Job = {
    id: jobId,
    type: 'generate_cropped_images',
    status: 'pending',
    progress: {
      total: pages.length,
      completed: 0,
      failed: 0,
    },
    book_id: bookId,
    book_title: book?.display_title || book?.title,
    initiated_by: 'pipeline',
    created_at: new Date(),
    updated_at: new Date(),
    results: [],
    config: {
      page_ids: pages.map(p => p.id),
    },
  };

  await db.collection('jobs').insertOne(job as unknown as Record<string, unknown>);

  return {
    status: 'job_created',
    jobId,
    result: {
      jobId,
      total: pages.length,
      message: `Generating cropped images for ${pages.length} pages`
    }
  };
}

// Create a job for OCR processing
async function createOcrJob(
  bookId: string,
  config: PipelineConfig,
  db: Awaited<ReturnType<typeof getDb>>
): Promise<{ jobId: string; total: number } | { error: string }> {
  // Get pages that need OCR
  const pages = await db.collection('pages')
    .find({
      book_id: bookId,
      $or: [
        { 'ocr.data': { $exists: false } },
        { 'ocr.data': '' }
      ]
    })
    .sort({ page_number: 1 })
    .project({ id: 1, page_number: 1 })
    .toArray();

  if (pages.length === 0) {
    return { error: 'no_pages' };
  }

  const book = await db.collection('books').findOne({ id: bookId });
  const jobId = nanoid(12);

  const useBatch = config.useBatchApi !== false; // Default to batch

  const job: Job = {
    id: jobId,
    type: useBatch ? 'batch_ocr' : 'ocr',
    status: 'pending',
    progress: {
      total: pages.length,
      completed: 0,
      failed: 0,
    },
    book_id: bookId,
    book_title: book?.display_title || book?.title,
    initiated_by: 'pipeline',
    created_at: new Date(),
    updated_at: new Date(),
    results: [],
    config: {
      model: config.model,
      language: config.language,
      page_ids: pages.map(p => p.id),
      use_batch_api: useBatch,
    },
  };

  await db.collection('jobs').insertOne(job as unknown as Record<string, unknown>);

  return { jobId, total: pages.length };
}

// Create a job for translation processing
async function createTranslateJob(
  bookId: string,
  config: PipelineConfig,
  db: Awaited<ReturnType<typeof getDb>>
): Promise<{ jobId: string; total: number } | { error: string }> {
  // Get pages that have OCR but no translation
  const pages = await db.collection('pages')
    .find({
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: '' },
      $or: [
        { 'translation.data': { $exists: false } },
        { 'translation.data': '' }
      ]
    })
    .sort({ page_number: 1 })
    .project({ id: 1, page_number: 1 })
    .toArray();

  if (pages.length === 0) {
    return { error: 'no_pages' };
  }

  const book = await db.collection('books').findOne({ id: bookId });
  const jobId = nanoid(12);

  const useBatch = config.useBatchApi !== false; // Default to batch

  const job: Job = {
    id: jobId,
    type: useBatch ? 'batch_translate' : 'translate',
    status: 'pending',
    progress: {
      total: pages.length,
      completed: 0,
      failed: 0,
    },
    book_id: bookId,
    book_title: book?.display_title || book?.title,
    initiated_by: 'pipeline',
    created_at: new Date(),
    updated_at: new Date(),
    results: [],
    config: {
      model: config.model,
      language: config.language,
      page_ids: pages.map(p => p.id),
      use_batch_api: useBatch,
    },
  };

  await db.collection('jobs').insertOne(job as unknown as Record<string, unknown>);

  return { jobId, total: pages.length };
}

// Step: Summarize - generates the engagement-focused index summary
// This uses the same approach as /api/books/[id]/index to create compelling copy
async function executeSummarize(
  bookId: string,
  _config: PipelineConfig,
  db: Awaited<ReturnType<typeof getDb>>
): Promise<{ status: 'completed' | 'failed'; result?: Record<string, unknown>; error?: string }> {
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) {
    return { status: 'failed', error: 'Book not found' };
  }

  const bookTitle = book.display_title || book.title || 'Unknown';

  // Check if we have translated pages
  const translatedCount = await db.collection('pages').countDocuments({
    book_id: bookId,
    'translation.data': { $exists: true, $ne: '' }
  });

  if (translatedCount === 0) {
    return { status: 'failed', error: 'No translated pages to summarize' };
  }

  try {
    // Clear any existing index/summary cache first
    await db.collection('books').updateOne(
      { id: bookId },
      { $unset: { index: '', summary: '' } }
    );

    // Call the index API to generate the engagement-focused summary
    // This endpoint generates compelling copy + extracts summaries from [[summary:]] tags
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const indexResponse = await fetch(`${baseUrl}/api/books/${bookId}/index`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!indexResponse.ok) {
      const errorText = await indexResponse.text();
      console.error('[Pipeline] Index generation failed:', errorText);
      return { status: 'failed', error: 'Failed to generate book index' };
    }

    const indexData = await indexResponse.json();

    console.log(`[Pipeline] Generated index for "${bookTitle}" with ${indexData.pagesCovered}/${indexData.totalPages} pages`);

    return {
      status: 'completed',
      result: {
        pagesCovered: indexData.pagesCovered,
        totalPages: indexData.totalPages,
        hasSummary: !!indexData.bookSummary?.brief,
        sectionsCount: indexData.sectionSummaries?.length || 0,
        message: `Index generated with ${indexData.pagesCovered} page summaries`,
      },
    };
  } catch (error) {
    console.error('[Pipeline] Summary generation error:', error);
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Failed to generate summary'
    };
  }
}

// Step: Create Edition
async function executeEdition(
  bookId: string,
  config: PipelineConfig,
  db: Awaited<ReturnType<typeof getDb>>
): Promise<{ status: 'completed' | 'failed'; result?: Record<string, unknown>; error?: string }> {
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) {
    return { status: 'failed', error: 'Book not found' };
  }

  // Count translated pages
  const translatedCount = await db.collection('pages').countDocuments({
    book_id: bookId,
    'translation.data': { $exists: true, $ne: '' }
  });

  if (translatedCount === 0) {
    return { status: 'failed', error: 'No translated pages for edition' };
  }

  // Create edition directly
  const { nanoid } = await import('nanoid');
  const editionId = nanoid(12);

  // Get existing editions count for version number
  const existingEditions = book.editions || [];
  const version = `1.${existingEditions.length}`;

  const edition = {
    id: editionId,
    version,
    status: 'draft',
    license: config.license || 'CC0-1.0',
    created_at: new Date(),
    pages_count: translatedCount,
  };

  // Add edition to array and update current edition
  await db.collection('books').updateOne(
    { id: bookId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { $push: { editions: edition } } as any
  );
  await db.collection('books').updateOne(
    { id: bookId },
    { $set: { current_edition_id: editionId, updated_at: new Date() } }
  );

  return {
    status: 'completed',
    result: {
      editionId,
      version,
      reviewUrl: `/book/${bookId}/edition/${editionId}/review`,
      message: `Edition ${version} created - ready for review`,
    },
  };
}

// POST: Execute a pipeline step
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();
    const body = await request.json();

    const { step } = body as { step: PipelineStep };

    if (!step) {
      return NextResponse.json({ error: 'Step required' }, { status: 400 });
    }

    // Get current pipeline state
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const pipeline = book.pipeline as PipelineState | undefined;
    if (!pipeline) {
      return NextResponse.json({ error: 'Pipeline not initialized' }, { status: 400 });
    }

    if (pipeline.status !== 'running') {
      return NextResponse.json({ error: 'Pipeline not running' }, { status: 400 });
    }

    // Mark step as running
    await updatePipeline(db, bookId, {
      'pipeline.currentStep': step,
      [`pipeline.steps.${step}.status`]: 'running',
      [`pipeline.steps.${step}.started_at`]: new Date(),
    });

    // Execute the step
    let stepResult: {
      status: 'completed' | 'skipped' | 'failed' | 'job_created';
      result?: Record<string, unknown>;
      error?: string;
      jobId?: string;
    };

    switch (step) {
      case 'crop': {
        const cropResult = await createCropJob(bookId, db);
        if (cropResult.status === 'skipped') {
          stepResult = { status: 'skipped', result: cropResult.result };
        } else {
          stepResult = {
            status: 'job_created',
            jobId: cropResult.jobId,
            result: cropResult.result
          };
        }
        break;
      }

      case 'ocr': {
        const ocrResult = await createOcrJob(bookId, pipeline.config, db);
        if ('error' in ocrResult) {
          if (ocrResult.error === 'no_pages') {
            stepResult = { status: 'completed', result: { message: 'All pages already have OCR' } };
          } else {
            stepResult = { status: 'failed', error: ocrResult.error };
          }
        } else {
          stepResult = {
            status: 'job_created',
            jobId: ocrResult.jobId,
            result: {
              jobId: ocrResult.jobId,
              total: ocrResult.total,
              message: `Created OCR job for ${ocrResult.total} pages`
            }
          };
        }
        break;
      }

      case 'translate': {
        const translateResult = await createTranslateJob(bookId, pipeline.config, db);
        if ('error' in translateResult) {
          if (translateResult.error === 'no_pages') {
            stepResult = { status: 'completed', result: { message: 'All pages already translated' } };
          } else {
            stepResult = { status: 'failed', error: translateResult.error };
          }
        } else {
          stepResult = {
            status: 'job_created',
            jobId: translateResult.jobId,
            result: {
              jobId: translateResult.jobId,
              total: translateResult.total,
              message: `Created translation job for ${translateResult.total} pages`
            }
          };
        }
        break;
      }

      case 'summarize':
        stepResult = await executeSummarize(bookId, pipeline.config, db);
        break;

      case 'edition':
        stepResult = await executeEdition(bookId, pipeline.config, db);
        break;

      default:
        return NextResponse.json({ error: 'Invalid step' }, { status: 400 });
    }

    // Update step with result
    const stepUpdates: Record<string, unknown> = {};

    if (stepResult.status === 'job_created') {
      // Job created - step stays running, frontend will poll job
      stepUpdates[`pipeline.steps.${step}.jobId`] = stepResult.jobId;
      stepUpdates[`pipeline.steps.${step}.result`] = stepResult.result;
    } else {
      // Step completed inline
      stepUpdates[`pipeline.steps.${step}.status`] = stepResult.status;
      stepUpdates[`pipeline.steps.${step}.completed_at`] = new Date();

      if (stepResult.result) {
        stepUpdates[`pipeline.steps.${step}.result`] = stepResult.result;
      }
      if (stepResult.error) {
        stepUpdates[`pipeline.steps.${step}.error`] = stepResult.error;
      }

      // Check if this was the last step or if step failed
      const isLastStep = step === 'edition';
      const stepFailed = stepResult.status === 'failed';

      if (isLastStep || stepFailed) {
        stepUpdates['pipeline.status'] = stepFailed ? 'failed' : 'completed';
        stepUpdates['pipeline.completed_at'] = new Date();
        stepUpdates['pipeline.currentStep'] = null;

        if (stepFailed) {
          stepUpdates['pipeline.error'] = stepResult.error;
        }
      }
    }

    await updatePipeline(db, bookId, stepUpdates);

    // Determine next step
    const stepOrder: PipelineStep[] = ['crop', 'ocr', 'translate', 'summarize', 'edition'];
    let nextStep: PipelineStep | null = null;

    if (stepResult.status !== 'failed' && stepResult.status !== 'job_created') {
      const isLastStep = step === 'edition';
      if (!isLastStep) {
        const currentIndex = stepOrder.indexOf(step);
        nextStep = stepOrder[currentIndex + 1];
      }
    }

    return NextResponse.json({
      success: true,
      step,
      ...stepResult,
      nextStep,
    });
  } catch (error) {
    console.error('Error executing pipeline step:', error);

    // Try to mark step as failed
    try {
      const { id: bookId } = await params;
      const db = await getDb();
      const body = await request.json().catch(() => ({}));
      const step = body.step;

      if (step) {
        await updatePipeline(db, bookId, {
          [`pipeline.steps.${step}.status`]: 'failed',
          [`pipeline.steps.${step}.error`]: error instanceof Error ? error.message : 'Unknown error',
          [`pipeline.steps.${step}.completed_at`]: new Date(),
          'pipeline.status': 'failed',
          'pipeline.error': error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } catch {
      // Ignore cleanup errors
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Step execution failed' },
      { status: 500 }
    );
  }
}
