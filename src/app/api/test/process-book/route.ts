/**
 * Local Test Endpoint - Book Processor
 *
 * Simulates the Lambda book processor worker locally without SQS.
 * Call this to test the book processing logic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import type { BookProcessingMessage } from '@/lib/types/sqs';

export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as BookProcessingMessage;
    const { bookId, dbJobId, phase, startPageIndex, retryPageIds } = body;

    console.log(`[TEST] Processing book ${bookId}, phase: ${phase || 'auto-detect'}`);

    // Import and call the worker logic
    const { processBook } = await import('@/workers/book-processor-logic');

    await processBook({
      bookId,
      dbJobId,
      phase,
      startPageIndex,
      retryPageIds
    });

    return NextResponse.json({
      success: true,
      message: `Book ${bookId} processed successfully`,
      phase: phase || 'auto-detect'
    });

  } catch (error) {
    console.error('[TEST] Book processing error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
