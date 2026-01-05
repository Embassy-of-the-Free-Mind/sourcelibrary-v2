/**
 * Social Media Image Candidates API
 *
 * GET /api/social/candidates
 * Get top shareable images for social media
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { selectImagesForPosts, buildCropUrl } from '@/lib/social-image-selector';

/**
 * GET /api/social/candidates
 *
 * Query params:
 *   - count: number - How many candidates (default: 10, max: 50)
 *   - minQuality: number - Minimum gallery quality (default: 0.7)
 *   - diversify: boolean - Max 1 per book (default: true)
 *   - excludeRecent: boolean - Exclude recently posted (default: true)
 *   - recentDays: number - Days to look back (default: 30)
 *
 * Returns array of image candidates with shareability scores
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const count = Math.min(parseInt(searchParams.get('count') || '10'), 50);
    const minQuality = parseFloat(searchParams.get('minQuality') || '0.7');
    const diversify = searchParams.get('diversify') !== 'false';
    const excludeRecent = searchParams.get('excludeRecent') !== 'false';
    const recentDays = parseInt(searchParams.get('recentDays') || '30');

    const db = await getDb();

    const candidates = await selectImagesForPosts(db, count, {
      minGalleryQuality: minQuality,
      excludeRecentlyPosted: excludeRecent,
      recentDays,
      diversifyBooks: diversify,
      preferRichMetadata: true,
    });

    // Enhance with cropped URLs
    const enhanced = candidates.map(candidate => ({
      ...candidate,
      croppedUrl: buildCropUrl(candidate, 'https://sourcelibrary.org'),
      galleryUrl: `https://sourcelibrary.org/gallery/image/${candidate.galleryImageId}`,
    }));

    return NextResponse.json({
      candidates: enhanced,
      count: enhanced.length,
      criteria: {
        minQuality,
        diversify,
        excludeRecent,
        recentDays,
      },
    });
  } catch (error) {
    console.error('Error getting candidates:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get candidates' },
      { status: 500 }
    );
  }
}
