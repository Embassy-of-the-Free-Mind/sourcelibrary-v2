import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { PipelineState, PipelineStep, PipelineStepState, PipelineConfig, DEFAULT_MODEL } from '@/lib/types';

// Helper to create initial pipeline state
function createInitialPipelineState(config: Partial<PipelineConfig>): PipelineState {
  const defaultStep: PipelineStepState = { status: 'pending' };

  return {
    status: 'idle',
    currentStep: null,
    steps: {
      crop: { ...defaultStep },
      ocr: { ...defaultStep },
      translate: { ...defaultStep },
      summarize: { ...defaultStep },
      edition: { ...defaultStep },
    },
    config: {
      model: config.model || DEFAULT_MODEL,
      language: config.language || 'Latin',
      license: config.license || 'CC0-1.0',
    },
  };
}

// GET: Retrieve current pipeline state
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne(
      { id: bookId },
      { projection: { pipeline: 1, title: 1, display_title: 1, language: 1, pages_count: 1 } }
    );

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json({
      bookId,
      bookTitle: book.display_title || book.title,
      language: book.language,
      pagesCount: book.pages_count,
      pipeline: book.pipeline || null,
    });
  } catch (error) {
    console.error('Error fetching pipeline:', error);
    return NextResponse.json({ error: 'Failed to fetch pipeline' }, { status: 500 });
  }
}

// POST: Pipeline actions (start, pause, resume, reset)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();
    const body = await request.json();

    const { action, config } = body as {
      action: 'start' | 'pause' | 'resume' | 'reset';
      config?: Partial<PipelineConfig>;
    };

    // Find the book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    let pipeline: PipelineState = book.pipeline || createInitialPipelineState(config || {});

    switch (action) {
      case 'start':
        if (pipeline.status === 'running') {
          return NextResponse.json({ error: 'Pipeline already running' }, { status: 400 });
        }
        // Initialize or restart pipeline
        pipeline = createInitialPipelineState(config || pipeline.config);
        pipeline.status = 'running';
        pipeline.started_at = new Date();
        break;

      case 'pause':
        if (pipeline.status !== 'running') {
          return NextResponse.json({ error: 'Pipeline not running' }, { status: 400 });
        }
        pipeline.status = 'paused';
        break;

      case 'resume':
        if (pipeline.status !== 'paused') {
          return NextResponse.json({ error: 'Pipeline not paused' }, { status: 400 });
        }
        pipeline.status = 'running';
        break;

      case 'reset':
        pipeline = createInitialPipelineState(config || {});
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Update the book
    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          pipeline,
          updated_at: new Date(),
        },
      }
    );

    return NextResponse.json({ success: true, pipeline });
  } catch (error) {
    console.error('Error updating pipeline:', error);
    return NextResponse.json({ error: 'Failed to update pipeline' }, { status: 500 });
  }
}

// PATCH: Update individual step state
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();
    const body = await request.json();

    const { step, status, progress, error, result, currentStep, pipelineStatus } = body as {
      step?: PipelineStep;
      status?: PipelineStepState['status'];
      progress?: { completed: number; total: number };
      error?: string;
      result?: Record<string, unknown>;
      currentStep?: PipelineStep | null;
      pipelineStatus?: PipelineState['status'];
    };

    const updateFields: Record<string, unknown> = {
      updated_at: new Date(),
    };

    // Update step-specific fields
    if (step) {
      if (status !== undefined) {
        updateFields[`pipeline.steps.${step}.status`] = status;
      }
      if (progress !== undefined) {
        updateFields[`pipeline.steps.${step}.progress`] = progress;
      }
      if (error !== undefined) {
        updateFields[`pipeline.steps.${step}.error`] = error;
      }
      if (result !== undefined) {
        updateFields[`pipeline.steps.${step}.result`] = result;
      }
      if (status === 'running') {
        updateFields[`pipeline.steps.${step}.started_at`] = new Date();
      }
      if (status === 'completed' || status === 'failed' || status === 'skipped') {
        updateFields[`pipeline.steps.${step}.completed_at`] = new Date();
      }
    }

    // Update pipeline-level fields
    if (currentStep !== undefined) {
      updateFields['pipeline.currentStep'] = currentStep;
    }
    if (pipelineStatus !== undefined) {
      updateFields['pipeline.status'] = pipelineStatus;
      if (pipelineStatus === 'completed' || pipelineStatus === 'failed') {
        updateFields['pipeline.completed_at'] = new Date();
      }
    }

    const result_update = await db.collection('books').updateOne(
      { id: bookId },
      { $set: updateFields }
    );

    if (result_update.matchedCount === 0) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Fetch and return updated pipeline
    const book = await db.collection('books').findOne(
      { id: bookId },
      { projection: { pipeline: 1 } }
    );

    return NextResponse.json({ success: true, pipeline: book?.pipeline });
  } catch (error) {
    console.error('Error updating pipeline step:', error);
    return NextResponse.json({ error: 'Failed to update pipeline step' }, { status: 500 });
  }
}
