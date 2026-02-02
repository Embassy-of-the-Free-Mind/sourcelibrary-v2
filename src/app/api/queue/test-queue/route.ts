import { handleCallback } from '@vercel/queue';

/**
 * Simple POC Queue Handler
 * This handler receives messages from the test queue and logs them
 */

export const maxDuration = 60;

export const POST = handleCallback({
  'test-queue': {
    'default': async (message, metadata) => {
      console.log('========================================');
      console.log('[TEST QUEUE] ✅ Handler was invoked!');
      console.log('[TEST QUEUE] Message received:', JSON.stringify(message, null, 2));
      console.log('[TEST QUEUE] Timestamp:', new Date().toISOString());
      console.log('[TEST QUEUE] Metadata:', JSON.stringify(metadata, null, 2));
      console.log('========================================');

      // Simulate some processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log('[TEST QUEUE] Processing complete!');
    }
  }
});
