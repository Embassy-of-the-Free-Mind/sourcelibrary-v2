/**
 * Local Test Endpoint - OCR Processor
 *
 * Simulates the Lambda OCR processor worker locally without SQS.
 * Call this to test OCR processing for a single page.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { PageOcrMessage } from '@/lib/types/sqs';

export const maxDuration = 120; // 2 minutes

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as PageOcrMessage;
    const { bookId, pageId, dbJobId } = body;

    console.log(`[TEST] Processing OCR for page ${pageId} in book ${bookId}`);

    // Import and call the worker logic
    const { processOcrPage } = await import('@/workers/ocr-processor-logic');

    await processOcrPage({
      bookId,
      pageId,
      dbJobId
    });

    return NextResponse.json({
      success: true,
      message: `Page ${pageId} OCR processed successfully`
    });

  } catch (error) {
    console.error('[TEST] OCR processing error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
