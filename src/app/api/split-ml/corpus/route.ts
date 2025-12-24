import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { detectSplitWithGemini, extractFeatures } from '@/lib/splitDetectionML';

/**
 * Corpus collection for ML training - samples pages across all books
 *
 * GET - Get corpus status and stats
 * POST - Collect more training samples
 */

export async function GET() {
  try {
    const db = await getDb();

    // Get all books with splittable pages
    const booksWithSplittablePages = await db.collection('books').aggregate([
      {
        $lookup: {
          from: 'pages',
          localField: 'id',
          foreignField: 'book_id',
          as: 'pages'
        }
      },
      {
        $project: {
          id: 1,
          title: 1,
          totalPages: { $size: '$pages' },
          splittablePages: {
            $size: {
              $filter: {
                input: '$pages',
                as: 'p',
                cond: {
                  $and: [
                    { $ifNull: ['$$p.photo_original', false] },
                    { $not: { $ifNull: ['$$p.ml_split_label', false] } }
                  ]
                }
              }
            }
          },
          labeledPages: {
            $size: {
              $filter: {
                input: '$pages',
                as: 'p',
                cond: { $ifNull: ['$$p.ml_split_label', false] }
              }
            }
          }
        }
      },
      { $match: { splittablePages: { $gt: 0 } } },
      { $sort: { splittablePages: -1 } }
    ]).toArray();

    // Get training examples stats
    const trainingStats = await db.collection('split_training_examples').aggregate([
      {
        $group: {
          _id: '$bookId',
          count: { $sum: 1 },
          avgConfidence: {
            $avg: {
              $switch: {
                branches: [
                  { case: { $eq: ['$geminiConfidence', 'high'] }, then: 3 },
                  { case: { $eq: ['$geminiConfidence', 'medium'] }, then: 2 },
                  { case: { $eq: ['$geminiConfidence', 'low'] }, then: 1 }
                ],
                default: 2
              }
            }
          }
        }
      }
    ]).toArray();

    const totalExamples = await db.collection('split_training_examples').countDocuments();
    const totalBooks = trainingStats.length;

    // Confidence distribution
    const confidenceDist = await db.collection('split_training_examples').aggregate([
      { $group: { _id: '$geminiConfidence', count: { $sum: 1 } } }
    ]).toArray();

    return NextResponse.json({
      corpus: {
        totalExamples,
        totalBooksWithData: totalBooks,
        booksAvailable: booksWithSplittablePages.length,
        confidenceDistribution: confidenceDist.reduce((acc, c) => {
          acc[c._id || 'unknown'] = c.count;
          return acc;
        }, {} as Record<string, number>),
      },
      books: booksWithSplittablePages.slice(0, 20).map(b => ({
        id: b.id,
        title: b.title,
        unlabeled: b.splittablePages,
        labeled: b.labeledPages,
      })),
      trainingReady: totalExamples >= 10,
      recommendedAction: totalExamples < 50
        ? `Collect more samples. Have ${totalExamples}, recommend 50+ for good model.`
        : totalExamples < 100
        ? `Good corpus size (${totalExamples}). Consider adding more diversity.`
        : `Excellent corpus (${totalExamples} examples). Ready for training.`,
    });
  } catch (error) {
    console.error('Error getting corpus status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get corpus status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const {
      samplesPerBook = 3,
      maxBooks = 10,
      targetTotal = 50,
      bookIds, // Optional: specific books to sample from
    } = await request.json().catch(() => ({}));

    const db = await getDb();

    // Get current count
    const currentCount = await db.collection('split_training_examples').countDocuments();
    const needed = Math.max(0, targetTotal - currentCount);

    if (needed === 0) {
      return NextResponse.json({
        message: `Already have ${currentCount} examples, target is ${targetTotal}`,
        collected: 0,
        total: currentCount,
      });
    }

    // Find books with unlabeled splittable pages
    let bookQuery: Record<string, unknown> = {};
    if (bookIds && bookIds.length > 0) {
      bookQuery = { id: { $in: bookIds } };
    }

    const books = await db.collection('books')
      .find(bookQuery)
      .limit(maxBooks)
      .toArray();

    const results: Array<{
      bookId: string;
      bookTitle: string;
      sampled: number;
      errors: number;
    }> = [];

    let totalCollected = 0;

    for (const book of books) {
      if (totalCollected >= needed) break;

      // Get unlabeled splittable pages from this book
      const unlabeledPages = await db.collection('pages')
        .find({
          book_id: book.id,
          photo_original: { $exists: true },
          'ml_split_label': { $exists: false },
        })
        .limit(samplesPerBook)
        .toArray();

      let bookSampled = 0;
      let bookErrors = 0;

      for (const page of unlabeledPages) {
        if (totalCollected >= needed) break;

        try {
          // Use original (unsplit) image for training
          const imageUrl = page.photo_original || page.photo;

          // Get Gemini ground truth
          const geminiResult = await detectSplitWithGemini(imageUrl);

          // Extract features
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) {
            bookErrors++;
            continue;
          }

          const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
          const features = await extractFeatures(imageBuffer);

          // Store training example
          const trainingExample = {
            pageId: page.id,
            bookId: book.id,
            bookTitle: book.title,
            imageUrl,
            features,
            geminiPosition: geminiResult.splitPosition,
            geminiConfidence: geminiResult.confidence,
            geminiReasoning: geminiResult.reasoning,
            timestamp: new Date(),
          };

          await db.collection('split_training_examples').insertOne(trainingExample);

          // Mark page as labeled
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

          bookSampled++;
          totalCollected++;
        } catch (error) {
          console.error(`Error labeling page ${page.id}:`, error);
          bookErrors++;
        }
      }

      if (bookSampled > 0 || bookErrors > 0) {
        results.push({
          bookId: book.id,
          bookTitle: book.title || 'Untitled',
          sampled: bookSampled,
          errors: bookErrors,
        });
      }
    }

    const newTotal = await db.collection('split_training_examples').countDocuments();

    return NextResponse.json({
      collected: totalCollected,
      total: newTotal,
      targetReached: newTotal >= targetTotal,
      results,
      nextStep: newTotal >= 10
        ? 'Ready to train! POST to /api/split-ml/train'
        : `Need ${10 - newTotal} more examples before training`,
    });
  } catch (error) {
    console.error('Error collecting corpus:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to collect corpus' },
      { status: 500 }
    );
  }
}
