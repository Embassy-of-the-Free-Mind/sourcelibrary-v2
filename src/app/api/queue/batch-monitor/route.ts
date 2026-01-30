import { handleCallback } from '@vercel/queue';
import { getDb } from '@/lib/mongodb';
import { getBatchJobStatus, getBatchJobResults } from '@/lib/gemini-batch';
import { calculateNextCheckDelay, enqueueBatchMonitor, enqueueBookTranslation } from '@/lib/api-client/queues';
import type { BatchMonitorPayload } from '@/lib/api-client/types/queues';
import { logGeminiCall } from '@/lib/gemini-logger';

/**
 * Queue Handler: batch-monitor
 *
 * Self-re-enqueuing handler that monitors Gemini Batch API jobs:
 * 1. Checks job status via Gemini Batch API
 * 2. If completed: Downloads results, saves to pages collection
 * 3. If OCR completed: Checks if all chunks done, triggers translation
 * 4. If translation completed: Checks if all chunks done, marks job complete
 * 5. If still processing: Re-enqueues self with adaptive delay (more frequent near 48h deadline)
 * 6. If expired (404): Marks batch_job as expired
 *
 * Adaptive delays:
 * - 0-12h: Check every 6 hours
 * - 12-36h: Check every 3 hours
 * - 36-46h: Check every 1 hour
 * - 46-48h: Check every 15 minutes (critical window)
 */

export const maxDuration = 300; // 5 minute timeout

export const POST = handleCallback({
  'batch-monitor': {
    'default': async (message) => {
      const payload = message as BatchMonitorPayload;
      const { geminiBatchJobId, jobType, bookId, dbJobId, submittedAt, attemptCount } = payload;

      console.log(`[batch-monitor] Checking ${jobType} batch ${geminiBatchJobId} (attempt ${attemptCount + 1})`);

      const db = await getDb();

      // Check batch job status from Gemini
      let status;
      try {
        status = await getBatchJobStatus(geminiBatchJobId);
      } catch (error: any) {
        // 404 means results expired (48h window passed)
        if (error.message?.includes('404') || error.message?.includes('not found')) {
          console.error(`[batch-monitor] Batch ${geminiBatchJobId} expired (48h window)`);

          await db.collection('batch_jobs').updateOne(
            { gemini_job_name: geminiBatchJobId },
            {
              $set: {
                status: 'expired',
                error: 'Results expired after 48h',
                updated_at: new Date()
              }
            }
          );

          // Return successfully to prevent retry
          return;
        }

        // Other errors - throw to trigger retry
        throw error;
      }

      // Update status in database
      await db.collection('batch_jobs').updateOne(
        { gemini_job_name: geminiBatchJobId },
        {
          $set: {
            gemini_state: status.state,
            updated_at: new Date()
          }
        }
      );

      console.log(`[batch-monitor] Batch ${geminiBatchJobId} state: ${status.state}`);

      // If completed, download and save results
      if (status.state === 'JOB_STATE_SUCCEEDED') {
        console.log(`[batch-monitor] Downloading results for ${geminiBatchJobId}`);

        const results = await getBatchJobResults(geminiBatchJobId);

        // Get batch job record to access metadata
        const batchJobRecord = await db.collection('batch_jobs').findOne({
          gemini_job_name: geminiBatchJobId
        });

        if (!batchJobRecord) {
          console.error(`[batch-monitor] Batch job record not found: ${geminiBatchJobId}`);
          throw new Error('Batch job record not found');
        }

        let successCount = 0;
        let failCount = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        const now = new Date().toISOString();

        // Process results
        for (const result of results) {
          // Check both locations for key (Gemini API may return in either place)
          const pageId = (result as { metadata?: { key?: string }; key?: string }).metadata?.key || result.key;

          // Extract text from response
          const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;

          // Track token usage
          const usage = result.response?.usageMetadata;
          if (usage) {
            totalInputTokens += usage.promptTokenCount || 0;
            totalOutputTokens += usage.candidatesTokenCount || 0;
          }

          if (text) {
            // Save OCR or translation result to pages collection
            if (jobType === 'ocr') {
              await db.collection('pages').updateOne(
                { id: pageId },
                {
                  $set: {
                    'ocr.data': text,
                    'ocr.updated_at': now,
                    'ocr.model': batchJobRecord.model,
                    'ocr.language': batchJobRecord.language,
                    'ocr.source': 'batch_api',
                    updated_at: new Date()
                  }
                }
              );
            } else if (jobType === 'translation') {
              await db.collection('pages').updateOne(
                { id: pageId },
                {
                  $set: {
                    'translation.data': text,
                    'translation.updated_at': now,
                    'translation.model': batchJobRecord.model,
                    'translation.source_language': batchJobRecord.source_language,
                    'translation.target_language': batchJobRecord.target_language,
                    'translation.source': 'batch_api',
                    updated_at: new Date()
                  }
                }
              );
            }
            successCount++;
          } else {
            console.warn(`[batch-monitor] No text in result for page ${pageId}`);
            failCount++;
          }
        }

        // Mark batch_job as completed
        await db.collection('batch_jobs').updateOne(
          { gemini_job_name: geminiBatchJobId },
          {
            $set: {
              status: 'completed',
              results_collected: true,
              success_count: successCount,
              fail_count: failCount,
              completed_at: new Date(),
              updated_at: new Date()
            }
          }
        );

        // Log batch job completion
        await logGeminiCall({
          type: jobType === 'translation' ? 'translate' : jobType, // Map 'translation' -> 'translate' for logger
          mode: 'batch',
          model: batchJobRecord.model,
          book_id: bookId,
          book_title: undefined,
          page_ids: batchJobRecord.page_ids || [],
          page_count: successCount,
          batch_job_id: geminiBatchJobId,
          gemini_job_name: geminiBatchJobId,
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          status: successCount > 0 ? 'success' : 'failed',
          endpoint: '/api/queue/batch-monitor',
        });

        console.log(`[batch-monitor] Collected ${successCount} results, ${failCount} failed for ${geminiBatchJobId}`);

        // Check if all chunks complete for this book/job
        if (jobType === 'ocr') {
          // Check if all OCR chunks for this book are complete
          const allChunks = await db.collection('batch_jobs').find({
            book_id: bookId,
            db_job_id: dbJobId,
            type: 'ocr'
          }).toArray();

          const completedChunks = allChunks.filter(c => c.status === 'completed').length;
          const totalChunks = allChunks[0]?.total_chunks || allChunks.length;

          console.log(`[batch-monitor] OCR progress: ${completedChunks}/${totalChunks} chunks for book ${bookId}`);

          if (completedChunks === totalChunks) {
            // All OCR chunks complete! Trigger translation
            console.log(`[batch-monitor] All OCR complete for book ${bookId}, triggering translation`);

            // Fetch book to get translation target language
            const book = await db.collection('books').findOne({ id: bookId });
            const targetLanguage = book?.target_language || 'English';
            const sourceLanguage = book?.original_language || batchJobRecord.language || 'Latin';

            const pages = await db.collection('pages')
              .find({ book_id: bookId })
              .sort({ page_number: 1 })
              .toArray();

            await enqueueBookTranslation({
              bookId,
              dbJobId,
              pageIds: pages.map(p => p.id),
              model: batchJobRecord.model,
              sourceLanguage,
              targetLanguage
            });
          }
        } else if (jobType === 'translation') {
          // Check if all translation chunks for this book are complete
          const allChunks = await db.collection('batch_jobs').find({
            book_id: bookId,
            db_job_id: dbJobId,
            type: 'translation'
          }).toArray();

          const completedChunks = allChunks.filter(c => c.status === 'completed').length;
          const totalChunks = allChunks[0]?.total_chunks || allChunks.length;

          console.log(`[batch-monitor] Translation progress: ${completedChunks}/${totalChunks} chunks for book ${bookId}`);

          if (completedChunks === totalChunks) {
            // All translation chunks complete! Mark job as done
            await db.collection('jobs').updateOne(
              { id: dbJobId },
              {
                $set: {
                  status: 'completed',
                  completed_at: new Date(),
                  updated_at: new Date()
                }
              }
            );
            console.log(`[batch-monitor] Book ${bookId} fully processed (OCR + Translation)`);
          }
        }

        // Job completed successfully
        return;
      }

      // If failed or cancelled
      if (status.state === 'JOB_STATE_FAILED' || status.state === 'JOB_STATE_CANCELLED') {
        console.error(`[batch-monitor] Batch ${geminiBatchJobId} ${status.state}`);

        await db.collection('batch_jobs').updateOne(
          { gemini_job_name: geminiBatchJobId },
          {
            $set: {
              status: status.state === 'JOB_STATE_FAILED' ? 'failed' : 'cancelled',
              error: `Gemini batch job ${status.state}`,
              updated_at: new Date()
            }
          }
        );

        // Return successfully to prevent retry
        return;
      }

      // Still processing - re-enqueue with adaptive delay
      const elapsed = (Date.now() - new Date(submittedAt).getTime()) / (1000 * 60 * 60); // hours
      const nextDelay = calculateNextCheckDelay(elapsed);

      console.log(`[batch-monitor] Batch ${geminiBatchJobId} still ${status.state}, re-checking in ${Math.round(nextDelay / 60000)} minutes`);

      await enqueueBatchMonitor({
        geminiBatchJobId,
        jobType,
        bookId,
        dbJobId,
        submittedAt,
        attemptCount: attemptCount + 1
      }, nextDelay);
    }
  }
});
