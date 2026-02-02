import { NextRequest, NextResponse } from 'next/server';
import { send } from '@vercel/queue';

/**
 * Simple POC Queue Sender
 * POST /api/test-queue-send
 *
 * Send a test message to the queue
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({ message: 'Default test message' }));

    const testMessage = {
      message: body.message || 'Hello from test queue!',
      timestamp: new Date().toISOString(),
      requestId: Math.random().toString(36).substring(7)
    };

    console.log('[TEST QUEUE SENDER] Sending message:', testMessage);

    // Send to test-queue
    const result = await send(
      'test-queue',
      testMessage,
      {
        retentionSeconds: 3600, // Optional: override retention time (defaults to 24 hours)    
      });

    console.log('[TEST QUEUE SENDER] Message enqueued successfully');
    console.log('[TEST QUEUE SENDER] Result:', result);

    return NextResponse.json({
      success: true,
      message: 'Test message enqueued',
      testMessage,
      queueResult: result
    });

  } catch (error) {
    console.error('[TEST QUEUE SENDER] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
