/**
 * Tweet Generation API
 *
 * POST /api/social/generate
 * Generate tweet variations for a specific gallery image with audience targeting
 */

import { NextRequest, NextResponse } from 'next/server';
import { Db } from 'mongodb';
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
  TweetGenerationInput,
} from '@/lib/tweet-generator';
import { getImageCandidate, buildCropUrl, SocialImageCandidate } from '@/lib/social-image-selector';
import { nanoid } from 'nanoid';
import { SocialPost } from '@/lib/types';

/**
 * Fetch research context for a candidate image: page translations + book summaries.
 * Returns undefined fields gracefully when data doesn't exist.
 */
async function fetchResearchContext(
  db: Db,
  candidate: SocialImageCandidate
): Promise<TweetGenerationInput['researchContext']> {
  const bookId = candidate.bookId;
  const pageNumber = candidate.pageNumber;

  // Run page + book queries in parallel
  const [pageResults, bookDoc] = await Promise.all([
    // Fetch translation for this page and the next page
    db.collection('pages')
      .find(
        {
          book_id: bookId,
          page_number: { $in: [pageNumber, pageNumber + 1] },
        },
        {
          projection: {
            page_number: 1,
            'translation.data': 1,
          },
        }
      )
      .toArray(),

    // Fetch book-level context (books use string `id` field, not ObjectId `_id`)
    db.collection('books')
      .findOne(
        { id: bookId },
        {
          projection: {
            'reading_summary.overview': 1,
            'reading_summary.themes': 1,
            'reading_summary.quotes': 1,
            'index.bookSummary.brief': 1,
            'index.sectionSummaries': 1,
          },
        }
      ),
  ]);

  const context: TweetGenerationInput['researchContext'] = {};

  // Page translation
  const currentPage = pageResults.find((p) => p.page_number === pageNumber);
  const nextPage = pageResults.find((p) => p.page_number === pageNumber + 1);

  if (currentPage?.translation?.data) {
    context.pageTranslation = currentPage.translation.data.slice(0, 800);
  }
  if (nextPage?.translation?.data) {
    context.adjacentTranslation = nextPage.translation.data.slice(0, 400);
  }

  // Book overview
  if (bookDoc?.reading_summary?.overview) {
    context.bookOverview = bookDoc.reading_summary.overview.slice(0, 500);
  } else if (bookDoc?.index?.bookSummary?.brief) {
    context.bookOverview = bookDoc.index.bookSummary.brief.slice(0, 500);
  }

  // Themes
  if (bookDoc?.reading_summary?.themes?.length) {
    context.bookThemes = bookDoc.reading_summary.themes;
  }

  // Quotes near this page (within 5 pages)
  if (bookDoc?.reading_summary?.quotes?.length) {
    const nearbyQuotes = bookDoc.reading_summary.quotes
      .filter((q: { page?: number }) => q.page && Math.abs(q.page - pageNumber) <= 5)
      .slice(0, 3)
      .map((q: { text: string; page: number }) => ({ text: q.text, page: q.page }));
    if (nearbyQuotes.length > 0) {
      context.bookQuotes = nearbyQuotes;
    }
  }

  // Section summary — find the section this page belongs to
  if (bookDoc?.index?.sectionSummaries?.length) {
    const section = bookDoc.index.sectionSummaries.find(
      (s: { startPage?: number; endPage?: number }) =>
        s.startPage && s.endPage && pageNumber >= s.startPage && pageNumber <= s.endPage
    );
    if (section) {
      if (section.summary) {
        context.sectionSummary = section.summary.slice(0, 300);
      }
      if (section.concepts?.length) {
        context.sectionConcepts = section.concepts;
      }
    }
  }

  // Only return if we found something useful
  const hasContent = context.pageTranslation || context.bookOverview || context.sectionSummary;
  return hasContent ? context : undefined;
}

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

    // Fetch research context (page translations + book summaries)
    const researchContext = await fetchResearchContext(db, candidate);

    // Generate variations using AI
    const result = await generateTweetVariations({
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
      researchContext,
    });

    const { variations, research } = result;

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
      research?: string;
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
      research,
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
          ...(research ? { research_notes: research } : {}),
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
