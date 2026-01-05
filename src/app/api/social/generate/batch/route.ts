/**
 * Batch Tweet Generation API
 *
 * POST /api/social/generate/batch
 * Generate tweets for multiple top images
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { generateTweet, buildFullTweetText } from '@/lib/tweet-generator';
import { selectImagesForPosts, buildCropUrl, SocialImageCandidate } from '@/lib/social-image-selector';
import { nanoid } from 'nanoid';
import { SocialPost } from '@/lib/types';

interface GeneratedPost {
  tweet: string;
  fullTweet: string;
  hashtags: string[];
  hookType: string;
  alternatives: string[];
  image: SocialImageCandidate;
  croppedUrl: string;
  post?: SocialPost;
  error?: string;
}

/**
 * POST /api/social/generate/batch
 *
 * Body:
 *   - count: number - How many tweets to generate (default: 5, max: 10)
 *   - minQuality: number - Minimum gallery quality (default: 0.75)
 *   - saveDrafts: boolean - Save all as drafts (default: false)
 *   - diversifyBooks: boolean - Max 1 image per book (default: true)
 *
 * Returns array of generated tweets
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      count = 5,
      minQuality = 0.75,
      saveDrafts = false,
      diversifyBooks = true,
    } = body;

    // Validate count
    const safeCount = Math.max(1, Math.min(10, count));

    const db = await getDb();

    // Select top shareable images
    const candidates = await selectImagesForPosts(db, safeCount, {
      minGalleryQuality: minQuality,
      excludeRecentlyPosted: true,
      recentDays: 30,
      diversifyBooks,
      preferRichMetadata: true,
    });

    if (candidates.length === 0) {
      return NextResponse.json({
        generated: [],
        message: 'No eligible images found. Try lowering minQuality or check if images have been posted recently.',
      });
    }

    // Generate tweets for each candidate
    const generated: GeneratedPost[] = [];

    for (const candidate of candidates) {
      try {
        const result = await generateTweet({
          description: candidate.description,
          museumDescription: candidate.museumDescription,
          type: candidate.type,
          bookTitle: candidate.bookTitle,
          author: candidate.bookAuthor,
          year: candidate.bookYear,
          metadata: candidate.metadata,
        });

        const fullTweet = buildFullTweetText(
          result.tweet,
          result.hashtags,
          candidate.galleryImageId
        );

        const croppedUrl = buildCropUrl(candidate, 'https://sourcelibrary.org');

        const genPost: GeneratedPost = {
          tweet: result.tweet,
          fullTweet,
          hashtags: result.hashtags,
          hookType: result.hookType,
          alternatives: result.alternatives,
          image: candidate,
          croppedUrl,
        };

        // Optionally save as draft
        if (saveDrafts) {
          const post: Omit<SocialPost, '_id'> = {
            id: nanoid(12),
            tweet_text: result.tweet,
            hashtags: result.hashtags,

            image_ref: {
              page_id: candidate.pageId,
              detection_index: candidate.detectionIndex,
              gallery_image_id: candidate.galleryImageId,
            },

            image_data: {
              cropped_url: croppedUrl,
              description: candidate.description,
              book_title: candidate.bookTitle,
              book_author: candidate.bookAuthor,
              book_year: candidate.bookYear,
            },

            status: 'draft',

            generated_by: {
              model: 'gemini-3-flash-preview',
              generated_at: new Date(),
              alternatives: result.alternatives,
            },

            created_at: new Date(),
            updated_at: new Date(),
          };

          await db.collection('social_posts').insertOne(post);
          genPost.post = post as SocialPost;
        }

        generated.push(genPost);
      } catch (error) {
        console.error(`Error generating tweet for ${candidate.galleryImageId}:`, error);
        generated.push({
          tweet: '',
          fullTweet: '',
          hashtags: [],
          hookType: 'mystery',
          alternatives: [],
          image: candidate,
          croppedUrl: buildCropUrl(candidate, 'https://sourcelibrary.org'),
          error: error instanceof Error ? error.message : 'Generation failed',
        });
      }
    }

    return NextResponse.json({
      generated,
      count: generated.filter(g => !g.error).length,
      errors: generated.filter(g => g.error).length,
    });
  } catch (error) {
    console.error('Error in batch generation:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch generation failed' },
      { status: 500 }
    );
  }
}
