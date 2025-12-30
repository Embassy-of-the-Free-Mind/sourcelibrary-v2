import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { extractFeatures, trainModel, type TrainingExample, type SplitModel } from '@/lib/splitDetectionML';

/**
 * POST - Auto-update the ML model after user splits
 * Called automatically after batch splits are applied
 *
 * 1. Imports new user splits as training examples
 * 2. Retrains the model if we have enough examples
 */

interface PageWithCrop {
  id: string;
  book_id: string;
  page_number: number;
  photo_original: string;
  crop?: {
    xStart: number;
    xEnd: number;
  };
}

// Cache for book page counts
const bookPageCounts = new Map<string, number>();

async function getBookPageCount(db: Awaited<ReturnType<typeof getDb>>, bookId: string): Promise<number> {
  if (bookPageCounts.has(bookId)) {
    return bookPageCounts.get(bookId)!;
  }
  const count = await db.collection('pages').countDocuments({ book_id: bookId });
  bookPageCounts.set(bookId, count);
  return count;
}

export async function POST(request: NextRequest) {
  try {
    const { pageIds, bookId, autoRetrain = true, minExamplesForRetrain = 20 } = await request.json();
    const db = await getDb();

    // Find left pages from the provided pageIds that have valid crop data
    const query: Record<string, unknown> = {
      photo_original: { $exists: true, $ne: null },
      'crop.xStart': 0,
      'crop.xEnd': { $gt: 100, $lt: 900 },
    };

    if (pageIds && pageIds.length > 0) {
      query.id = { $in: pageIds };
    } else if (bookId) {
      query.book_id = bookId;
    }

    // Get pages that haven't been imported yet
    const alreadyImportedIds = await db.collection('split_training_examples')
      .find({ source: 'user_split' })
      .project({ pageId: 1 })
      .toArray();
    const importedSet = new Set(alreadyImportedIds.map(d => d.pageId));

    const leftPages = await db.collection('pages')
      .find(query)
      .toArray() as unknown as PageWithCrop[];

    const toImport = leftPages.filter(p => !importedSet.has(p.id));

    let imported = 0;
    let errors = 0;

    for (const page of toImport) {
      try {
        const splitPosition = page.crop?.xEnd;
        if (!splitPosition) {
          errors++;
          continue;
        }

        // Fetch image and extract features
        let imageUrl = page.photo_original;
        if (imageUrl.includes('archive.org') && imageUrl.includes('pct:50')) {
          imageUrl = imageUrl.replace('pct:50', 'pct:25');
        }

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          errors++;
          continue;
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const features = await extractFeatures(imageBuffer);

        // Add page context features
        const totalPages = await getBookPageCount(db, page.book_id);
        features.pageNumber = page.page_number;
        features.totalPages = totalPages;
        features.pagePosition = totalPages > 0 ? page.page_number / totalPages : 0.5;
        features.bookSizeCategory = totalPages < 100 ? 0 : totalPages < 300 ? 1 : 2;

        // Store training example
        await db.collection('split_training_examples').insertOne({
          pageId: page.id,
          bookId: page.book_id,
          imageUrl: page.photo_original,
          features,
          geminiPosition: splitPosition,
          geminiConfidence: 'user',
          source: 'user_split',
          timestamp: new Date(),
        });

        // Mark page as labeled
        await db.collection('pages').updateOne(
          { id: page.id },
          {
            $set: {
              ml_split_label: {
                position: splitPosition,
                confidence: 'user',
                source: 'user_split',
                labeled_at: new Date(),
              }
            }
          }
        );

        imported++;
      } catch (error) {
        console.error(`[Auto-update] Error importing page ${page.id}:`, error);
        errors++;
      }
    }

    // Check if we should retrain
    let retrainResult: { success: boolean; validationRMSE?: number; trainingSize?: number } | null = null;

    if (autoRetrain && imported > 0) {
      const totalExamples = await db.collection('split_training_examples').countDocuments();

      if (totalExamples >= minExamplesForRetrain) {
        try {
          // Get all training examples
          const examples = await db.collection('split_training_examples')
            .find({})
            .toArray() as unknown as TrainingExample[];

          // Train the model
          const model = trainModel(examples);

          // Deactivate existing models
          await db.collection('split_models').updateMany(
            {},
            { $set: { isActive: false } }
          );

          // Save new model
          const version = Date.now();
          await db.collection('split_models').insertOne({
            ...model,
            version,
            isActive: true,
          });

          retrainResult = {
            success: true,
            validationRMSE: Math.round(Math.sqrt(model.validationMSE) * 100) / 100,
            trainingSize: model.trainingSize,
          };

          console.log(`[Auto-update] Model retrained: ${model.trainingSize} examples, RMSE=${Math.sqrt(model.validationMSE).toFixed(2)}`);
        } catch (error) {
          console.error('[Auto-update] Retrain failed:', error);
          retrainResult = { success: false };
        }
      }
    }

    const totalExamples = await db.collection('split_training_examples').countDocuments();
    const userExamples = await db.collection('split_training_examples')
      .countDocuments({ source: 'user_split' });

    console.log(`[Auto-update] Imported ${imported} examples (${errors} errors). Total: ${totalExamples}`);

    return NextResponse.json({
      imported,
      errors,
      total: {
        allExamples: totalExamples,
        userSplits: userExamples,
      },
      retrain: retrainResult,
    });
  } catch (error) {
    console.error('[Auto-update] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Auto-update failed' },
      { status: 500 }
    );
  }
}

/**
 * GET - Check auto-update status and recommendations
 */
export async function GET() {
  try {
    const db = await getDb();

    // Get current model
    const activeModel = await db.collection('split_models')
      .findOne({ isActive: true }) as unknown as (SplitModel & { version: number }) | null;

    // Get training example counts
    const totalExamples = await db.collection('split_training_examples').countDocuments();
    const userExamples = await db.collection('split_training_examples')
      .countDocuments({ source: 'user_split' });

    // Get pending imports (pages with crops not yet imported)
    const importedIds = await db.collection('split_training_examples')
      .find({ source: 'user_split' })
      .project({ pageId: 1 })
      .toArray();
    const importedSet = new Set(importedIds.map(d => d.pageId));

    const pendingPages = await db.collection('pages')
      .find({
        photo_original: { $exists: true, $ne: null },
        'crop.xStart': 0,
        'crop.xEnd': { $gt: 100, $lt: 900 },
      })
      .project({ id: 1 })
      .toArray();

    const pendingCount = pendingPages.filter(p => !importedSet.has(p.id)).length;

    return NextResponse.json({
      hasActiveModel: !!activeModel,
      modelInfo: activeModel ? {
        trainedAt: activeModel.trainedAt,
        trainingSize: activeModel.trainingSize,
        validationRMSE: Math.round(Math.sqrt(activeModel.validationMSE) * 100) / 100,
      } : null,
      examples: {
        total: totalExamples,
        userSplits: userExamples,
        geminiLabeled: totalExamples - userExamples,
      },
      pendingImports: pendingCount,
      recommendation: pendingCount > 0
        ? `${pendingCount} user splits ready to import. Call POST to update model.`
        : totalExamples < 20
        ? `Need more examples (have ${totalExamples}, recommend 20+)`
        : 'Model is up to date',
    });
  } catch (error) {
    console.error('[Auto-update] GET Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    );
  }
}
