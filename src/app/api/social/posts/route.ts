/**
 * Social Posts API
 *
 * GET /api/social/posts - List posts with filters
 * POST /api/social/posts - Create a new post
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { nanoid } from 'nanoid';
import { SocialPost, SocialPostStatus } from '@/lib/types';
import { buildFullTweetText } from '@/lib/tweet-generator';
import { buildCropUrl, getImageCandidate } from '@/lib/social-image-selector';

/**
 * GET /api/social/posts
 *
 * Query params:
 *   - status: filter by status (draft, queued, posted, failed)
 *   - limit: number of posts (default: 50, max: 200)
 *   - offset: pagination offset
 *   - sort: 'created' | 'scheduled' | 'posted' (default: created)
 *   - order: 'asc' | 'desc' (default: desc)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') as SocialPostStatus | null;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const sortField = searchParams.get('sort') || 'created';
    const sortOrder = searchParams.get('order') === 'asc' ? 1 : -1;

    const db = await getDb();

    // Build query
    const query: Record<string, unknown> = {};
    if (status) {
      query.status = status;
    }

    // Build sort
    const sortMap: Record<string, string> = {
      created: 'created_at',
      scheduled: 'scheduled_for',
      posted: 'posted_at',
    };
    const sortFieldName = sortMap[sortField] || 'created_at';

    // Get posts
    const [posts, total] = await Promise.all([
      db.collection('social_posts')
        .find(query)
        .sort([[sortFieldName, sortOrder]])
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('social_posts').countDocuments(query),
    ]);

    return NextResponse.json({
      posts,
      total,
      limit,
      offset,
      hasMore: offset + posts.length < total,
    });
  } catch (error) {
    console.error('Error getting posts:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get posts' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/social/posts
 *
 * Body:
 *   - imageId: string - Gallery image ID (required)
 *   - tweet_text: string - Tweet text (optional, will generate if not provided)
 *   - hashtags: string[] - Hashtags (optional)
 *   - status: 'draft' | 'queued' (default: draft)
 *   - scheduled_for: Date string (optional)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      imageId,
      tweet_text,
      hashtags = [],
      status = 'draft',
      scheduled_for,
    } = body;

    if (!imageId) {
      return NextResponse.json(
        { error: 'imageId is required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Get image data
    const candidate = await getImageCandidate(db, imageId);

    if (!candidate) {
      return NextResponse.json(
        { error: 'Image not found' },
        { status: 404 }
      );
    }

    const croppedUrl = buildCropUrl(candidate, 'https://sourcelibrary.org');

    // Validate tweet text if provided
    if (tweet_text) {
      const fullTweet = buildFullTweetText(tweet_text, hashtags, imageId);
      if (fullTweet.length > 280) {
        return NextResponse.json(
          { error: `Tweet too long (${fullTweet.length}/280 chars)` },
          { status: 400 }
        );
      }
    }

    const post: Omit<SocialPost, '_id'> = {
      id: nanoid(12),
      tweet_text: tweet_text || '',
      hashtags,

      image_ref: {
        page_id: candidate.pageId,
        detection_index: candidate.detectionIndex,
        gallery_image_id: imageId,
      },

      image_data: {
        cropped_url: croppedUrl,
        description: candidate.description,
        book_title: candidate.bookTitle,
        book_author: candidate.bookAuthor,
        book_year: candidate.bookYear,
      },

      status: status === 'queued' ? 'queued' : 'draft',
      scheduled_for: scheduled_for ? new Date(scheduled_for) : undefined,

      generated_by: {
        model: 'manual',
        generated_at: new Date(),
        alternatives: [],
      },

      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.collection('social_posts').insertOne(post);

    return NextResponse.json({
      success: true,
      post,
    });
  } catch (error) {
    console.error('Error creating post:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create post' },
      { status: 500 }
    );
  }
}
