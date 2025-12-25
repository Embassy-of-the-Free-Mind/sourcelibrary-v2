import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { extractFeatures } from '@/lib/splitDetectionML';

/**
 * Import existing user splits as training data
 * User splits are higher quality ground truth than Gemini
 *
 * GET - Check how many user splits are available
 * POST - Import user splits as training examples
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

export async function GET() {
  try {
    const db = await getDb();

    // Find all pages that have been split (have crop data and photo_original)
    // Left pages have xStart=0, right pages have xEnd=1000
    // We want left pages to get the split position from xEnd
    const leftPages = await db.collection('pages').aggregate([
      {
        $match: {
          photo_original: { $exists: true, $ne: null },
          'crop.xStart': 0,
          'crop.xEnd': { $gt: 100, $lt: 900 }, // Valid split range
        }
      },
      {
        $group: {
          _id: '$book_id',
          count: { $sum: 1 },
          pages: { $push: { id: '$id', xEnd: '$crop.xEnd' } }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    // Count already imported
    const alreadyImported = await db.collection('split_training_examples')
      .countDocuments({ source: 'user_split' });

    const totalAvailable = leftPages.reduce((sum, b) => sum + b.count, 0);

    return NextResponse.json({
      available: totalAvailable,
      alreadyImported,
      byBook: leftPages.map(b => ({
        bookId: b._id,
        count: b.count,
        sampleSplits: b.pages.slice(0, 3).map((p: { id: string; xEnd: number }) => p.xEnd),
      })),
    });
  } catch (error) {
    console.error('Error checking user splits:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { limit = 100, bookIds, clearAndReimport = false } = await request.json().catch(() => ({}));
    const db = await getDb();

    // If clearAndReimport is true, delete all existing training examples first
    if (clearAndReimport) {
      await db.collection('split_training_examples').deleteMany({});
      await db.collection('pages').updateMany(
        { ml_split_label: { $exists: true } },
        { $unset: { ml_split_label: '' } }
      );
      // Clear the cache
      bookPageCounts.clear();
    }

    // Build query for left pages (xStart=0)
    const query: Record<string, unknown> = {
      photo_original: { $exists: true, $ne: null },
      'crop.xStart': 0,
      'crop.xEnd': { $gt: 100, $lt: 900 },
    };

    if (bookIds && bookIds.length > 0) {
      query.book_id = { $in: bookIds };
    }

    // Get left pages that haven't been imported yet
    const alreadyImportedIds = await db.collection('split_training_examples')
      .find({ source: 'user_split' })
      .project({ pageId: 1 })
      .toArray();
    const importedSet = new Set(alreadyImportedIds.map(d => d.pageId));

    const leftPages = await db.collection('pages')
      .find(query)
      .limit(limit * 2) // Get extra since some may be already imported
      .toArray() as unknown as PageWithCrop[];

    const toImport = leftPages.filter(p => !importedSet.has(p.id)).slice(0, limit);

    let imported = 0;
    let errors = 0;
    const results: Array<{ bookId: string; imported: number; errors: number }> = [];
    const bookResults = new Map<string, { imported: number; errors: number }>();

    for (const page of toImport) {
      try {
        const splitPosition = page.crop?.xEnd;
        if (!splitPosition) {
          errors++;
          continue;
        }

        // Fetch image and extract features
        const imageResponse = await fetch(page.photo_original);
        if (!imageResponse.ok) {
          errors++;
          const br = bookResults.get(page.book_id) || { imported: 0, errors: 0 };
          br.errors++;
          bookResults.set(page.book_id, br);
          continue;
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const features = await extractFeatures(imageBuffer);

        // Add page context features
        const totalPages = await getBookPageCount(db, page.book_id);
        features.pageNumber = page.page_number;
        features.totalPages = totalPages;
        features.pagePosition = totalPages > 0 ? page.page_number / totalPages : 0.5;

        // Book size category: 0=small (<100), 1=medium (100-300), 2=large (300+)
        features.bookSizeCategory = totalPages < 100 ? 0 : totalPages < 300 ? 1 : 2;

        // Store training example with user source
        await db.collection('split_training_examples').insertOne({
          pageId: page.id,
          bookId: page.book_id,
          imageUrl: page.photo_original,
          features,
          geminiPosition: splitPosition, // Using same field name for compatibility
          geminiConfidence: 'user', // Mark as user-provided
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
        const br = bookResults.get(page.book_id) || { imported: 0, errors: 0 };
        br.imported++;
        bookResults.set(page.book_id, br);

      } catch (error) {
        console.error(`Error importing page ${page.id}:`, error);
        errors++;
        const br = bookResults.get(page.book_id) || { imported: 0, errors: 0 };
        br.errors++;
        bookResults.set(page.book_id, br);
      }
    }

    for (const [bookId, counts] of bookResults) {
      results.push({ bookId, ...counts });
    }

    const totalExamples = await db.collection('split_training_examples').countDocuments();
    const userExamples = await db.collection('split_training_examples')
      .countDocuments({ source: 'user_split' });

    return NextResponse.json({
      imported,
      errors,
      results,
      total: {
        allExamples: totalExamples,
        userSplits: userExamples,
        geminiLabeled: totalExamples - userExamples,
      },
      nextStep: totalExamples >= 50
        ? 'Good dataset size! Retrain with POST /api/split-ml/train'
        : `Need more data. Have ${totalExamples}, recommend 50+`,
    });
  } catch (error) {
    console.error('Error importing user splits:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    );
  }
}
