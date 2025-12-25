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

// Step: Split Check - runs inline since it's quick
async function executeSplitCheck(bookId: string, db: Awaited<ReturnType<typeof getDb>>): Promise<{
  status: 'completed' | 'skipped' | 'failed';
  result?: Record<string, unknown>;
  error?: string
}> {
  // Check if any pages might need splitting (no crop data yet)
  const pagesNeedingSplit = await db.collection('pages')
    .countDocuments({ book_id: bookId, crop: { $exists: false } });

  if (pagesNeedingSplit === 0) {
    return { status: 'skipped', result: { message: 'All pages already have crop data' } };
  }

  // For now, skip auto-split - user should use prepare page manually
  return {
    status: 'skipped',
    result: {
      message: `${pagesNeedingSplit} pages may need splitting - use Prepare page`,
      pagesNeedingSplit
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

  const job: Job = {
    id: jobId,
    type: 'batch_ocr',
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

  const job: Job = {
    id: jobId,
    type: 'batch_translate',
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
    },
  };

  await db.collection('jobs').insertOne(job as unknown as Record<string, unknown>);

  return { jobId, total: pages.length };
}

// Step: Summarize - runs inline since it's one API call
async function executeSummarize(
  bookId: string,
  config: PipelineConfig,
  db: Awaited<ReturnType<typeof getDb>>
): Promise<{ status: 'completed' | 'failed'; result?: Record<string, unknown>; error?: string }> {
  // Get translated pages for summary
  const translatedPages = await db.collection('pages')
    .find({
      book_id: bookId,
      'translation.data': { $exists: true, $ne: '' }
    })
    .sort({ page_number: 1 })
    .limit(50) // Limit for context window
    .toArray();

  if (translatedPages.length === 0) {
    return { status: 'failed', error: 'No translated pages to summarize' };
  }

  // Combine translations for summary
  const combinedText = translatedPages
    .map(p => `[Page ${p.page_number}]\n${p.translation.data}`)
    .join('\n\n---\n\n');

  // Import and use generateSummary - simplified version
  const { generateSummary } = await import('@/lib/ai');

  try {
    const summaryResult = await generateSummary(
      combinedText.slice(0, 50000), // Limit input
      undefined,
      undefined,
      config.model
    );

    // Save summary to book
    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          reading_summary: {
            overview: summaryResult.text,
            quotes: [],
            themes: [],
            generated_at: new Date(),
            model: config.model,
            pages_analyzed: translatedPages.length,
          },
          updated_at: new Date(),
        },
      }
    );

    return {
      status: 'completed',
      result: {
        pagesAnalyzed: translatedPages.length,
        message: 'Book summary generated',
      },
    };
  } catch (error) {
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
      case 'split_check':
        stepResult = await executeSplitCheck(bookId, db);
        break;

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
    const stepOrder: PipelineStep[] = ['split_check', 'ocr', 'translate', 'summarize', 'edition'];
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
