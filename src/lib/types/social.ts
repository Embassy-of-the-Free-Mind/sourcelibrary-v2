// ============================================
// SOCIAL MEDIA MARKETING
// ============================================

export type SocialPostStatus = 'draft' | 'queued' | 'posted' | 'failed';

/**
 * A social media post (tweet) generated for a gallery image
 */
export interface SocialPost {
  _id?: unknown;
  id: string;                    // nanoid
  tweet_text: string;            // max 280 chars
  hashtags: string[];

  // Reference to source image
  image_ref: {
    page_id: string;
    detection_index: number;
    gallery_image_id: string;    // "pageId:index" format
  };

  // Denormalized image data for display
  image_data: {
    cropped_url: string;
    description: string;
    book_title: string;
    book_author?: string;
    book_year?: number;
  };

  status: SocialPostStatus;
  scheduled_for?: Date;          // When to post (null = manual/immediate)

  // AI generation metadata
  generated_by: {
    model: string;
    generated_at: Date;
    alternatives: string[];      // Other tweet options generated
  };

  // After posting to Twitter
  posted_at?: Date;
  twitter_id?: string;
  twitter_url?: string;
  error?: string;                // If failed

  created_at: Date;
  updated_at: Date;
}

/**
 * Social media configuration (singleton per platform)
 */
export interface SocialConfig {
  _id?: unknown;
  platform: 'twitter';

  settings: {
    posts_per_day: number;       // Rate limit (default: 2)
    posting_hours: number[];     // UTC hours to post (e.g., [14, 20])
    auto_post_enabled: boolean;  // Enable cron posting
    min_gallery_quality: number; // Minimum quality (default: 0.75)
  };

  usage: {
    tweets_today: number;
    tweets_this_month: number;
    last_tweet_at?: Date;
  };

  updated_at: Date;
}

/**
 * Twitter/X accounts to tag per audience category
 */
export interface SocialTag {
  _id?: unknown;
  handle: string;              // Twitter handle without @ (e.g., "QuoteJung")
  name: string;                // Display name (e.g., "Carl Jung Archive")
  audience: string;            // Audience category (jungian, esoteric, etc.)
  description?: string;        // Brief description of who they are
  followers?: number;          // Approximate follower count
  relevance: string;           // Why they're relevant for Source Library
  active: boolean;             // Whether to include in suggestions
  priority: number;            // 1-10, higher = more likely to suggest
  last_tagged?: Date;          // Track when we last tagged them
  created_at: Date;
  updated_at: Date;
}