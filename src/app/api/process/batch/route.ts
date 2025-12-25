import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performOCR } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';

const CONCURRENCY_LIMIT = 10;

interface BatchOCRRequest {
  pages: Array<{
    pageId: string;
    imageUrl: string;
    language?: string;
    previousOcr?: string;
    customPrompt?: string;
  }>;
  autoSave?: boolean;
  model?: string;
}

interface BatchResult {
  pageId: string;
  success: boolean;
  ocr?: string;
  error?: string;
  duration?: number;
}

// Process a chunk of pages in parallel
async function processChunk(
  chunk: BatchOCRRequest['pages'],
  autoSave: boolean,
  db: Awaited<ReturnType<typeof getDb>>,
  model: string
): Promise<BatchResult[]> {
  // Look up pages to get cropped_photo if available
  const pageIds = chunk.map(p => p.pageId);
  const dbPages = await db.collection('pages').find({ id: { $in: pageIds } }).toArray();
  const dbPageMap = new Map(dbPages.map(p => [p.id, p]));

  const promises = chunk.map(async (page) => {
    const startTime = performance.now();
    try {
      // Use cropped_photo if available, otherwise fall back to photo or input imageUrl
      const dbPage = dbPageMap.get(page.pageId);
      const finalImageUrl = dbPage?.cropped_photo || dbPage?.photo || page.imageUrl;

      const ocrResult = await performOCR(
        finalImageUrl,
        page.language || 'Latin',
        page.previousOcr,
        page.customPrompt,
        model
      );

      const duration = performance.now() - startTime;

      // Record metric
      await db.collection('loading_metrics').insertOne({
        name: 'ocr_processing_batch',
        duration,
        timestamp: Date.now(),
        metadata: {
          pageId: page.pageId,
          language: page.language || 'Latin',
          textLength: ocrResult.text?.length || 0,
          batchSize: chunk.length,
          model,
        },
        received_at: Date.now(),
      });

      // Auto-save to database
      if (autoSave && page.pageId) {
        await db.collection('pages').updateOne(
          { id: page.pageId },
          {
            $set: {
              ocr: {
                data: ocrResult.text,
                language: page.language || 'Latin',
                model,
                updated_at: new Date(),
              },
              updated_at: new Date(),
            },
          }
        );
      }

      return {
        pageId: page.pageId,
        success: true,
        ocr: ocrResult.text,
        duration,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      return {
        pageId: page.pageId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      };
    }
  });

  return Promise.all(promises);
}

export async function POST(request: NextRequest) {
  try {
    const body: BatchOCRRequest = await request.json();
    const { pages, autoSave = true, model = DEFAULT_MODEL } = body;

    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return NextResponse.json(
        { error: 'pages array required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const allResults: BatchResult[] = [];
    const batchStartTime = performance.now();

    // Process in chunks of CONCURRENCY_LIMIT
    for (let i = 0; i < pages.length; i += CONCURRENCY_LIMIT) {
      const chunk = pages.slice(i, i + CONCURRENCY_LIMIT);
      const chunkResults = await processChunk(chunk, autoSave, db, model);
      allResults.push(...chunkResults);
    }

    const totalDuration = performance.now() - batchStartTime;

    // Record batch-level metric
    await db.collection('loading_metrics').insertOne({
      name: 'ocr_batch_total',
      duration: totalDuration,
      timestamp: Date.now(),
      metadata: {
        totalPages: pages.length,
        successful: allResults.filter((r) => r.success).length,
        failed: allResults.filter((r) => !r.success).length,
        concurrencyLimit: CONCURRENCY_LIMIT,
      },
      received_at: Date.now(),
    });

    return NextResponse.json({
      results: allResults,
      summary: {
        total: pages.length,
        successful: allResults.filter((r) => r.success).length,
        failed: allResults.filter((r) => !r.success).length,
        totalDuration: Math.round(totalDuration),
        avgPerPage: Math.round(totalDuration / pages.length),
      },
    });
  } catch (error) {
    console.error('Batch processing error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch processing failed' },
      { status: 500 }
    );
  }
}
