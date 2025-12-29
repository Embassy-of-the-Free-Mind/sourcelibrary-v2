import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import sharp from 'sharp';

/**
 * GET /api/books/[id]/check-needs-split
 *
 * Checks if a book contains two-page spreads that need splitting.
 * Samples pages 10 and 15 (or available pages for smaller books).
 *
 * Detection method:
 * 1. Fast aspect ratio check (free)
 *    - < 0.9 = single page (portrait)
 *    - > 1.3 = two-page spread (landscape)
 *    - 0.9-1.3 = ambiguous
 *
 * 2. If ambiguous, optionally use Gemini vision (?useAI=true)
 *
 * Sets book.needs_splitting = true/false/null (null = ambiguous, needs manual review)
 *
 * Query params:
 *   - useAI=true: Use Gemini for ambiguous cases (costs ~$0.001/page)
 *   - dryRun=true: Don't update book, just return detection result
 */

const SAMPLE_PAGES = [10, 15]; // Pages to check
const ASPECT_SINGLE_PAGE = 0.9;  // Below this = definitely single page
const ASPECT_TWO_PAGE = 1.3;     // Above this = definitely two-page spread

interface DetectionResult {
  pageNumber: number;
  aspectRatio: number;
  classification: 'single' | 'spread' | 'ambiguous';
  imageUrl?: string;
  error?: string;
}

async function getImageAspectRatio(imageUrl: string): Promise<{ aspectRatio: number; error?: string }> {
  try {
    // Fetch a small version for speed
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return { aspectRatio: 0, error: `HTTP ${response.status}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(buffer).metadata();

    if (!metadata.width || !metadata.height) {
      return { aspectRatio: 0, error: 'Could not read image dimensions' };
    }

    return { aspectRatio: metadata.width / metadata.height };
  } catch (error) {
    return {
      aspectRatio: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

function classifyAspectRatio(ratio: number): 'single' | 'spread' | 'ambiguous' {
  if (ratio < ASPECT_SINGLE_PAGE) return 'single';
  if (ratio > ASPECT_TWO_PAGE) return 'spread';
  return 'ambiguous';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const { searchParams } = new URL(request.url);
    const useAI = searchParams.get('useAI') === 'true';
    const dryRun = searchParams.get('dryRun') === 'true';

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Check if already has split pages (already processed)
    const existingSplitPages = await db.collection('pages').countDocuments({
      book_id: bookId,
      crop: { $exists: true }
    });

    if (existingSplitPages > 0) {
      return NextResponse.json({
        bookId,
        title: book.title,
        alreadySplit: true,
        splitPagesCount: existingSplitPages,
        needs_splitting: false,
        message: 'Book already has split pages'
      });
    }

    // Get total page count
    const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });

    if (totalPages === 0) {
      return NextResponse.json({
        bookId,
        title: book.title,
        error: 'Book has no pages',
        needs_splitting: null
      });
    }

    // Determine which pages to sample
    const pagesToSample = SAMPLE_PAGES
      .map(n => Math.min(n, totalPages))
      .filter((n, i, arr) => arr.indexOf(n) === i); // Dedupe if book is small

    // Get sample pages
    const samplePages = await db.collection('pages')
      .find({
        book_id: bookId,
        page_number: { $in: pagesToSample }
      })
      .toArray();

    if (samplePages.length === 0) {
      // Fallback: get any 2 pages
      const fallbackPages = await db.collection('pages')
        .find({ book_id: bookId })
        .sort({ page_number: 1 })
        .skip(Math.min(5, totalPages - 1))
        .limit(2)
        .toArray();
      samplePages.push(...fallbackPages);
    }

    // Analyze each sample page
    const results: DetectionResult[] = [];

    for (const page of samplePages) {
      const imageUrl = page.photo_original || page.photo;

      if (!imageUrl) {
        results.push({
          pageNumber: page.page_number,
          aspectRatio: 0,
          classification: 'ambiguous',
          error: 'No image URL'
        });
        continue;
      }

      const { aspectRatio, error } = await getImageAspectRatio(imageUrl);

      if (error) {
        results.push({
          pageNumber: page.page_number,
          aspectRatio: 0,
          classification: 'ambiguous',
          imageUrl,
          error
        });
        continue;
      }

      results.push({
        pageNumber: page.page_number,
        aspectRatio: Math.round(aspectRatio * 100) / 100,
        classification: classifyAspectRatio(aspectRatio),
        imageUrl
      });
    }

    // Determine overall classification
    const validResults = results.filter(r => !r.error);
    const spreadCount = validResults.filter(r => r.classification === 'spread').length;
    const singleCount = validResults.filter(r => r.classification === 'single').length;
    const ambiguousCount = validResults.filter(r => r.classification === 'ambiguous').length;

    let needsSplitting: boolean | null;
    let confidence: 'high' | 'medium' | 'low';
    let reasoning: string;

    if (validResults.length === 0) {
      needsSplitting = null;
      confidence = 'low';
      reasoning = 'Could not analyze any pages';
    } else if (spreadCount === validResults.length) {
      needsSplitting = true;
      confidence = 'high';
      reasoning = `All ${spreadCount} sampled pages are two-page spreads (aspect ratio > ${ASPECT_TWO_PAGE})`;
    } else if (singleCount === validResults.length) {
      needsSplitting = false;
      confidence = 'high';
      reasoning = `All ${singleCount} sampled pages are single pages (aspect ratio < ${ASPECT_SINGLE_PAGE})`;
    } else if (spreadCount > singleCount) {
      needsSplitting = true;
      confidence = ambiguousCount > 0 ? 'medium' : 'high';
      reasoning = `Majority spreads: ${spreadCount} spread, ${singleCount} single, ${ambiguousCount} ambiguous`;
    } else if (singleCount > spreadCount) {
      needsSplitting = false;
      confidence = ambiguousCount > 0 ? 'medium' : 'high';
      reasoning = `Majority single: ${singleCount} single, ${spreadCount} spread, ${ambiguousCount} ambiguous`;
    } else {
      // Tie or all ambiguous
      needsSplitting = null;
      confidence = 'low';
      reasoning = `Inconclusive: ${spreadCount} spread, ${singleCount} single, ${ambiguousCount} ambiguous. Manual review needed.`;

      // TODO: If useAI=true and ambiguous, call Gemini for tiebreaker
      if (useAI && ambiguousCount > 0) {
        reasoning += ' (AI analysis not yet implemented for ambiguous cases)';
      }
    }

    // Update book if not dry run
    if (!dryRun && needsSplitting !== undefined) {
      await db.collection('books').updateOne(
        { id: bookId },
        {
          $set: {
            needs_splitting: needsSplitting,
            split_check: {
              checked_at: new Date(),
              confidence,
              reasoning,
              sample_results: results
            },
            updated_at: new Date()
          }
        }
      );
    }

    return NextResponse.json({
      bookId,
      title: book.title,
      totalPages,
      needs_splitting: needsSplitting,
      confidence,
      reasoning,
      samples: results,
      dryRun,
      updated: !dryRun
    });

  } catch (error) {
    console.error('Error checking if book needs split:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Check failed' },
      { status: 500 }
    );
  }
}
