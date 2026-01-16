import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { detectSplitWithGemini, extractFeatures } from '@/lib/page-split/splitDetectionML';

/**
 * POST - Generate ground truth labels for pages using Gemini
 *
 * Request body:
 * {
 *   pageIds: string[],  // Page IDs to label
 *   bookId?: string,    // Or label all pages from a book
 *   limit?: number      // Max pages to process (default 50)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { pageIds, bookId, limit = 50 } = await request.json();
    const db = await getDb();

    // Get pages to label
    let pages;
    if (pageIds && pageIds.length > 0) {
      pages = await db.collection('pages')
        .find({ id: { $in: pageIds } })
        .limit(limit)
        .toArray();
    } else if (bookId) {
      // Get pages that don't have ML labels yet
      pages = await db.collection('pages')
        .find({
          book_id: bookId,
          photo: { $exists: true },
          'ml_split_label': { $exists: false }
        })
        .limit(limit)
        .toArray();
    } else {
      return NextResponse.json(
        { error: 'Must provide pageIds or bookId' },
        { status: 400 }
      );
    }

    const results = [];
    const errors = [];

    for (const page of pages) {
      if (!page.photo) {
        errors.push({ pageId: page.id, error: 'No photo URL' });
        continue;
      }

      try {
        // Get Gemini's prediction
        const geminiResult = await detectSplitWithGemini(page.photo);

        // Fetch image and extract features
        const imageResponse = await fetch(page.photo);
        if (!imageResponse.ok) {
          errors.push({ pageId: page.id, error: 'Failed to fetch image' });
          continue;
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const features = await extractFeatures(imageBuffer);

        // Store the training example
        const trainingExample = {
          pageId: page.id,
          bookId: page.book_id,
          imageUrl: page.photo,
          features,
          geminiPosition: geminiResult.splitPosition,
          geminiConfidence: geminiResult.confidence,
          geminiReasoning: geminiResult.reasoning,
          timestamp: new Date(),
        };

        // Save to training_examples collection
        await db.collection('split_training_examples').insertOne(trainingExample);

        // Also mark the page as labeled
        await db.collection('pages').updateOne(
          { id: page.id },
          {
            $set: {
              ml_split_label: {
                position: geminiResult.splitPosition,
                confidence: geminiResult.confidence,
                labeled_at: new Date(),
              }
            }
          }
        );

        results.push({
          pageId: page.id,
          position: geminiResult.splitPosition,
          confidence: geminiResult.confidence,
          reasoning: geminiResult.reasoning,
        });

      } catch (error) {
        errors.push({
          pageId: page.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return NextResponse.json({
      labeled: results.length,
      errorCount: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error('Error labeling pages:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to label pages' },
      { status: 500 }
    );
  }
}

/**
 * GET - Get labeling status for a book
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('bookId');

    if (!bookId) {
      return NextResponse.json({ error: 'bookId required' }, { status: 400 });
    }

    const db = await getDb();

    const totalPages = await db.collection('pages').countDocuments({
      book_id: bookId,
      photo: { $exists: true }
    });

    const labeledPages = await db.collection('pages').countDocuments({
      book_id: bookId,
      'ml_split_label': { $exists: true }
    });

    const examples = await db.collection('split_training_examples')
      .find({ bookId })
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();

    return NextResponse.json({
      bookId,
      totalPages,
      labeledPages,
      progress: totalPages > 0 ? Math.round((labeledPages / totalPages) * 100) : 0,
      recentExamples: examples.map(e => ({
        pageId: e.pageId,
        position: e.geminiPosition,
        confidence: e.geminiConfidence,
        timestamp: e.timestamp,
      })),
    });

  } catch (error) {
    console.error('Error getting label status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    );
  }
}
