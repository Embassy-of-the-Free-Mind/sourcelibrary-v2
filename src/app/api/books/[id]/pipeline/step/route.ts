import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { PipelineStep, PipelineState, PipelineConfig } from '@/lib/types';

// Increase timeout for long-running steps
export const maxDuration = 300;

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

// Helper to get internal API base URL
function getBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return process.env.NEXTAUTH_URL || 'http://localhost:3000';
}

// Step: Split Check
async function executeSplitCheck(bookId: string): Promise<{ status: 'completed' | 'skipped' | 'failed'; result?: Record<string, unknown>; error?: string }> {
  const baseUrl = getBaseUrl();

  // Check if any pages need splitting
  const checkRes = await fetch(`${baseUrl}/api/books/${bookId}/auto-split-ml`, {
    method: 'GET',
  });

  if (!checkRes.ok) {
    // If no ML model trained, skip split check
    const errorData = await checkRes.json().catch(() => ({}));
    if (errorData.error?.includes('No active model')) {
      return { status: 'skipped', result: { message: 'No split detection model trained' } };
    }
    return { status: 'failed', error: 'Failed to check split status' };
  }

  const { needsSplitting } = await checkRes.json();

  if (needsSplitting === 0) {
    return { status: 'skipped', result: { message: 'No two-page spreads detected' } };
  }

  // Run auto-split
  const splitRes = await fetch(`${baseUrl}/api/books/${bookId}/auto-split-ml`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 200 }),
  });

  if (!splitRes.ok) {
    return { status: 'failed', error: 'Failed to auto-split pages' };
  }

  const splitData = await splitRes.json();
  return {
    status: 'completed',
    result: {
      pagesSplit: splitData.processed || 0,
      message: `Split ${splitData.processed || 0} two-page spreads`,
    },
  };
}

// Step: OCR
async function executeOcr(
  bookId: string,
  config: PipelineConfig,
  onProgress: (progress: { completed: number; total: number }) => Promise<void>
): Promise<{ status: 'completed' | 'failed'; result?: Record<string, unknown>; error?: string }> {
  const baseUrl = getBaseUrl();
  let totalProcessed = 0;
  let totalFailed = 0;
  let remaining = Infinity;
  let total = 0;

  // Get initial count
  const statusRes = await fetch(`${baseUrl}/api/books/${bookId}/batch-ocr`, { method: 'GET' });
  if (statusRes.ok) {
    const statusData = await statusRes.json();
    total = statusData.pagesNeedingOcr || 0;
    remaining = total;
  }

  if (total === 0) {
    return { status: 'completed', result: { pagesProcessed: 0, message: 'All pages already have OCR' } };
  }

  while (remaining > 0) {
    const res = await fetch(`${baseUrl}/api/books/${bookId}/batch-ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: 25,
        model: config.model,
        language: config.language,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return { status: 'failed', error: errorData.error || 'OCR batch failed' };
    }

    const data = await res.json();
    totalProcessed += data.successful || 0;
    totalFailed += data.failed || 0;
    remaining = data.remaining || 0;

    await onProgress({ completed: totalProcessed, total });
  }

  return {
    status: 'completed',
    result: {
      pagesProcessed: totalProcessed,
      pagesFailed: totalFailed,
      message: `OCR completed: ${totalProcessed} pages${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`,
    },
  };
}

// Step: Translate
async function executeTranslate(
  bookId: string,
  config: PipelineConfig,
  onProgress: (progress: { completed: number; total: number }) => Promise<void>
): Promise<{ status: 'completed' | 'failed'; result?: Record<string, unknown>; error?: string }> {
  const baseUrl = getBaseUrl();
  let totalProcessed = 0;
  let totalFailed = 0;
  let remaining = Infinity;
  let total = 0;

  // Get initial count
  const statusRes = await fetch(`${baseUrl}/api/books/${bookId}/batch-translate`, { method: 'GET' });
  if (statusRes.ok) {
    const statusData = await statusRes.json();
    total = statusData.pagesNeedingTranslation || 0;
    remaining = total;
  }

  if (total === 0) {
    return { status: 'completed', result: { pagesTranslated: 0, message: 'All pages already translated' } };
  }

  while (remaining > 0) {
    const res = await fetch(`${baseUrl}/api/books/${bookId}/batch-translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: 50,
        model: config.model,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return { status: 'failed', error: errorData.error || 'Translation batch failed' };
    }

    const data = await res.json();
    totalProcessed += data.successful || 0;
    totalFailed += data.failed || 0;
    remaining = data.remaining || 0;

    await onProgress({ completed: totalProcessed, total });
  }

  return {
    status: 'completed',
    result: {
      pagesTranslated: totalProcessed,
      pagesFailed: totalFailed,
      message: `Translation completed: ${totalProcessed} pages${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`,
    },
  };
}

// Step: Summarize
async function executeSummarize(
  bookId: string,
  config: PipelineConfig
): Promise<{ status: 'completed' | 'failed'; result?: Record<string, unknown>; error?: string }> {
  const baseUrl = getBaseUrl();

  const res = await fetch(`${baseUrl}/api/books/${bookId}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    return { status: 'failed', error: errorData.error || 'Failed to generate summary' };
  }

  const data = await res.json();
  return {
    status: 'completed',
    result: {
      pagesAnalyzed: data.pages_analyzed || 0,
      message: 'Book summary generated',
    },
  };
}

// Step: Create Edition
async function executeEdition(
  bookId: string,
  config: PipelineConfig
): Promise<{ status: 'completed' | 'failed'; result?: Record<string, unknown>; error?: string }> {
  const baseUrl = getBaseUrl();

  // Create edition
  const editionRes = await fetch(`${baseUrl}/api/books/${bookId}/editions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license: config.license }),
  });

  if (!editionRes.ok) {
    const errorData = await editionRes.json().catch(() => ({}));
    return { status: 'failed', error: errorData.error || 'Failed to create edition' };
  }

  const editionData = await editionRes.json();
  const editionId = editionData.id;

  // Generate front matter
  const frontMatterRes = await fetch(`${baseUrl}/api/books/${bookId}/editions/front-matter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edition_id: editionId }),
  });

  // Front matter is optional - don't fail if it doesn't work
  if (!frontMatterRes.ok) {
    console.warn('Failed to generate front matter, continuing anyway');
  }

  return {
    status: 'completed',
    result: {
      editionId,
      version: editionData.version,
      reviewUrl: `/book/${bookId}/edition/${editionId}/review`,
      message: `Edition ${editionData.version} created - ready for review`,
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

    // Progress callback
    const onProgress = async (progress: { completed: number; total: number }) => {
      await updatePipeline(db, bookId, {
        [`pipeline.steps.${step}.progress`]: progress,
      });
    };

    // Execute the step
    let stepResult: { status: 'completed' | 'skipped' | 'failed'; result?: Record<string, unknown>; error?: string };

    switch (step) {
      case 'split_check':
        stepResult = await executeSplitCheck(bookId);
        break;
      case 'ocr':
        stepResult = await executeOcr(bookId, pipeline.config, onProgress);
        break;
      case 'translate':
        stepResult = await executeTranslate(bookId, pipeline.config, onProgress);
        break;
      case 'summarize':
        stepResult = await executeSummarize(bookId, pipeline.config);
        break;
      case 'edition':
        stepResult = await executeEdition(bookId, pipeline.config);
        break;
      default:
        return NextResponse.json({ error: 'Invalid step' }, { status: 400 });
    }

    // Update step with result
    const stepUpdates: Record<string, unknown> = {
      [`pipeline.steps.${step}.status`]: stepResult.status,
      [`pipeline.steps.${step}.completed_at`]: new Date(),
    };

    if (stepResult.result) {
      stepUpdates[`pipeline.steps.${step}.result`] = stepResult.result;
    }
    if (stepResult.error) {
      stepUpdates[`pipeline.steps.${step}.error`] = stepResult.error;
    }

    // Check if this was the last step or if step failed
    const stepOrder: PipelineStep[] = ['split_check', 'ocr', 'translate', 'summarize', 'edition'];
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

    await updatePipeline(db, bookId, stepUpdates);

    // Determine next step
    let nextStep: PipelineStep | null = null;
    if (!isLastStep && !stepFailed) {
      const currentIndex = stepOrder.indexOf(step);
      nextStep = stepOrder[currentIndex + 1];
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
