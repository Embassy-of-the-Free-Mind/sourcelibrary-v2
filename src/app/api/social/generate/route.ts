/**
 * Tweet Generation API
 *
 * POST /api/social/generate
 * Generate tweet variations for a specific gallery image with audience targeting
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import {
  generateTweet,
  generateTweetVariations,
  buildFullTweetText,
  getAvailableAudiences,
  getAvailableVoices,
  TweetAudience,
  TweetVoice,
  TweetVariation,
  TweetModel,
} from '@/lib/tweet-generator';
import { getImageCandidate, buildCropUrl } from '@/lib/social-image-selector';
import { nanoid } from 'nanoid';
import { SocialPost } from '@/lib/types';

/**
 * GET /api/social/generate
 *
 * Returns available audiences, voices, and models for UI
 */
export async function GET() {
  return NextResponse.json({
    audiences: getAvailableAudiences(),
    voices: getAvailableVoices(),
    models: [
      { id: 'gemini', name: 'Gemini 3 Flash', description: 'Fast, good for bulk generation' },
      { id: 'claude', name: 'Claude Sonnet', description: 'Higher quality, better nuance' },
    ],
  });
}

/**
 * POST /api/social/generate
 *
 * Body:
 *   - imageId: string - Gallery image ID (format: "pageId:index")
 *   - audiences: string[] - Target audiences (optional)
 *   - voices: string[] - Voice styles (optional)
 *   - variationCount: number - Number of variations to generate (default: 6)
 *   - saveDraft: boolean - Whether to save as draft (default: false)
 *   - model: 'gemini' | 'claude' - AI model to use (default: 'gemini')
 *   - customPrompt: string - Additional user guidance for generation (optional)
 *
 * Returns generated tweet variations
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      imageId,
      audiences,
      voices,
      variationCount = 6,
      saveDraft = false,
      model = 'gemini',
      customPrompt,
    } = body;

    if (!imageId || typeof imageId !== 'string') {
      return NextResponse.json(
        { error: 'imageId is required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Get image candidate with book context
    const candidate = await getImageCandidate(db, imageId);

    if (!candidate) {
      return NextResponse.json(
        { error: 'Image not found' },
        { status: 404 }
      );
    }

    // Parse audiences and voices
    const validAudiences: TweetAudience[] = (audiences || ['esoteric', 'jungian', 'aesthetic', 'consciousness'])
      .filter((a: string) => ['jungian', 'esoteric', 'arthistory', 'philosophy', 'consciousness', 'aesthetic', 'general'].includes(a));

    const validVoices: TweetVoice[] = (voices || ['scholarly', 'provocative', 'aesthetic', 'mysterious'])
      .filter((v: string) => ['scholarly', 'provocative', 'aesthetic', 'mysterious', 'contextual'].includes(v));

    // Validate model
    const validModel: TweetModel = ['gemini', 'claude'].includes(model) ? model : 'gemini';

    // Generate variations using AI
    const variations = await generateTweetVariations({
      description: candidate.description,
      museumDescription: candidate.museumDescription,
      type: candidate.type,
      bookTitle: candidate.bookTitle,
      author: candidate.bookAuthor,
      year: candidate.bookYear,
      metadata: candidate.metadata,
      audiences: validAudiences,
      voices: validVoices,
      variationCount: Math.min(variationCount, 8),
      model: validModel,
      customPrompt: customPrompt || undefined,
    });

    // Build cropped image URL
    const croppedUrl = buildCropUrl(candidate, 'https://sourcelibrary.org');

    // Enrich variations with full tweet text
    const enrichedVariations = variations.map(v => ({
      ...v,
      fullTweet: buildFullTweetText(v.tweet, v.hashtags, imageId),
      charCount: v.tweet.length,
    }));

    const response: {
      variations: Array<TweetVariation & { fullTweet: string; charCount: number }>;
      image: typeof candidate;
      croppedUrl: string;
      post?: SocialPost;
      // Backward compatibility
      tweet: string;
      fullTweet: string;
      hashtags: string[];
      hookType: string;
      alternatives: string[];
    } = {
      variations: enrichedVariations,
      image: candidate,
      croppedUrl,
      // Backward compatibility - use first variation
      tweet: variations[0]?.tweet || '',
      fullTweet: enrichedVariations[0]?.fullTweet || '',
      hashtags: variations[0]?.hashtags || [],
      hookType: variations[0]?.voice || 'mysterious',
      alternatives: variations.slice(1).map(v => v.tweet),
    };

    // Optionally save first variation as draft
    if (saveDraft && variations.length > 0) {
      const firstVariation = variations[0];
      const post: Omit<SocialPost, '_id'> = {
        id: nanoid(12),
        tweet_text: firstVariation.tweet,
        hashtags: firstVariation.hashtags,

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

        status: 'draft',

        generated_by: {
          model: validModel === 'claude' ? 'claude-sonnet-4' : 'gemini-3-flash-preview',
          generated_at: new Date(),
          alternatives: variations.slice(1).map(v => v.tweet),
        },

        created_at: new Date(),
        updated_at: new Date(),
      };

      await db.collection('social_posts').insertOne(post);
      response.post = post as SocialPost;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error generating tweet:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate tweet' },
      { status: 500 }
    );
  }
}
